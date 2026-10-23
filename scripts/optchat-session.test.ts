import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectedSessionAdapter, trustedTranscript } from "../integrations/pi-optchat/herdr-session.ts";
import { installConnectedPatch } from "../integrations/pi-optchat/install.ts";

function window(runs: string) {
  const handlers = new Map<string, (event: any, ctx: any) => any>();
  const events = new Map<string, (data: any) => any>();
  const reports: { path: string; seq: number; reason?: string }[] = [];
  const pi = { on: (name: string, handler: any) => handlers.set(name, handler), events: { on: (name: string, handler: any) => events.set(name, handler) } };
  connectedSessionAdapter(api => {
    // Mirrors the managed bridge's shared session and state sequence: no second reporter.
    let seq = 0, path: string;
    api.on("session_start", (event: any, ctx: any) => { path = ctx.sessionManager.getSessionFile(); reports.push({ path, seq: ++seq, reason: event.reason }); });
    api.on("agent_start", (_event: any, ctx: any) => { path = ctx.sessionManager.getSessionFile(); reports.push({ path, seq: ++seq }); });
  }, pi, runs);
  const context = { mode: "tui", sessionManager: { getSessionFile: () => "/local/unwritten.jsonl" } };
  handlers.get("session_start")!({ reason: "startup" }, context);
  return { reports, emit: (path: unknown) => events.get("optchat:transcript")!({ path }), state: () => handlers.get("agent_start")!({}, context), reset: () => handlers.get("session_start")!({ reason: "new" }, context) };
}

describe("OptChat authoritative connected transcripts", () => {
  it("refuses unknown versions and changed source without replacing an installed overlay", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ovis-overlay-")));
    try {
      const source = join(root, "source"), installed = join(root, "installed");
      mkdirSync(join(source, "src"), { recursive: true }); mkdirSync(installed);
      writeFileSync(join(installed, "sentinel"), "keep");
      writeFileSync(join(source, "package.json"), JSON.stringify({ name: "pi-optchat", version: "0.9.0" }));
      expect(() => installConnectedPatch(source, installed)).toThrow("Expected unmodified");
      writeFileSync(join(source, "package.json"), JSON.stringify({ name: "pi-optchat", version: "0.8.9" }));
      writeFileSync(join(source, "src/window-bridge.ts"), "changed upstream source");
      writeFileSync(join(source, "src/connected-window.ts"), "changed upstream source");
      expect(() => installConnectedPatch(source, installed)).toThrow("Unsupported pi-optchat source");
      expect(readFileSync(join(installed, "sentinel"), "utf8")).toBe("keep");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("scopes simultaneous windows and reconnects to their explicit run; retains state sequencing", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ovis-connected-")));
    try {
      const a = join(root, "a.jsonl"), b = join(root, "b.jsonl");
      writeFileSync(a, "{}"); writeFileSync(b, "{}");
      const first = window(root), second = window(root);
      await first.emit(a); await second.emit(b); first.state(); second.state();
      expect(first.reports.at(-1)).toEqual({ path: a, seq: 3 });
      expect(second.reports.at(-1)).toEqual({ path: b, seq: 3 });
      await first.emit(a);
      expect(first.reports.at(-1)).toEqual({ path: a, seq: 4, reason: "resume" });
      first.reset(); first.state();
      expect(first.reports.at(-1)?.path).toBe("/local/unwritten.jsonl");
      expect(second.reports.at(-1)?.path).toBe(b);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("rejects foreign profiles, relative paths, broken links and symlink escapes", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ovis-connected-")));
    try {
      const runs = join(root, "runs"); mkdirSync(runs);
      const outside = join(root, "foreign.jsonl"); writeFileSync(outside, "{}");
      symlinkSync(outside, join(runs, "escape.jsonl"));
      symlinkSync(join(root, "missing.jsonl"), join(runs, "broken.jsonl"));
      for (const path of [outside, "relative.jsonl", join(runs, "escape.jsonl"), join(runs, "broken.jsonl"), null]) expect(trustedTranscript(path, runs)).toBeNull();
      expect(trustedTranscript(join(runs, "next.jsonl"), runs)).toBe(join(runs, "next.jsonl"));
      const connected = window(runs);
      await connected.emit(outside);
      expect(connected.reports.length).toBe(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
