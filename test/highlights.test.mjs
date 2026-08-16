import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { tmpdir } from "node:os";

const toolPath = resolve(import.meta.dirname, "..", "mdhtml");

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`spotlight-md exited before serving (${child.exitCode})`);
    }
    try {
      const response = await fetch(`${url}/__highlights__`);
      if (response.ok) return;
    } catch {
      // The listener has not started yet.
    }
    await sleep(50);
  }
  throw new Error("timed out waiting for spotlight-md to serve highlights");
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}

function cli(args, env) {
  return spawnSync(process.execPath, [toolPath, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

function waitCli(args, env) {
  const child = spawn(process.execPath, [toolPath, ...args], { env: { ...process.env, ...env } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, done: once(child, "exit").then(([code]) => ({ code, stdout, stderr })) };
}

test("global service sessions support agent cursors, completion, and close summaries", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "spotlight-md-highlights-"));
  const inputPath = join(dir, "2026-08-10-audit.md");
  const configDir = join(dir, "config");
  const env = { SPOTLIGHT_MD_CONFIG_DIR: configDir };
  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(inputPath, "# Audit\n\nSelected audit passage\n");

  const child = spawn(process.execPath, [toolPath, "--auto", "--no-open", "--port", String(port), inputPath], {
    stdio: "ignore",
    env: { ...process.env, ...env },
  });

  t.after(async () => {
    await stop(child);
    rmSync(dir, { recursive: true, force: true });
  });

  await waitForServer(url, child);
  const createResponse = await fetch(`${url}/__highlights__`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "Selected audit passage",
      sectionId: "audit",
      sectionTitle: "Audit",
      note: "Persist this selection",
    }),
  });
  assert.equal(createResponse.status, 201);
  const highlight = await createResponse.json();
  assert.match(highlight.id, /^hl-[a-f0-9]{10}$/);
  assert.equal(highlight.text, "Selected audit passage");
  assert.ok(existsSync(join(configDir, "global-highlights-db.db")), "creates the global database");

  const sessionResponse = await fetch(`${url}/__session__`);
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert.match(session.id, /^sp-[a-f0-9]{10}$/);

  let result = cli(["list-highlights", "--session-id", session.id, "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).map((h) => h.id), [highlight.id]);

  result = cli(["get-new-comments", "--session-id", session.id, "--agent-id", "codex-test", "--json"], env);
  assert.equal(JSON.parse(result.stdout)[0].id, highlight.id);
  assert.equal(cli(["ai-agent-mark-read", "--session-id", session.id, "--highlight-id", highlight.id, "--agent-id", "codex-test", "--json"], env).status, 0);
  result = cli(["get-new-comments", "--session-id", session.id, "--agent-id", "codex-test", "--json"], env);
  assert.deepEqual(JSON.parse(result.stdout), []);

  result = cli(["add-comment", "--session-id", session.id, "--highlight-id", highlight.id, "--agent-id", "codex-test", "--comment", "Acknowledged", "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).message.text, "Acknowledged");

  const waiting = waitCli(["get-new-comments", "--session-id", session.id, "--agent-id", "codex-test", "--wait", "--json"], env);
  t.after(() => waiting.child.kill("SIGTERM"));
  await sleep(100);
  const replyResponse = await fetch(`${url}/__highlights__/${highlight.id}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: "human", text: "Please complete it" }),
  });
  assert.equal(replyResponse.status, 200);
  const wake = await waiting.done;
  assert.equal(wake.code, 0, wake.stderr);
  assert.equal(JSON.parse(wake.stdout)[0].messages.at(-1).text, "Please complete it");

  result = cli(["ai-agent-mark-as-completed", "--session-id", session.id, "--highlight-id", highlight.id, "--agent-id", "codex-test", "--comment", "Completed as requested", "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "completed");

  writeFileSync(inputPath, "# Audit\n\nUpdated audit passage\n");
  result = cli(["close-session", "--session-id", session.id], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /# Review session/);
  assert.match(result.stdout, /\+ Updated audit passage/);
  assert.match(result.stdout, /Completed as requested/);
});

test("suggested edits: propose via CLI, approve splices the source, reject leaves it untouched", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "spotlight-md-suggest-"));
  const inputPath = join(dir, "doc.md");
  const configDir = join(dir, "config");
  const env = { SPOTLIGHT_MD_CONFIG_DIR: configDir };
  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(inputPath, "# Doc\n\nThe quick brown fox.\n\nA second sentence stays put.\n");

  const child = spawn(process.execPath, [toolPath, "--auto", "--no-open", "--port", String(port), inputPath], {
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
  t.after(async () => {
    await stop(child);
    rmSync(dir, { recursive: true, force: true });
  });
  await waitForServer(url, child);

  const session = await (await fetch(`${url}/__session__`)).json();
  const highlight = await (await fetch(`${url}/__highlights__`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "The quick brown fox.", sectionId: "doc", sectionTitle: "Doc", note: "rephrase" }),
  })).json();

  // Propose a suggested edit tied to the highlight, with a thread comment.
  let result = cli(["suggest-edit", "--session-id", session.id, "--highlight-id", highlight.id,
    "--anchor", "The quick brown fox.", "--replacement", "A swift auburn fox leapt.",
    "--comment", "Acknowledged, rephrasing.", "--agent-id", "codex-test", "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  const proposed = JSON.parse(result.stdout);
  assert.match(proposed.suggestion.id, /^sg-[a-f0-9]{10}$/);
  assert.equal(proposed.suggestion.status, "pending");
  assert.equal(proposed.message.text, "Acknowledged, rephrasing.");

  // The suggestion rides along with the highlight in the browser payload.
  let hls = await (await fetch(`${url}/__highlights__`)).json();
  assert.equal(hls[0].suggestions.length, 1);
  assert.equal(hls[0].suggestions[0].replacement, "A swift auburn fox leapt.");

  // Rejecting a suggestion leaves the document untouched.
  const second = JSON.parse(cli(["suggest-edit", "--session-id", session.id, "--highlight-id", highlight.id,
    "--anchor", "A second sentence stays put.", "--replacement", "SHOULD NOT APPLY", "--json"], env).stdout);
  const rejectRes = await fetch(`${url}/__suggestions__/${second.suggestion.id}/reject`, { method: "PATCH" });
  assert.equal(rejectRes.status, 200);
  assert.equal((await rejectRes.json()).status, "rejected");
  assert.match(readFileSync(inputPath, "utf8"), /A second sentence stays put\./);
  assert.doesNotMatch(readFileSync(inputPath, "utf8"), /SHOULD NOT APPLY/);

  // Approving splices anchor→replacement into the markdown source.
  const acceptRes = await fetch(`${url}/__suggestions__/${proposed.suggestion.id}/accept`, { method: "PATCH" });
  assert.equal(acceptRes.status, 200);
  assert.equal((await acceptRes.json()).status, "accepted");
  const after = readFileSync(inputPath, "utf8");
  assert.match(after, /A swift auburn fox leapt\./);
  assert.doesNotMatch(after, /The quick brown fox\./);

  // Once accepted it is no longer pending, so it drops off the highlight.
  hls = await (await fetch(`${url}/__highlights__`)).json();
  assert.equal(hls[0].suggestions.length, 0);

  // Approving a suggestion whose anchor no longer exists fails cleanly.
  const stale = JSON.parse(cli(["suggest-edit", "--session-id", session.id, "--highlight-id", highlight.id,
    "--anchor", "text that is not present", "--replacement", "x", "--json"], env).stdout);
  const staleRes = await fetch(`${url}/__suggestions__/${stale.suggestion.id}/accept`, { method: "PATCH" });
  assert.equal(staleRes.status, 409);
});

test("suggested edits match anchors across markdown line wrapping", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "spotlight-md-wrap-"));
  const inputPath = join(dir, "doc.md");
  const configDir = join(dir, "config");
  const env = { SPOTLIGHT_MD_CONFIG_DIR: configDir };
  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}`;
  // The prose is hard-wrapped, so the source has a newline where the rendered
  // text (and thus a copied anchor) has a space.
  writeFileSync(inputPath, "# Doc\n\nSmells pleasantly sour (not\nlike nail polish remover), and passes.\n");

  const child = spawn(process.execPath, [toolPath, "--auto", "--no-open", "--port", String(port), inputPath], {
    stdio: "ignore", env: { ...process.env, ...env },
  });
  t.after(async () => { await stop(child); rmSync(dir, { recursive: true, force: true }); });
  await waitForServer(url, child);

  const session = await (await fetch(`${url}/__session__`)).json();
  const highlight = await (await fetch(`${url}/__highlights__`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "(not like nail polish remover)", note: "reword" }),
  })).json();

  // Anchor uses a single space, matching the rendered text, not the wrapped source.
  const proposed = JSON.parse(cli(["suggest-edit", "--session-id", session.id, "--highlight-id", highlight.id,
    "--anchor", "(not like nail polish remover)", "--replacement", "(not sharp or solvent-like)", "--json"], env).stdout);
  const acceptRes = await fetch(`${url}/__suggestions__/${proposed.suggestion.id}/accept`, { method: "PATCH" });
  assert.equal(acceptRes.status, 200, "wrapped anchor should still splice");
  const after = readFileSync(inputPath, "utf8");
  assert.match(after, /\(not sharp or solvent-like\)/);
  assert.doesNotMatch(after, /nail polish remover/);
});

