import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
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

async function waitForPageText(url, expected) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await fetch(url);
    if (response.ok && (await response.text()).includes(expected)) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for rendered page to contain ${expected}`);
}

function virtualRoute(inputPath) {
  return "/spotlight/" + inputPath.replace(/\.md$/i, ".html").split("/").filter(Boolean).map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
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
  writeFileSync(inputPath, "# Audit\n\nSelected audit passage\n");

  const auto = cli(["--auto", "--no-open", "--json", "--port", String(port), inputPath], env);
  assert.equal(auto.status, 0, auto.stderr);
  const registration = JSON.parse(auto.stdout);
  const url = registration.url;

  t.after(async () => {
    cli(["stop", "--port", String(port), "--json"], env);
    await sleep(100);
    rmSync(dir, { recursive: true, force: true });
  });

  await waitForServer(url);
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

test("one daemon isolates registered documents and safely encodes virtual routes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "spotlight-md-daemon-"));
  const configDir = join(dir, "config");
  const env = { SPOTLIGHT_MD_CONFIG_DIR: configDir };
  const port = await unusedPort();
  const firstPath = join(dir, "alpha #100%.md");
  const secondPath = join(dir, "β notes.md");
  const unregisteredPath = join(dir, "private # notes.md");
  writeFileSync(firstPath, "# First\n\nFirst document passage\n");
  writeFileSync(secondPath, "# Second\n\nSecond document passage\n");
  writeFileSync(unregisteredPath, "# Private\n\nMust not be served\n");

  t.after(async () => {
    cli(["stop", "--port", String(port), "--json"], env);
    await sleep(100);
    rmSync(dir, { recursive: true, force: true });
  });

  let result = cli(["--auto", "--no-open", "--json", "--port", String(port), firstPath], env);
  assert.equal(result.status, 0, result.stderr);
  const first = JSON.parse(result.stdout);
  assert.equal(first.route, virtualRoute(realpathSync(firstPath)));
  assert.match(first.route, /alpha%20%23100%25\.html$/);

  result = cli(["--auto", "--no-open", "--json", "--port", String(port), secondPath], env);
  assert.equal(result.status, 0, result.stderr);
  const second = JSON.parse(result.stdout);
  assert.equal(second.route, virtualRoute(realpathSync(secondPath)));
  assert.match(second.route, /%CE%B2%20notes\.html$/);
  assert.notEqual(first.url, second.url);

  result = cli(["status", "--port", String(port), "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  let status = JSON.parse(result.stdout);
  assert.deepEqual(status.documents.map((document) => document.path), [realpathSync(secondPath), realpathSync(firstPath)], "new registrations are the most recent activity");
  assert.ok(status.documents.every((document) => document.lastActivityAt), "status exposes document activity timestamps");

  const secondPage = await (await fetch(second.url)).text();
  assert.match(secondPage, /<div class="sidebar-section-title">Recent documents<\/div>/);
  assert.ok(secondPage.includes(`<a href="${second.route}" class="recent-document-link active" aria-current="page">`), "marks the open document in the recent list");
  assert.ok(secondPage.includes(`<a href="${first.route}" class="recent-document-link">`), "links to another registered document's virtual route");
  assert.ok(secondPage.includes(realpathSync(firstPath)) && secondPage.includes(realpathSync(secondPath)), "canonical paths disambiguate recent document entries");
  assert.equal(secondPage.includes(unregisteredPath), false, "does not expose unregistered documents in the recent list");
  assert.ok(secondPage.indexOf(`href="${second.route}"`) < secondPage.indexOf(`href="${first.route}"`), "renders most recently active documents first");

  result = cli(["--auto", "--no-open", "--json", "--port", String(port), firstPath], env);
  assert.equal(result.status, 0, result.stderr);
  const resumed = JSON.parse(result.stdout);
  assert.equal(resumed.sessionId, first.sessionId);
  assert.equal(resumed.resumed, true);

  assert.equal(existsSync(firstPath.replace(/\.md$/i, ".html")), false, "auto mode must not write a neighboring HTML file");
  assert.equal(existsSync(secondPath.replace(/\.md$/i, ".html")), false, "auto mode must not write a neighboring HTML file");

  assert.match(await (await fetch(first.url)).text(), /First document passage/);
  assert.match(await (await fetch(second.url)).text(), /Second document passage/);
  const hiddenResponse = await fetch(`http://127.0.0.1:${port}${virtualRoute(realpathSync(unregisteredPath))}`);
  assert.equal(hiddenResponse.status, 404, "a real but unregistered path must not be readable through a virtual route");

  const created = await fetch(`${first.url}/__highlights__`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "First document passage" }),
  });
  assert.equal(created.status, 201);
  assert.equal((await (await fetch(`${first.url}/__highlights__`)).json()).length, 1);
  assert.deepEqual(await (await fetch(`${second.url}/__highlights__`)).json(), [], "highlight APIs must remain document-scoped");

  const linkedUrl = new URL(first.route, second.url);
  assert.match(await (await fetch(linkedUrl)).text(), /First document passage/, "a recent entry opens the registered document route");
  assert.equal((await (await fetch(`${linkedUrl}/__session__`)).json()).id, first.sessionId, "the linked route restores the document's active session");
  assert.equal((await (await fetch(`${linkedUrl}/__highlights__`)).json()).length, 1, "the linked route restores access to the session's highlights");

  result = cli(["status", "--port", String(port), "--json"], env);
  status = JSON.parse(result.stdout);
  assert.equal(status.documents[0].path, realpathSync(firstPath), "review and navigation activity move a document to the front");

  writeFileSync(firstPath, "# First\n\nReloaded first document\n");
  await waitForPageText(first.url, "Reloaded first document");
  assert.match(await (await fetch(second.url)).text(), /Second document passage/, "one document reload must not replace another document's page");

  result = cli(["status", "--port", String(port), "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  status = JSON.parse(result.stdout);
  assert.equal(status.running, true);
  assert.equal(status.documents.length, 2);
  assert.deepEqual(new Set(status.documents.map((document) => document.path)), new Set([realpathSync(firstPath), realpathSync(secondPath)]));

  result = cli(["stop", "--port", String(port), "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  await sleep(100);
  result = cli(["status", "--port", String(port), "--json"], env);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).running, false);
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

test("live review pages include a dismissible first-run collaboration guide", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "spotlight-md-guide-"));
  const inputPath = join(dir, "guide.md");
  const configDir = join(dir, "config");
  const env = { SPOTLIGHT_MD_CONFIG_DIR: configDir };
  const port = await unusedPort();
  writeFileSync(inputPath, "# Guide\n\nA passage to review.\n");

  const auto = cli(["--auto", "--no-open", "--json", "--port", String(port), inputPath], env);
  assert.equal(auto.status, 0, auto.stderr);
  const { url } = JSON.parse(auto.stdout);

  t.after(async () => {
    cli(["stop", "--port", String(port), "--json"], env);
    await sleep(100);
    rmSync(dir, { recursive: true, force: true });
  });

  await waitForServer(url);
  const page = await (await fetch(url)).text();

  assert.match(page, /id="spotlight-guide"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.equal((page.match(/class="spotlight-guide-step"/g) || []).length, 5);
  assert.match(page, /Select text/);
  assert.match(page, /optional note/i);
  assert.match(page, /Submit the highlight/);
  assert.match(page, /whole document/i);
  assert.match(page, /suggested edits/i);
  assert.match(page, /sessions preserve[^<]*review and audit trail/i);
  assert.match(page, /id="spotlight-guide-dismiss"[^>]*>Got it<\/button>/);
  assert.match(page, /id="spotlight-guide-open"[^>]*>Guide<\/button>/);
  assert.match(page, /spotlight-md\.guide\.v1\.dismissed/);
  assert.match(page, /localStorage\.getItem\(guideStorageKey\)/);
  assert.match(page, /localStorage\.setItem\(guideStorageKey, '1'\)/);
  assert.match(page, /if \(e\.key === 'Escape' && !guide\.hidden\)/);
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

// ── Review features layered on the daemon (suggestions, claims, directives) ──

async function registerDoc(t, contents) {
  const dir = mkdtempSync(join(tmpdir(), "spotlight-md-review-"));
  const inputPath = join(dir, "doc.md");
  const configDir = join(dir, "config");
  const env = { SPOTLIGHT_MD_CONFIG_DIR: configDir };
  const port = await unusedPort();
  writeFileSync(inputPath, contents);
  const auto = cli(["--auto", "--no-open", "--json", "--port", String(port), inputPath], env);
  assert.equal(auto.status, 0, auto.stderr);
  const registration = JSON.parse(auto.stdout);
  t.after(async () => {
    cli(["stop", "--port", String(port), "--json"], env);
    await sleep(100);
    rmSync(dir, { recursive: true, force: true });
  });
  await waitForServer(registration.url);
  return { env, inputPath, url: registration.url, sessionId: registration.sessionId };
}

test("suggested edits propose via CLI, approve splices the source, reject leaves it untouched", async (t) => {
  const { env, inputPath, url, sessionId } = await registerDoc(t, "# Doc\n\nThe quick brown fox.\n\nA second sentence stays put.\n");
  const highlight = await (await fetch(`${url}/__highlights__`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "The quick brown fox.", note: "rephrase" }),
  })).json();

  let result = cli(["suggest-edit", "--session-id", sessionId, "--highlight-id", highlight.id,
    "--anchor", "The quick brown fox.", "--replacement", "A swift auburn fox leapt.",
    "--comment", "Acknowledged, rephrasing.", "--agent-id", "codex-test", "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  const proposed = JSON.parse(result.stdout);
  assert.match(proposed.suggestion.id, /^sg-[a-f0-9]{10}$/);

  let hls = await (await fetch(`${url}/__highlights__`)).json();
  assert.equal(hls[0].suggestions.length, 1);

  const second = JSON.parse(cli(["suggest-edit", "--session-id", sessionId, "--highlight-id", highlight.id,
    "--anchor", "A second sentence stays put.", "--replacement", "SHOULD NOT APPLY", "--json"], env).stdout);
  const rejectRes = await fetch(`${url}/__suggestions__/${second.suggestion.id}/reject`, { method: "PATCH" });
  assert.equal(rejectRes.status, 200);
  assert.doesNotMatch(readFileSync(inputPath, "utf8"), /SHOULD NOT APPLY/);

  const acceptRes = await fetch(`${url}/__suggestions__/${proposed.suggestion.id}/accept`, { method: "PATCH" });
  assert.equal(acceptRes.status, 200);
  const after = readFileSync(inputPath, "utf8");
  assert.match(after, /A swift auburn fox leapt\./);
  assert.doesNotMatch(after, /The quick brown fox\./);

  const stale = JSON.parse(cli(["suggest-edit", "--session-id", sessionId, "--highlight-id", highlight.id,
    "--anchor", "text that is not present", "--replacement", "x", "--json"], env).stdout);
  const staleRes = await fetch(`${url}/__suggestions__/${stale.suggestion.id}/accept`, { method: "PATCH" });
  assert.equal(staleRes.status, 409);
});

test("suggested edits match anchors across markdown line wrapping", async (t) => {
  const { env, inputPath, url, sessionId } = await registerDoc(t, "# Doc\n\nSmells pleasantly sour (not\nlike nail polish remover), and passes.\n");
  const highlight = await (await fetch(`${url}/__highlights__`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "(not like nail polish remover)", note: "reword" }),
  })).json();
  const proposed = JSON.parse(cli(["suggest-edit", "--session-id", sessionId, "--highlight-id", highlight.id,
    "--anchor", "(not like nail polish remover)", "--replacement", "(not sharp or solvent-like)", "--json"], env).stdout);
  const acceptRes = await fetch(`${url}/__suggestions__/${proposed.suggestion.id}/accept`, { method: "PATCH" });
  assert.equal(acceptRes.status, 200, "wrapped anchor should still splice");
  assert.match(readFileSync(inputPath, "utf8"), /\(not sharp or solvent-like\)/);
});

