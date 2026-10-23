import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Install a local, reproducible 0.8.9 overlay; never mutate npm's cache or a managed extension. */
export function installConnectedPatch(source: string, destination: string) {
  const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  if (pkg.name !== "pi-optchat" || pkg.version !== "0.8.9") throw new Error("Expected unmodified pi-optchat 0.8.9");
  let bridge = readFileSync(join(source, "src/window-bridge.ts"), "utf8");
  let window = readFileSync(join(source, "src/connected-window.ts"), "utf8");
  const replace = (text: string, anchor: string, value: string, count = 1) => {
    if (text.split(anchor).length - 1 !== count) throw new Error(`Unsupported pi-optchat source: ${anchor}`);
    return text.replaceAll(anchor, value);
  };
  bridge = replace(bridge, "import { chmodSync } from 'node:fs';", "import { chmodSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { trustedTranscript } from './herdr-session.ts';");
  bridge = replace(bridge, "message?: AgentMessage; live?: LiveState;", "message?: AgentMessage; live?: LiveState; transcript?: string;");
  bridge = replace(bridge, "message: isMessage(value.message)", "transcript: typeof value.transcript === 'string' && value.transcript.length <= 8192 ? value.transcript : undefined,\n      message: isMessage(value.message)");
  bridge = replace(bridge, "send({ kind: 'event', name: 'started', text: child });", "send({ kind: 'event', name: 'started', text: child, transcript: trustedTranscript(children.history.records.get(child)?.sessionFile, join(directory, 'runs')) ?? undefined });", 2);
  window = replace(window, "started = true; showLive(); title('working');", "started = true; showLive(); title('working');\n      if (event.transcript) pi.events.emit('optchat:transcript', { path: event.transcript });");
  // Validate every anchor before writing anything; leave a previous installation intact on failure.
  const temporary = `${destination}.next-${process.pid}`;
  mkdirSync(dirname(destination), { recursive: true });
  try {
    cpSync(source, temporary, { recursive: true });
    writeFileSync(join(temporary, "src/window-bridge.ts"), bridge);
    writeFileSync(join(temporary, "src/connected-window.ts"), window);
    cpSync(join(import.meta.dir, "herdr-session.ts"), join(temporary, "src/herdr-session.ts"));
    const adapter = join(temporary, "herdr");
    mkdirSync(adapter);
    for (const name of ["herdr-session.ts", "extension.ts"]) cpSync(join(import.meta.dir, name), join(adapter, name));
    if (existsSync(destination)) {
      const backup = `${destination}.backup-${Date.now()}`;
      renameSync(destination, backup);
    }
    renameSync(temporary, destination);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error("Usage: bun integrations/pi-optchat/install.ts <npm-package-directory> <local-install-directory>");
  installConnectedPatch(resolve(source), resolve(destination));
  console.log(`Installed connected transcript reporting at ${resolve(destination)}`);
}
