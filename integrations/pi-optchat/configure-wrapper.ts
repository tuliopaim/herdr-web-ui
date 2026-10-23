import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export function configureWrapper(path: string) {
  const original = readFileSync(path, "utf8");
  if (original.includes("# OptChat connected transcript overlay (pi-optchat 0.8.9).")) return;
  const bridge = 'bridge="$HOME/.pi/agent/extensions/herdr-agent-state.ts"';
  const choices = ["npm:pi-optchat@0.8.9", '"$HOME/dotfiles/pi/vendor/pi-optchat/src/index.ts"'];
  const selected = choices.filter(value => original.includes(`--extension ${value}`));
  if (selected.length !== 1) throw new Error("Unsupported pi-opt wrapper; left unchanged");
  const extension = `--extension ${selected[0]}`;
  if (original.split(bridge).length !== 2 || original.split(extension).length !== 2) throw new Error("Unsupported pi-opt wrapper; left unchanged");
  const replacement = `${bridge}
# OptChat connected transcript overlay (pi-optchat 0.8.9).
optchat_extension=${selected[0]}
optchat_local="$HOME/.local/share/herdr/pi-optchat-0.8.9"
if [[ -f "$bridge" && -f "$optchat_local/src/index.ts" && -f "$optchat_local/herdr/extension.ts" ]]; then
    optchat_extension="$optchat_local/src/index.ts"
    bridge="$optchat_local/herdr/extension.ts"
fi`;
  const next = original.replace(bridge, replacement).replace(extension, '--extension "$optchat_extension"');
  const backups = join(homedir(), ".local", "state", "herdr", "optchat-wrapper-backups");
  mkdirSync(backups, { recursive: true });
  copyFileSync(path, join(backups, `${basename(path)}-${Date.now()}`));
  writeFileSync(path, next);
}
if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: bun integrations/pi-optchat/configure-wrapper.ts <pi-opt-wrapper>");
  configureWrapper(path);
  console.log("Configured connected transcript overlay (existing sessions unchanged)");
}
