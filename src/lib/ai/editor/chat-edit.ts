import type { EditorAiController } from "./controller";
import { applyEditBlocks } from "./edit-format";

export interface ChatEditorAnswer {
  ok: boolean;
  text: string;
}

type ChatController = Pick<EditorAiController, "text" | "chatEdit" | "getSession">;

export interface ChatEditorTab {
  id: string;
  title: string;
  sql: string;
}

export interface ChatSourceObject {
  schema: string;
  name: string;
  type: string;
}

export interface ChatEditorTarget {
  tabs: () => ChatEditorTab[];
  visibleId: () => string | null;
  controller: (id: string) => ChatController | undefined;
  show: (id: string) => Promise<ChatController | undefined>;
  openTab: (sql: string, title: string) => string;
  loadSource: (object: ChatSourceObject) => Promise<string>;
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

function excerpt(text: string): string {
  return text.length > READ_LIMIT
    ? `${text.slice(0, READ_LIMIT)}\n… (gekürzt, ${text.length} Zeichen insgesamt)`
    : text;
}

function sourceObject(value: unknown): ChatSourceObject | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const field = (key: string) => (typeof entry[key] === "string" ? String(entry[key]).trim() : "");
  const object = {
    schema: field("schema"),
    name: field("name"),
    type: field("type").toUpperCase(),
  };
  return object.schema && object.name && object.type ? object : null;
}

function listText(target: ChatEditorTarget): string {
  const tabs = target.tabs();
  if (!tabs.length) return "Keine Abfrage-Tabs geöffnet.";
  const visible = target.visibleId();
  return tabs
    .map(
      (tab) =>
        `${tab.id} · "${tab.title}" · ${lineCount(target.controller(tab.id)?.text() ?? tab.sql)} Zeilen${tab.id === visible ? " · sichtbar" : ""}`,
    )
    .join("\n");
}

export async function handleChatEditorRequest(
  details: unknown,
  target: ChatEditorTarget,
): Promise<ChatEditorAnswer> {
  const args = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  const summary = typeof args.summary === "string" ? args.summary.trim().slice(0, 80) : "";
  const label = summary ? `KI-Chat: ${summary}` : "KI-Chat";
  const sql = typeof args.sql === "string" ? args.sql : null;
  if (args.action === "list") return { ok: true, text: listText(target) };
  if (args.action === "open") {
    const object = args.object === undefined ? null : sourceObject(args.object);
    if (args.object !== undefined && !object)
      return { ok: false, text: "object braucht schema, name und type." };
    if (object) {
      const source = await target.loadSource(object);
      const id = target.openTab(source, `${object.name} (${object.type})`);
      return {
        ok: true,
        text: `Tab ${id} mit ${object.schema}.${object.name} (${object.type}) geöffnet, ${lineCount(source)} Zeilen:\n${excerpt(source)}`,
      };
    }
    if (sql === null || !sql.trim()) return { ok: false, text: "object oder sql angeben." };
    const id = target.openTab(sql, summary || "KI-Abfrage");
    return { ok: true, text: `Neuer Tab ${id} geöffnet.` };
  }
  const tabs = target.tabs();
  const requested = typeof args.tab === "string" && args.tab ? args.tab : null;
  const tabId =
    requested ?? target.visibleId() ?? (tabs.length === 1 ? (tabs[0]?.id ?? null) : null);
  const tab = tabId ? tabs.find((entry) => entry.id === tabId) : undefined;
  if (requested && !tab)
    return { ok: false, text: `Tab ${requested} gibt es nicht. Offene Tabs:\n${listText(target)}` };
  const current = tab ? (target.controller(tab.id)?.text() ?? tab.sql) : null;
  if (args.action === "read") {
    if (!tab || current === null)
      return {
        ok: false,
        text: tabs.length
          ? `Kein Tab gewählt. tab angeben. Offene Tabs:\n${listText(target)}`
          : 'Kein Abfrage-Tab geöffnet. Mit action "open" einen öffnen.',
      };
    if (!current.trim()) return { ok: true, text: `Tab ${tab.id} "${tab.title}" ist leer.` };
    return {
      ok: true,
      text: `Tab ${tab.id} "${tab.title}", ${lineCount(current)} Zeilen:\n${excerpt(current)}`,
    };
  }
  if (args.action !== "edit")
    return { ok: false, text: 'action muss "list", "read", "open" oder "edit" sein.' };
  const blocks = args.edits === undefined ? null : edits(args.edits);
  if (args.edits !== undefined && !blocks)
    return { ok: false, text: "edits braucht 1 bis 20 Einträge mit search und replace." };
  if (!blocks && sql === null) return { ok: false, text: "edits oder sql angeben." };
  if (!tab || current === null) {
    if (tabs.length)
      return {
        ok: false,
        text: `Kein Tab gewählt. tab angeben. Offene Tabs:\n${listText(target)}`,
      };
    if (sql === null || !sql.trim())
      return { ok: false, text: "Kein Abfrage-Tab geöffnet. Für einen neuen Tab sql angeben." };
    const id = target.openTab(sql, summary || "KI-Abfrage");
    return { ok: true, text: `Kein Tab war offen: neuer Tab ${id} mit der SQL geöffnet.` };
  }
  let next: string;
  if (blocks) {
    const result = applyEditBlocks(current, blocks);
    if (!result.ok) return { ok: false, text: `${result.error} Mit action "read" neu lesen.` };
    next = result.text;
  } else next = sql ?? "";
  if (next === current) return { ok: true, text: "Keine Änderung: der Text ist bereits so." };
  const controller = await target.show(tab.id);
  if (!controller)
    return { ok: false, text: `Der Editor von Tab ${tab.id} ließ sich nicht öffnen.` };
  if (controller.text() !== current)
    return { ok: false, text: 'Der Text hat sich geändert. Mit action "read" neu lesen.' };
  const problem = await controller.chatEdit(next, label);
  if (problem) return { ok: false, text: problem };
  const pending = controller.getSession()?.getSnapshot().pending ?? 0;
  return {
    ok: true,
    text: pending
      ? `In Tab ${tab.id} angewendet (${lineCount(next)} Zeilen). ${pending} Änderung(en) warten auf Annahme durch den Nutzer; der Editor zeigt sie schon an.`
      : `In Tab ${tab.id} angewendet.`,
  };
}
