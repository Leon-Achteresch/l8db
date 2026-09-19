import { useLayoutEffect, useRef, useState } from "react";
import { MasterDetailLink } from "@/features/shell/master-detail-link";
import { canLink, linkAnchor, type PaneBox, spreadAnchors } from "@/lib/split-links";
import { usePaneTabs, useSplitView } from "@/lib/split-view";

export function MasterDetailLinks() {
  const ref = useRef<HTMLDivElement>(null);
  const panes = useSplitView((state) => state.panes);
  const masters = useSplitView((state) => state.masters);
  const paneTabs = usePaneTabs();
  const [boxes, setBoxes] = useState<PaneBox[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const count = panes.length;

  useLayoutEffect(() => {
    const overlay = ref.current;
    const container = overlay?.parentElement;
    if (!overlay || !container || count < 2) return;
    const elements = [...container.querySelectorAll<HTMLElement>("[data-split-pane]")];
    const measure = () => {
      const origin = overlay.getBoundingClientRect();
      const next: PaneBox[] = [];
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        next[Number(element.dataset.splitPane)] = {
          left: rect.left - origin.left,
          top: rect.top - origin.top,
          right: rect.right - origin.left,
          bottom: rect.bottom - origin.top,
        };
      }
      setBoxes(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(overlay);
    for (const element of elements) observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [count]);

  const links = masters.flatMap((master, detail) =>
    master !== null && boxes[master] && boxes[detail] && canLink(masters, paneTabs, master, detail)
      ? [{ master, detail, id: `${master}>${detail}` }]
      : [],
  );
  const anchors = spreadAnchors(
    links.map((link) => linkAnchor(boxes[link.master], boxes[link.detail])),
  );
  const active = links.find((link) => link.id === hovered);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-40">
      {active &&
        [active.master, active.detail].map((pane) => (
          <div
            key={pane}
            className="absolute bg-primary/[0.04] ring-2 ring-primary/60 ring-inset"
            style={{
              left: boxes[pane].left,
              top: boxes[pane].top,
              width: boxes[pane].right - boxes[pane].left,
              height: boxes[pane].bottom - boxes[pane].top,
            }}
          />
        ))}
      {links.map((link, index) => (
        <MasterDetailLink
          key={`${panes[link.master]}|${panes[link.detail]}|${link.id}`}
          master={paneTabs[link.master]}
          masterIndex={link.master}
          detail={paneTabs[link.detail]}
          detailIndex={link.detail}
          anchor={anchors[index]}
          onHover={(on) =>
            setHovered((current) => (on ? link.id : current === link.id ? null : current))
          }
        />
      ))}
    </div>
  );
}
