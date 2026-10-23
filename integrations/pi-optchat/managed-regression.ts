import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectedSessionAdapter } from "./herdr-session.ts";

const managed = process.argv[2];
if (!managed) throw new Error("Usage: bun integrations/pi-optchat/managed-regression.ts <managed-herdr-extension>");
const root = realpathSync(mkdtempSync(join(tmpdir(), "oc-managed-")));
const socket = join(root, "herdr.sock"), runs = join(root, "runs");
mkdirSync(runs);
const transcript = join(runs, "authoritative.jsonl"); writeFileSync(transcript, '{}\n');
const reports: any[] = [], sockets = new Set<import("node:net").Socket>();
const handlers = new Map<string, any>(), events = new Map<string, any>();
const pi = { on: (key: string, fn: any) => handlers.set(key, fn), events: { on: (key: string, fn: any) => events.set(key, fn) } };
const server = createServer(client => {
  sockets.add(client); client.on("close", () => sockets.delete(client));
  let pending = "";
  client.on("data", data => {
    pending += data;
    if (!pending.includes("\n")) return;
    reports.push(JSON.parse(pending.trim())); client.end('{"ok":true}\n');
  });
});
try {
  await new Promise<void>(resolve => server.listen(socket, resolve));
  process.env["HERDR_ENV"] = "1"; process.env["HERDR_SOCKET_PATH"] = socket; process.env["HERDR_PANE_ID"] = "w-test:p1";
  delete process.env["PI_DELEGATED"];
  const install = (await import(resolve(managed))).default;
  connectedSessionAdapter(install, pi, runs);
  const ctx = { mode: "tui", isIdle: () => true, sessionManager: { getSessionFile: () => join(root, "local-unwritten.jsonl"), getSessionId: () => "local-session" } };
  await handlers.get("session_start")({ reason: "startup" }, ctx);
  await events.get("optchat:transcript")({ path: transcript });
  await handlers.get("agent_start")({}, ctx);
  // Drain the managed extension's asynchronous state queue via the Node event loop, bounded.
  const deadline = Date.now() + 2000;
  while (!reports.some(report => report.method === "pane.report_agent" && report.params.state === "working" && report.params.agent_session_path === transcript)) {
    if (Date.now() > deadline) throw new Error("managed state did not retain authoritative transcript");
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  const session = reports.find(report => report.method === "pane.report_agent_session" && report.params.agent_session_path === transcript);
  assert.equal(session.params.session_start_source, "resume");
  assert.equal(session.params.pane_id, "w-test:p1");
  for (let i = 1; i < reports.length; i++) assert.ok(reports[i].params.seq > reports[i - 1].params.seq);
  console.log("ok: unmodified managed Herdr extension reports the authoritative run with resume lifecycle and preserves increasing session/state sequence numbers");
} finally {
  for (const client of sockets) client.destroy();
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
}
