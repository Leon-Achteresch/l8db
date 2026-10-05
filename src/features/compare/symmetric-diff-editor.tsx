import { useTheme } from "next-themes";
import { type Ref, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { DefinitionDiffApi, DiffStats } from "@/features/compare/definition-diff-editor";
import { type DefinitionHunk, definitionHunks, unchangedLineRanges } from "@/lib/definition-merge";
import { monaco } from "@/lib/monaco";
import { createScrollSyncGroup, joinScrollSyncGroup } from "@/lib/monaco/scroll-sync";
import "./symmetric-diff-editor.css";

type Side = "source" | "draft";

interface SideEditor {
  instance: monaco.editor.IStandaloneCodeEditor;
  decorations: monaco.editor.IEditorDecorationsCollection;
  zones: string[];
}

function bounds(hunk: DefinitionHunk, side: Side): [number, number] {
  return side === "source" ? [hunk.sourceStart, hunk.sourceEnd] : [hunk.draftStart, hunk.draftEnd];
}

function ghostNode(lines: string[]): HTMLElement {
  const node = document.createElement("div");
  node.className = "symmetric-diff-ghost";
  for (const line of lines) {
    const row = document.createElement("div");
    row.textContent = line || " ";
    node.appendChild(row);
  }
  return node;
}

function mount(container: HTMLDivElement): SideEditor {
  const instance = monaco.editor.create(container, {
    model: monaco.editor.createModel("", "sql"),
    readOnly: true,
    theme: "l8db-light",
    automaticLayout: true,
    minimap: { enabled: true, renderCharacters: false },
    scrollBeyondLastLine: false,
    fontSize: 13,
    lineHeight: 22,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    padding: { top: 12, bottom: 12 },
    scrollbar: {
      vertical: "auto",
      horizontal: "auto",
      useShadows: false,
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
    },
  });
  return { instance, decorations: instance.createDecorationsCollection(), zones: [] };
}

function render(
  editor: SideEditor,
  side: Side,
  own: string,
  other: string,
  hunks: DefinitionHunk[],
  onlyDifferences: boolean,
) {
  const model = editor.instance.getModel();
  if (!model) return;
  if (model.getValue() !== own) model.setValue(own);
  const otherLines = other.split("\n");
  const otherSide: Side = side === "source" ? "draft" : "source";
  editor.decorations.set(
    hunks.flatMap((hunk) => {
      const [start, end] = bounds(hunk, side);
      if (end <= start) return [];
      return [
        {
          range: new monaco.Range(start + 1, 1, end, 1),
          options: {
            isWholeLine: true,
            className: "symmetric-diff-own",
            minimap: { color: "#9bb955", position: monaco.editor.MinimapPosition.Inline },
            overviewRuler: { color: "#9bb955", position: monaco.editor.OverviewRulerLane.Full },
          },
        },
      ];
    }),
  );
  editor.instance.changeViewZones((accessor) => {
    for (const id of editor.zones) accessor.removeZone(id);
    editor.zones = hunks.flatMap((hunk) => {
      const [otherStart, otherEnd] = bounds(hunk, otherSide);
      if (otherEnd <= otherStart) return [];
      const lines = otherLines.slice(otherStart, otherEnd);
      return [
        accessor.addZone({
          afterLineNumber: bounds(hunk, side)[0],
          heightInLines: lines.length,
          domNode: ghostNode(lines),
          marginDomNode: ghostNode([]),
        }),
      ];
    });
  });
  const hidden = onlyDifferences
    ? unchangedLineRanges(hunks, side, model.getLineCount()).map(
        (range) => new monaco.Range(range.start, 1, range.end, 1),
      )
    : [];
  (
    editor.instance as unknown as { setHiddenAreas: (ranges: monaco.IRange[]) => void }
  ).setHiddenAreas(hidden);
}

interface Props {
  original: string;
  modified: string;
  onlyDifferences: boolean;
  onStats?: (stats: DiffStats) => void;
  ref?: Ref<DefinitionDiffApi>;
}

export function SymmetricDiffEditor({ original, modified, onlyDifferences, onStats, ref }: Props) {
  const leftContainer = useRef<HTMLDivElement>(null);
  const rightContainer = useRef<HTMLDivElement>(null);
  const editors = useRef<{ left: SideEditor; right: SideEditor } | null>(null);
  const indexRef = useRef(-1);
  const { resolvedTheme } = useTheme();
  const hunks = useMemo(() => definitionHunks(original, modified), [original, modified]);
  const statsRef = useRef(onStats);
  statsRef.current = onStats;

  useEffect(() => {
    if (!leftContainer.current || !rightContainer.current) return;
    const left = mount(leftContainer.current);
    const right = mount(rightContainer.current);
    const group = createScrollSyncGroup();
    group.enabled = true;
    const leaveLeft = joinScrollSyncGroup(group, left.instance);
    const leaveRight = joinScrollSyncGroup(group, right.instance);
    editors.current = { left, right };
    return () => {
      leaveLeft();
      leaveRight();
      for (const editor of [left, right]) {
        const model = editor.instance.getModel();
        editor.instance.dispose();
        model?.dispose();
      }
      editors.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editors.current) return;
    indexRef.current = -1;
    render(editors.current.left, "source", original, modified, hunks, onlyDifferences);
    render(editors.current.right, "draft", modified, original, hunks, onlyDifferences);
    statsRef.current?.({
      changes: hunks.length,
      added: hunks.reduce((sum, hunk) => sum + hunk.draftEnd - hunk.draftStart, 0),
      removed: hunks.reduce((sum, hunk) => sum + hunk.sourceEnd - hunk.sourceStart, 0),
    });
  }, [original, modified, hunks, onlyDifferences]);

  useEffect(() => {
    if (editors.current)
      monaco.editor.setTheme(resolvedTheme === "dark" ? "l8db-dark" : "l8db-light");
  }, [resolvedTheme]);

  useImperativeHandle(ref, () => ({
    goToChange(direction) {
      const left = editors.current?.left.instance;
      if (!left || hunks.length === 0) return;
      indexRef.current = (indexRef.current + direction + hunks.length * 2) % hunks.length;
      const line = Math.max(hunks[indexRef.current].sourceStart, 1);
      left.revealLineInCenter(line);
      left.setPosition({ lineNumber: line, column: 1 });
      left.focus();
    },
  }));

  return (
    <div className="symmetric-diff-editor flex h-full min-h-0 w-full">
      <div ref={leftContainer} className="min-w-0 flex-1" />
      <div ref={rightContainer} className="min-w-0 flex-1 border-l" />
    </div>
  );
}
