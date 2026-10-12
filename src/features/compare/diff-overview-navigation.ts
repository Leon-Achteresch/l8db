import { diffOverviewLine } from "@/features/compare/diff-navigation";
import { monaco } from "@/lib/monaco";

export function attachDiffOverviewNavigation(
  container: HTMLElement,
  diff: monaco.editor.IStandaloneDiffEditor,
  onNavigate: (side: "original" | "modified") => void,
): () => void {
  let down: { pointerId: number; x: number; y: number; ruler: Element } | null = null;
  const pointerDown = (event: PointerEvent) => {
    down = null;
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const ruler = event.target.closest(".diffOverview");
    if (ruler && container.contains(ruler)) {
      down = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ruler };
    }
  };
  const pointerUp = (event: PointerEvent) => {
    const start = down;
    down = null;
    if (
      !start ||
      start.pointerId !== event.pointerId ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4
    )
      return;
    const bounds = start.ruler.getBoundingClientRect();
    const side = event.clientX < bounds.left + bounds.width / 2 ? "original" : "modified";
    const editor = side === "original" ? diff.getOriginalEditor() : diff.getModifiedEditor();
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const markers = (diff.getLineChanges() ?? []).flatMap((change) => {
      const line =
        side === "original" ? change.originalStartLineNumber : change.modifiedStartLineNumber;
      const end = side === "original" ? change.originalEndLineNumber : change.modifiedEndLineNumber;
      return end === 0
        ? []
        : [{ line, top: editor.getTopForLineNumber(line), height: (end - line + 1) * lineHeight }];
    });
    const line = diffOverviewLine(
      markers,
      event.clientY - bounds.top,
      bounds.height,
      editor.getScrollHeight(),
    );
    if (line === null) return;
    onNavigate(side);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.revealLineInCenter(line);
    editor.focus();
  };
  const pointerCancel = () => {
    down = null;
  };
  container.addEventListener("pointerdown", pointerDown, true);
  const document = container.ownerDocument;
  document.addEventListener("pointerup", pointerUp, true);
  document.addEventListener("pointercancel", pointerCancel, true);
  return () => {
    container.removeEventListener("pointerdown", pointerDown, true);
    document.removeEventListener("pointerup", pointerUp, true);
    document.removeEventListener("pointercancel", pointerCancel, true);
  };
}
