import { useEffect } from "react";

const HIGHLIGHT_CLASSES = ["ring-2", "ring-inset", "ring-primary/70"];
const MAX_ATTEMPTS = 40;

export function highlightCells(root: ParentNode, column: string): HTMLElement[] {
  const selector = `td[data-col="${CSS.escape(column)}"]`;
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

interface TableColumnHighlightProps {
  column: string | undefined;
}

export function TableColumnHighlight({ column }: TableColumnHighlightProps) {
  useEffect(() => {
    if (!column) return;
    let attempts = 0;
    let frame = 0;
    let cells: HTMLElement[] = [];
    const tick = () => {
      cells = highlightCells(document, column);
      if (cells.length > 0) {
        for (const cell of cells) cell.classList.add(...HIGHLIGHT_CLASSES);
        cells[0]?.scrollIntoView({ block: "nearest", inline: "center" });
        return;
      }
      attempts += 1;
      if (attempts < MAX_ATTEMPTS) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const cell of cells) cell.classList.remove(...HIGHLIGHT_CLASSES);
    };
  }, [column]);
  return null;
}
