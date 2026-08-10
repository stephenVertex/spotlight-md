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

test("browser highlight API creates the expected SQLite sidecar and survives server stop", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "spotlight-md-highlights-"));
  const inputPath = join(dir, "2026-08-10-audit.md");
  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(inputPath, "# Audit\n\nSelected audit passage\n");

  const child = spawn(process.execPath, [toolPath, "--auto", "--no-open", "--port", String(port), inputPath], {
    stdio: "ignore",
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
  assert.match(highlight.id, /^hl-[a-f0-9]{6}$/);
  assert.equal(highlight.text, "Selected audit passage");
  assert.ok(existsSync(`${inputPath}.highlights.db`), "creates <file>.md.highlights.db");

  const resolveResponse = await fetch(`${url}/__highlights__/${highlight.id}/resolve`, { method: "PATCH" });
  assert.equal(resolveResponse.status, 200);
  assert.equal((await resolveResponse.json()).resolved, true);

  await stop(child);
  const list = spawnSync(process.execPath, [toolPath, "--list-highlights", inputPath], { encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /Selected audit passage/);
});

test("selection popup submit handler receives its event instead of referencing an undeclared variable", () => {
  const source = readFileSync(toolPath, "utf8");
  assert.equal(
    /function submit\(event\) \{\s*event\.preventDefault\(\);/.test(source),
    true,
    "the popup submit callback must receive the click or keyboard event",
  );
  assert.equal(
    /function submit\(\) \{\s*e\.preventDefault/.test(source),
    false,
    "the popup must not reference an undeclared event variable",
  );
});
