import type { monaco } from "@/lib/monaco";

export interface ScrollSyncGroup {
  enabled: boolean;
  syncing: boolean;
  editors: Set<monaco.editor.ICodeEditor>;
}

export function createScrollSyncGroup(): ScrollSyncGroup {
  return { enabled: false, syncing: false, editors: new Set() };
}

export function joinScrollSyncGroup(
  group: ScrollSyncGroup,
  editor: monaco.editor.ICodeEditor,
): () => void {
  group.editors.add(editor);
  const listener = editor.onDidScrollChange((event) => {
    if (!group.enabled || group.syncing || !(event.scrollTopChanged || event.scrollLeftChanged))
      return;
    group.syncing = true;
    for (const other of group.editors)
      if (other !== editor)
        other.setScrollPosition({ scrollTop: event.scrollTop, scrollLeft: event.scrollLeft });
    group.syncing = false;
  });
  return () => {
    listener.dispose();
    group.editors.delete(editor);
  };
}
