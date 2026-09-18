import {
  type Disposable,
  ExtensionError,
  type ExtensionManifest,
  type TreeItem,
  type ViewSnapshot,
} from "@/lib/extensions/contracts";

const treeIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
export class ViewRegistry {
  private views = new Map<
    string,
    { owner: string; title: string; location: "sidebar" | "panel" }
  >();
  private trees = new Map<string, TreeItem[]>();
  reserve(manifest: ExtensionManifest): Disposable {
    const entries = manifest.contributes?.views ?? [];
    for (const view of entries)
      if (this.views.has(view.id)) throw new ExtensionError("DuplicateViewError", view.id);
    for (const view of entries)
      this.views.set(view.id, { owner: manifest.id, title: view.title, location: view.location });
    return {
      dispose: () => {
        for (const view of entries) {
          this.views.delete(view.id);
          this.trees.delete(view.id);
        }
      },
    };
  }
  owner(viewId: string) {
    return this.views.get(viewId)?.owner;
  }
  setTree(owner: string, viewId: string, items: TreeItem[]) {
    if (this.views.get(viewId)?.owner !== owner)
      throw new ExtensionError("ViewNotFoundError", viewId);
    this.trees.set(viewId, items);
  }
  list(): ViewSnapshot[] {
    return [...this.views].map(([viewId, view]) => ({
      extensionId: view.owner,
      viewId,
      title: view.title,
      location: view.location,
      items: structuredClone(this.trees.get(viewId) ?? []),
    }));
  }
  clear(owner: string) {
    for (const [viewId, view] of this.views) if (view.owner === owner) this.trees.delete(viewId);
  }
}
export function validateTreeItems(items: TreeItem[]) {
  let count = 0;
  const visit = (entries: TreeItem[], depth: number, seen: string[]) => {
    if (depth > 8) throw new ExtensionError("ProtocolError", "View tree too deep");
    for (const item of entries) {
      if (++count > 500) throw new ExtensionError("ProtocolError", "View tree too large");
      if (!item || typeof item !== "object")
        throw new ExtensionError("ProtocolError", "Invalid tree item");
      if (typeof item.id !== "string" || !treeIdPattern.test(item.id))
        throw new ExtensionError("ProtocolError", "Invalid tree item id");
      if (typeof item.label !== "string" || item.label.length === 0 || item.label.length > 256)
        throw new ExtensionError("ProtocolError", "Invalid tree item label");
      if (
        item.description !== undefined &&
        (typeof item.description !== "string" || item.description.length > 256)
      )
        throw new ExtensionError("ProtocolError", "Invalid tree item description");
      if (seen.includes(item.id))
        throw new ExtensionError("ProtocolError", "Duplicate tree item id");
      const trail = [...seen, item.id];
      if (item.children !== undefined) {
        if (!Array.isArray(item.children))
          throw new ExtensionError("ProtocolError", "Invalid tree children");
        visit(item.children, depth + 1, trail);
      }
    }
  };
  if (!Array.isArray(items)) throw new ExtensionError("ProtocolError", "Invalid tree items");
  visit(items, 0, []);
}
