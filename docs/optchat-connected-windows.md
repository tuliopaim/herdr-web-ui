# OptChat connected-window transcript reporting

The bridge accepts explicit `herdr:pi` reports inside the fixed personal/work OptChat
`memory/profiles/main/runs` stores, as well as their normal session stores. It does not
search runs, choose a transcript by cwd, or infer a trusted root from a reported path.
A process-owned custom session store still takes precedence over all fallback stores.

## Cause in stock pi-optchat 0.8.9

A connected window is a separate Pi UI, but the original OptChat process owns the
agent and writes its actual Pi transcript under its profile's `runs` directory.
Herdr's managed `herdr-agent-state.ts` reports the connected window's local
`ctx.sessionManager.getSessionFile()` at `session_start`. That local file can remain
unwritten: the window displays custom messages, not a local assistant response.
Consequently, accepting the correct store alone does not fix the stale session reference.

OptChat's `src/window-bridge.ts` sends a `started` event naming the run ID, but
`WindowEvent` does not carry its transcript path. `src/connected-window.ts` knows the
remote run ID, yet never publishes its actual transcript to Herdr. The managed Herdr
extension only knows its local session manager. Parent and connected windows must not
share a guessed transcript merely because their cwd or profile matches.

## Maintained local integration

`integrations/pi-optchat/install.ts` builds a local overlay of the pinned 0.8.9
package. It carries the owner's explicit `sessionFile` on both start and attach,
validates canonical containment in that profile's `runs` directory, and emits
`optchat:transcript` in the receiving window only. No cwd search or guessed run ID
is used. Missing fields remain compatible with older owners, but cannot repair them.

The companion adapter loads Herdr's generated extension unmodified. It reports a
`resume` lifecycle through that extension's own session handler and sequence counter,
then retains the authoritative reference for later state reports. An independent
`herdr:pi` reporter would advance the shared sequence and suppress the managed
extension's future state updates. Completion and disconnection retain the final
transcript; the next real Pi session start restores the local session manager.

Install from the cached **unmodified** npm package (not an already-patched overlay):

```sh
bun integrations/pi-optchat/install.ts "$PACKAGE_ROOT" "$HOME/.local/share/herdr/pi-optchat-0.8.9"
bun integrations/pi-optchat/configure-wrapper.ts "$HOME/dotfiles/scripts/pi-opt"
```

The installer validates the pinned version and every changed source anchor before
writing, retains any previous installation as a backup, and never modifies npm's
cache. The wrapper uses the overlay for both personal and work modes. A machine
without it retains its pinned npm installation. This does not update or restart an
already-running owner: **both the owner and receiving window must load the overlay**
for automatic publication. Existing sessions remain untouched.

Verification, without model calls or user sessions:

```sh
bun test scripts/optchat-session.test.ts
bun integrations/pi-optchat/protocol-regression.ts "$HOME/.local/share/herdr/pi-optchat-0.8.9"
bun integrations/pi-optchat/managed-regression.ts "$HOME/.pi/agent/extensions/herdr-agent-state.ts"
```

The protocol regression goes red against stock 0.8.9 and green against the overlay.
It covers simultaneous windows, attach/reattach, completion, and rejecting foreign
paths. The managed regression exercises the installed, unmodified Herdr extension
against an isolated Unix socket, checking resume lifecycle and session/state ordering.

## Immediate repair performed before this patch

The live session was repaired by explicitly reporting its verified run path with
`pane.report_agent_session`, `source: "herdr:pi"`, and `session_start_source: "resume"`.
The lifecycle reason is required for Herdr to accept this replacement. This is an
immediate per-window repair, not automatic publishing for future connected windows.
No transcript is copied, linked, or modified.
