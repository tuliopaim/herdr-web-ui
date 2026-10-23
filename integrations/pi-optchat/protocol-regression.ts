/** Exercise the pinned package's real Unix-socket protocol, without a model or user sessions. */
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
mock.module("@earendil-works/pi-coding-agent", () => ({ SessionManager: {}, resizeImage() {} }));
mock.module("@earendil-works/pi-ai", () => ({ getCurrentSystemMessage: () => ({}) }));
const source = process.argv[2];
if (!source) throw new Error("Usage: bun integrations/pi-optchat/protocol-regression.ts <pi-optchat-package>");
const { serveWindows, connectWindow } = await import(join(resolve(source), "src/window-bridge.ts"));
const root = realpathSync(mkdtempSync(join(tmpdir(), "oc-wire-")));
const records = new Map<string, any>();
const views: any[] = [];
let close: (() => Promise<void>) | undefined;
const children = {
  history: { records, list: () => [...records.values()] },
  live: () => undefined,
  retained: () => [],
  async spawn() {
    const id = `child-${records.size + 1}`, sessionFile = join(root, "runs", `${id}.jsonl`);
    writeFileSync(sessionFile, '{}\n');
    records.set(id, { id, sessionFile, task: id, state: "waiting", model: "fixture", guidance: [] });
    return [id];
  },
  async finish() {},
};
try {
  mkdirSync(join(root, "runs"));
  close = await serveWindows(root, children, () => true, async () => {});
  const firstEvents: any[] = [], secondEvents: any[] = [], attachedEvents: any[] = [];
  const first = await connectWindow(root, (event: any) => firstEvents.push(event), () => {}); views.push(first);
  const second = await connectWindow(root, (event: any) => secondEvents.push(event), () => {}); views.push(second);
  await first.request("start", "First", root); await second.request("start", "Second", root);
  assert.equal(firstEvents[0].transcript, join(root, "runs", "child-1.jsonl"));
  assert.equal(secondEvents[0].transcript, join(root, "runs", "child-2.jsonl"));
  first.close();
  const attached = await connectWindow(root, (event: any) => attachedEvents.push(event), () => {}); views.push(attached);
  await attached.request("attach", "child-1");
  assert.equal(attachedEvents[0].transcript, join(root, "runs", "child-1.jsonl"));
  await attached.request("complete");
  const foreign = join(root, "foreign.jsonl"); writeFileSync(foreign, '{}\n');
  records.get("child-2").sessionFile = foreign;
  const rejected: any[] = [];
  const other = await connectWindow(root, (event: any) => rejected.push(event), () => {}); views.push(other);
  await other.request("attach", "child-2");
  assert.equal(rejected[0].transcript, undefined);
  console.log("ok: real owner/window protocol reports distinct authoritative transcripts on start and reattach, rejects foreign paths, and completes without model calls");
} finally {
  for (const view of views) view.close();
  await close?.(); rmSync(root, { recursive: true, force: true });
}
