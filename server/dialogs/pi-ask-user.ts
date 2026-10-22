import type { DialogReader } from "./registry.ts";
import { ANSI_RE, KEY, type ParsedPrompt, cleanLine, findLastIndex, finishPrompt, isDivider, keySteps, normalizeText } from "./shared.ts";

export const PI_ASK_USER_HINT_RE = /^↑↓ or 1-([3-6]) select • Enter confirm • Esc dismiss$/;
export const PI_ASK_USER_INPUT_HINT_RE = /^Enter submit • Esc back$/;

// The local Pi ask_user extension draws numbered choices, then an unnumbered pencil row.
// That row opens an editor. It is a separate prompt so text is never sent before it exists.
export function parsePiAskUser(screen: string): ParsedPrompt | null {
  const lines = screen.replace(ANSI_RE, "").split(/\r?\n/);
  const close = findLastIndex(lines, (line) => isDivider(line));
  if (close < 0) return null;
  const tail = lines.slice(close + 1).map(cleanLine).filter(Boolean);
  if (tail.length > 2 || tail.some((line) => /^[❯›>$]/.test(line))) return null;
  let hint = close - 1;
  while (hint >= 0 && !cleanLine(lines[hint]!)) hint -= 1;
  let hintStart = hint;
  let editing = false;
  let count = 0;
  for (let size = 1; size <= 4 && hint - size + 1 >= 0; size += 1) {
    const text = normalizeText(lines.slice(hint - size + 1, hint + 1).join(" "));
    const menu = PI_ASK_USER_HINT_RE.exec(text);
    if (menu || PI_ASK_USER_INPUT_HINT_RE.test(text)) {
      hintStart = hint - size + 1;
      editing = !menu;
      count = menu ? Number(menu[1]) : 0;
      break;
    }
  }
  if (!editing && !count) return null;
  let contentEnd = hintStart;
  if (editing) {
    const answer = findLastIndex(lines.slice(0, hintStart), (line) => cleanLine(line) === "Your answer:");
    if (answer < 0) return null;
    const editor = lines.slice(answer + 1, hintStart).filter((line) => cleanLine(line));
    // A nonempty editor belongs to whoever is typing in the terminal, not a web answer.
    if (editor.length !== 2 || !editor.every(isDivider)) return null;
    contentEnd = answer;
  }
  const start = findLastIndex(lines.slice(0, contentEnd), (line) => isDivider(line));
  if (start < 0) return null;
  const block = lines.slice(start + 1, contentEnd);
  const first = block.findIndex((line) => /^ (?:❯ |  )1\. /.test(line));
  if (first < 0) return null;
  const question = normalizeText(block.slice(0, first).join(" "));
  if (!question) return null;
  const rows: { label: string; description: string | null; selected: boolean; custom: boolean }[] = [];
  for (const raw of block.slice(first)) {
    if (!cleanLine(raw)) continue;
    const match = /^ (❯ |  )(?:(\d)\. (.+)|✎ (Write my own answer…))\s*$/.exec(raw);
    if (match) {
      if (rows.at(-1)?.custom || (match[2] && Number(match[2]) !== rows.length + 1)) return null;
      rows.push({ label: (match[3] ?? match[4])!.trim(), description: null, selected: match[1] === "❯ ", custom: !match[2] });
      continue;
    }
    const row = rows.at(-1);
    if (!row || row.custom) return null;
    if (/^ {6}\S/.test(raw)) row.description = normalizeText([row.description, raw.trim()].filter(Boolean).join(" "));
    else if (/^ {3}\S/.test(raw) && !row.description) row.label = normalizeText(`${row.label} ${raw.trim()}`);
    else return null;
  }
  if (rows.length < 3 || rows.length > 6 || !rows.at(-1)?.custom || rows.filter((row) => row.selected).length !== 1) return null;
  if (!editing && count !== rows.length) return null;
  const selectedIndex = rows.findIndex((row) => row.selected);
  if (editing && selectedIndex !== rows.length - 1) return null;
  const options = editing
    ? [{ label: "Type your answer", description: null }, { label: "Back", description: null }]
    : [...rows.map(({ label, description }) => ({ label, description })), { label: "Dismiss", description: null }];
  return finishPrompt("pi", {
    kind: "question", title: "", question, body: null, options,
    multi_select: false, custom_option_index: editing ? 0 : null,
  }, {
    responder: editing ? "pi-ask-user-input" : "pi-ask-user",
    menuLabels: rows.map((row) => row.label), selectedIndex: editing ? 0 : selectedIndex,
    checkedOptionIndices: [], customMenuIndex: editing ? 0 : null,
    rejectWithEscapeIndex: editing ? 1 : rows.length,
    ...(editing ? { customSteps: (text: string) => [{ text }, ...keySteps([KEY.enter])] } : {}),
  }, { call: JSON.stringify(rows.map(({ label, description }) => ({ label, description }))) });
}

export const readers: readonly DialogReader[] = (["pi-ask-user", "pi-ask-user-input"] as const).map((id) => ({
  id, agents: ["pi"], priority: 80, reread: "before-commit", list: "none",
  parse: (screen: string) => {
    const prompt = parsePiAskUser(screen);
    return prompt?.responder === id ? prompt : null;
  },
}));
