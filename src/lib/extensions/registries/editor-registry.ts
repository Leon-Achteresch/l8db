import { type Disposable, ExtensionError } from "@/lib/extensions/contracts";
import type {
  EditorContext,
  EditorKind,
  EditorText,
  EditorTextChange,
  HiddenRange,
} from "../../../../packages/extension-api/src";

export const HIDDEN_RANGE_LIMIT = 10_000;

export interface EditorSource {
  kind: EditorKind;
  connectionKind: string;
  text(): string;
  lineCount(): number;
  watch(listener: () => void): Disposable;
  hide(ranges: HiddenRange[]): void;
}

interface EditorEntry {
  source: EditorSource;
  version: number;
  watch?: Disposable;
  hidden: Map<string, HiddenRange[]>;
  checked: Map<string, string>;
}

function merge(ranges: HiddenRange[]): HiddenRange[] {
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const merged: HiddenRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.startLine <= last.endLine + 1)
      last.endLine = Math.max(last.endLine, range.endLine);
    else merged.push({ startLine: range.startLine, endLine: range.endLine });
  }
  return merged;
}

export function validateHiddenRanges(value: unknown, lineCount: number): HiddenRange[] {
  if (!Array.isArray(value) || value.length > HIDDEN_RANGE_LIMIT)
    throw new ExtensionError("ProtocolError", `Expected at most ${HIDDEN_RANGE_LIMIT} ranges`);
  for (const range of value) {
    const { startLine, endLine } = (range ?? {}) as HiddenRange;
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine))
      throw new ExtensionError("ProtocolError", "Range lines must be integers");
    if (startLine < 1 || endLine > lineCount || startLine > endLine)
      throw new ExtensionError(
        "ProtocolError",
        `Range ${startLine}-${endLine} is outside the document (1-${lineCount})`,
      );
  }
  return merge(value as HiddenRange[]);
}

export class EditorRegistry {
  private editors = new Map<string, EditorEntry>();
  private listeners = new Map<string, (event: EditorTextChange) => void>();
  constructor(private readonly onChange: () => void = () => undefined) {}
  register(id: string, source: EditorSource): Disposable {
    this.remove(id);
    const entry: EditorEntry = { source, version: 1, hidden: new Map(), checked: new Map() };
    this.editors.set(id, entry);
    if (this.listeners.size) this.track(id, entry);
    this.onChange();
    return {
      dispose: () => {
        if (this.editors.get(id) !== entry) return;
        this.remove(id);
        this.onChange();
      },
    };
  }
  has(id: string) {
    return this.editors.has(id);
  }
  size() {
    return this.editors.size;
  }
  context(id: string): EditorContext {
    const { source } = this.get(id);
    return { editorId: id, editorKind: source.kind, connectionKind: source.connectionKind };
  }
  read(id: string): EditorText {
    const entry = this.get(id);
    this.track(id, entry);
    return { text: entry.source.text(), version: entry.version };
  }
  subscribe(owner: string, listener: (event: EditorTextChange) => void): Disposable {
    this.listeners.set(owner, listener);
    for (const [id, entry] of this.editors) this.track(id, entry);
    return {
      dispose: () => {
        if (this.listeners.get(owner) === listener) this.listeners.delete(owner);
      },
    };
  }
  setHidden(owner: string, id: string, version: unknown, ranges: unknown) {
    const entry = this.get(id);
    if (version !== entry.version)
      throw new ExtensionError(
        "StaleEditorVersionError",
        `${id} is at version ${entry.version}, not ${String(version)}`,
      );
    const lineCount = entry.source.lineCount();
    const validated = validateHiddenRanges(ranges, lineCount);
    const others = [...entry.hidden].flatMap(([key, value]) => (key === owner ? [] : value));
    const all = others.length ? merge([...others, ...validated]) : validated;
    if (all[0]?.startLine === 1 && all[0].endLine === lineCount)
      throw new ExtensionError("ProtocolError", "Hidden ranges must leave a visible line");
    if (validated.length) entry.hidden.set(owner, validated);
    else entry.hidden.delete(owner);
    this.track(id, entry);
    entry.source.hide(all);
  }
  clearHidden(owner: string, id: string) {
    const entry = this.editors.get(id);
    if (entry?.hidden.delete(owner)) this.apply(entry);
  }
  hiddenRanges(id: string): HiddenRange[] {
    const entry = this.editors.get(id);
    return entry ? merge([...entry.hidden.values()].flat()) : [];
  }
  reveal(id: string, line: number) {
    const entry = this.editors.get(id);
    const target = this.hiddenRanges(id).find(
      (range) => range.startLine <= line && line <= range.endLine,
    );
    if (!entry || !target) return;
    for (const [owner, ranges] of entry.hidden) {
      const kept = ranges.filter(
        (range) => range.endLine < target.startLine || range.startLine > target.endLine,
      );
      if (kept.length) entry.hidden.set(owner, kept);
      else entry.hidden.delete(owner);
    }
    this.apply(entry);
  }
  setChecked(owner: string, command: string, id: string, checked: boolean) {
    const entry = this.get(id);
    if (checked) entry.checked.set(command, owner);
    else entry.checked.delete(command);
    this.onChange();
  }
  isChecked(id: string, command: string) {
    return this.editors.get(id)?.checked.has(command) ?? false;
  }
  clear(owner: string) {
    this.listeners.delete(owner);
    for (const entry of this.editors.values()) {
      for (const [command, commandOwner] of entry.checked)
        if (commandOwner === owner) entry.checked.delete(command);
      if (entry.hidden.delete(owner)) this.apply(entry);
    }
  }
  private get(id: string) {
    const entry = this.editors.get(id);
    if (!entry) throw new ExtensionError("EditorNotFoundError", id);
    return entry;
  }
  private remove(id: string) {
    const entry = this.editors.get(id);
    if (!entry) return;
    entry.watch?.dispose();
    this.editors.delete(id);
  }
  private apply(entry: EditorEntry) {
    entry.source.hide(merge([...entry.hidden.values()].flat()));
  }
  private track(id: string, entry: EditorEntry) {
    entry.watch ??= entry.source.watch(() => {
      entry.version += 1;
      if (entry.hidden.size) {
        entry.hidden.clear();
        entry.source.hide([]);
      }
      if (!this.listeners.size) {
        entry.watch?.dispose();
        entry.watch = undefined;
        return;
      }
      for (const listener of this.listeners.values())
        listener({ editorId: id, version: entry.version });
    });
  }
}
