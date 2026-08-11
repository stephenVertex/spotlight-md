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
  const result = cli(["--version"], {});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "spotlight-md 0.1.1");
});