test("ai-agent-claim surfaces a thinking state that a response clears", async (t) => {
  const { env, url, sessionId } = await registerDoc(t, "# Doc\n\nA passage to review.\n");
  const highlight = await (await fetch(`${url}/__highlights__`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "A passage to review.", note: "look" }),
  })).json();
  assert.equal((await (await fetch(`${url}/__highlights__`)).json())[0].aiState, null);
  cli(["ai-agent-claim", "--session-id", sessionId, "--highlight-id", highlight.id, "--agent-id", "codex-test", "--json"], env);
  assert.equal((await (await fetch(`${url}/__highlights__`)).json())[0].aiState, "thinking");
  cli(["add-comment", "--session-id", sessionId, "--highlight-id", highlight.id, "--agent-id", "codex-test", "--comment", "done", "--json"], env);
  assert.equal((await (await fetch(`${url}/__highlights__`)).json())[0].aiState, null);
});

test("whole-document directives reach the agent loop with a numbered outline", async (t) => {
  const { env, url, sessionId } = await registerDoc(t, "# Doc\n\nIntro.\n\n## First\n\nOne.\n\n### Sub\n\nDetail.\n\n## Second\n\nTwo.\n");
  const res = await fetch(`${url}/__directives__`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "add a joke to the end of each section" }),
  });
  assert.equal(res.status, 201);
  const directive = await res.json();
  assert.equal(directive.scope, "document");
  assert.match(directive.id, /^dm-/);

  const unread = JSON.parse(cli(["get-new-comments", "--session-id", sessionId, "--agent-id", "codex-test", "--json"], env).stdout);
  const found = unread.find((h) => h.id === directive.id);
  assert.ok(found, "directive should be unread work");
  assert.equal(found.scope, "document");
  assert.deepEqual(found.currentToc.map((s) => s.number + " " + s.title), ["1 First", "1.1 Sub", "2 Second"]);
});

test("prime documents the suggest-edit and whole-document workflows", () => {
  const result = cli(["prime"], {});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /suggest-edit --session-id/);
  assert.match(result.stdout, /--anchor/);
  assert.match(result.stdout, /currentToc/);
  assert.match(result.stdout, /ai-agent-claim/);
});