test("prime documents the suggest-edit workflow for agents", () => {
  const result = cli(["prime"], {});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /suggest-edit --session-id/);
  assert.match(result.stdout, /--anchor/);
  assert.match(result.stdout, /--replacement/);
});

test("selection popup submit handler receives its event instead of referencing an undeclared variable", () => {
  const source = readFileSync(toolPath, "utf8");
  assert.equal(
    /function submit\(event\) \{[\s\S]*?if \(event\) \{[\s\S]*?event\.preventDefault\(\);/.test(source),
    true,
    "the popup submit callback must accept direct keyboard submission without an event",
  );
  assert.equal(
    /if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); submit\(e\); \}/.test(source),
    true,
    "pressing Enter in the note field must pass its keyboard event to submit",
  );
});

test("prime teaches agents the session-based collaborative review loop", () => {
  const result = cli(["prime"], {});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Collaborative Review Guide for AI Agents/);
  assert.match(result.stdout, /get-new-comments --session-id/);
  assert.match(result.stdout, /close-session --session-id/);
  assert.match(result.stdout, /Do not complete a highlight merely because you replied/);
});

test("reports the semantic version from the release source of truth", () => {
  const expected = readFileSync(resolve(import.meta.dirname, "..", "VERSION"), "utf8").trim();
  const result = cli(["--version"], {});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `spotlight-md ${expected}`);
});

test("rendered pages include a fixed spotlight-md version badge", () => {
  const source = readFileSync(toolPath, "utf8");
  assert.match(source, /class="spotlight-brand"/);
  assert.match(source, /spotlight-md <span>v\$\{escapeHtml\(VERSION\)\}/);
  assert.match(source, /\.spotlight-brand \{\s*position: fixed;/);
});
