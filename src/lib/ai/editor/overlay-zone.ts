import type { monaco } from "@/lib/monaco";

let counter = 0;

export class OverlayZone {
  private zoneId = "";
  private readonly placeholder = document.createElement("div");
  private readonly host = document.createElement("div");
  private readonly widget: monaco.editor.IOverlayWidget;
  private readonly subs: monaco.IDisposable[];
  private frame = 0;

  constructor(
    private readonly editor: monaco.editor.ICodeEditor,
    readonly node: HTMLElement,
  ) {
    const id = `l8db.ai.zone.${++counter}`;
    this.host.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;overflow:visible";
    node.style.position = "absolute";
    node.style.visibility = "hidden";
    this.host.append(node);
    this.widget = { getId: () => id, getDomNode: () => this.host, getPosition: () => null };
    editor.addOverlayWidget(this.widget);
    this.subs = [
      editor.onDidLayoutChange(() => this.layoutWidth()),
      editor.onDidScrollChange(() => this.scheduleSync()),
    ];
    this.layoutWidth();
  }

  private layoutWidth() {
    const layout = this.editor.getLayoutInfo();
    this.node.style.left = `${layout.contentLeft}px`;
    this.node.style.width = `${Math.max(0, layout.contentWidth - layout.verticalScrollbarWidth)}px`;
  }

  private scheduleSync() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.syncVisibility());
  }

  private syncVisibility() {
    const shown = Boolean(this.zoneId) && this.placeholder.style.display !== "none";
    this.node.style.visibility = shown ? "visible" : "hidden";
  }

  place(
    accessor: monaco.editor.IViewZoneChangeAccessor,
    options: { afterLineNumber: number; heightInPx: number; ordinal: number },
  ) {
    if (this.zoneId) accessor.removeZone(this.zoneId);
    this.node.style.minHeight = `${options.heightInPx}px`;
    this.zoneId = accessor.addZone({
      ...options,
      domNode: this.placeholder,
      showInHiddenAreas: true,
      onDomNodeTop: (top) => {
        this.node.style.top = `${top}px`;
        this.syncVisibility();
      },
    });
    this.scheduleSync();
  }

  remove(accessor: monaco.editor.IViewZoneChangeAccessor) {
    if (this.zoneId) accessor.removeZone(this.zoneId);
    this.zoneId = "";
    this.syncVisibility();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    for (const sub of this.subs) sub.dispose();
    this.editor.removeOverlayWidget(this.widget);
  }
}
