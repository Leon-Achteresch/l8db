import type { EditorAiController } from "./controller";
import { applyEditBlocks } from "./edit-format";

export interface ChatEditorAnswer {
  ok: boolean;
  text: string;
}

export interface ChatEditorTarget {
  controller: Pick<EditorAiController, "text" | "chatEdit" | "getSession"> | undefined;
  title: string;
  storedSql: string | null;
  openTab: (sql: string, title: string) => void;
}

const READ_LIMIT = 40_000;

function edits(value: unknown): { search: string; replace: string }[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 20) return null;
  const parsed = value.map((entry) =>
    entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {},
  );
  if (
    !parsed.every((entry) => typeof entry.search === "string" && typeof entry.replace === "string")
  )
    return null;
  return parsed.map((entry) => ({ search: String(entry.search), replace: String(entry.replace) }));
}

function lineCount(text: string): number {
  return text ? text.split("\n").length : 0;
}

export async function handleChatEditorRequest(
  details: unknown,
  target: ChatEditorTarget,
): Promise<ChatEditorAnswer> {
  const args = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  const controller = target.controller;
  const current = controller ? controller.text() : target.storedSql;
  const summary = typeof args.summary === "string" ? args.summary.trim().slice(0, 80) : "";
  const label = summary ? `KI-Chat: ${summary}` : "KI-Chat";
  if (args.action === "read") {
    if (current === null) return { ok: false, text: "Kein Abfrage-Tab geöffnet." };
    if (!current.trim()) return { ok: true, text: `Tab "${target.title}" ist leer.` };
    const body =
      current.length > READ_LIMIT
        ? `${current.slice(0, READ_LIMIT)}\n… (gekürzt, ${current.length} Zeichen insgesamt)`
        : current;
    return { ok: true, text: `Tab "${target.title}", ${lineCount(current)} Zeilen:\n${body}` };
  }
  if (args.action !== "edit") return { ok: false, text: 'action muss "read" oder "edit" sein.' };
  const blocks = args.edits === undefined ? null : edits(args.edits);
  const sql = typeof args.sql === "string" ? args.sql : null;
  if (args.edits !== undefined && !blocks)
    return { ok: false, text: "edits braucht 1 bis 20 Einträge mit search und replace." };
  if (!blocks && sql === null) return { ok: false, text: "edits oder sql angeben." };
  if (current === null) {
    if (sql === null || !sql.trim())
      return { ok: false, text: "Kein Abfrage-Tab geöffnet. Für einen neuen Tab sql angeben." };
    target.openTab(sql, summary || "KI-Abfrage");
    return { ok: true, text: "Kein Tab war offen: neuer Abfrage-Tab mit der SQL geöffnet." };
  }
  if (!controller) return { ok: false, text: "Der Editor dieses Tabs ist gerade nicht sichtbar." };
  let next: string;
  if (blocks) {
    const result = applyEditBlocks(current, blocks);
    if (!result.ok) return { ok: false, text: `${result.error} Mit action "read" neu lesen.` };
    next = result.text;
  } else next = sql ?? "";
  if (next === current) return { ok: true, text: "Keine Änderung: der Text ist bereits so." };
  const problem = await controller.chatEdit(next, label);
  if (problem) return { ok: false, text: problem };
  const pending = controller.getSession()?.getSnapshot().pending ?? 0;
  return {
    ok: true,
    text: pending
      ? `Im Editor angewendet (${lineCount(next)} Zeilen). ${pending} Änderung(en) warten auf Annahme durch den Nutzer; der Editor zeigt sie schon an.`
      : "Im Editor angewendet.",
  };
}
