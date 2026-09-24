import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { getNodesBounds, getViewportForBounds, useReactFlow } from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";
import { jsPDF } from "jspdf";
import { FileCode, FileText, Image } from "lucide-react";
import { useCallback } from "react";
import { EXPORT_PADDING, EXPORT_SCALE } from "@/features/er-diagram/er-diagram-view/constants";
import {
  dataUrlToUint8Array,
  getFlowElement,
} from "@/features/er-diagram/er-diagram-view/export-utils";
import type { TableNodeType } from "@/features/er-diagram/er-diagram-view/types";

export function ExportButtons({
  nodes,
  exporting,
  setExporting,
}: {
  nodes: TableNodeType[];
  exporting: boolean;
  setExporting: (exporting: boolean) => void;
}) {
  const { getNodes } = useReactFlow();

  const doExport = useCallback(
    async (format: "png" | "svg" | "pdf") => {
      if (exporting) return;
      setExporting(true);

      try {
        const currentNodes = getNodes();
        if (currentNodes.length === 0) return;

        const bounds = getNodesBounds(currentNodes);
        const w = bounds.width + EXPORT_PADDING * 2;
        const h = bounds.height + EXPORT_PADDING * 2;

        const viewport = getViewportForBounds(bounds, w, h, 0.1, 2, EXPORT_PADDING);

        const el = await getFlowElement();

        const extensions: Record<string, string> = {
          png: "png",
          svg: "svg",
          pdf: "pdf",
        };

        const filePath = await save({
          title: `ER-Diagramm als ${format.toUpperCase()} speichern`,
          defaultPath: `er-diagramm.${extensions[format]}`,
          filters: [
            {
              name: format.toUpperCase(),
              extensions: [extensions[format]],
            },
          ],
        });
        if (!filePath) return;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        if (format === "png") {
          const dataUrl = await toPng(el, {
            width: w * EXPORT_SCALE,
            height: h * EXPORT_SCALE,
            style: {
              width: `${w}px`,
              height: `${h}px`,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            },
            pixelRatio: EXPORT_SCALE,
          });
          await writeFile(filePath, dataUrlToUint8Array(dataUrl));
        }

        if (format === "svg") {
          const svgString = await toSvg(el, {
            width: w * EXPORT_SCALE,
            height: h * EXPORT_SCALE,
            style: {
              width: `${w}px`,
              height: `${h}px`,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            },
          });
          await writeTextFile(filePath, svgString);
        }

        if (format === "pdf") {
          const dataUrl = await toPng(el, {
            width: w * EXPORT_SCALE,
            height: h * EXPORT_SCALE,
            style: {
              width: `${w}px`,
              height: `${h}px`,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            },
            pixelRatio: EXPORT_SCALE,
          });

          const orientation = w > h ? "landscape" : "portrait";
          const pdf = new jsPDF({
            orientation,
            unit: "px",
            format: [w, h],
          });
          pdf.addImage(dataUrl, "PNG", 0, 0, w, h);
          const pdfBytes = pdf.output("arraybuffer");
          await writeFile(filePath, new Uint8Array(pdfBytes));
        }
      } finally {
        setExporting(false);
      }
    },
    [exporting, getNodes, setExporting],
  );

  return (
    <div className="rounded-md bg-card border border-border shadow-sm flex items-center">
      <button
        type="button"
        onClick={() => doExport("png")}
        disabled={exporting || nodes.length === 0}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-40 disabled:pointer-events-none rounded-l-md"
        title="Als PNG exportieren"
      >
        <Image className="size-3.5" />
        PNG
      </button>
      <div className="w-px h-5 bg-border" />
      <button
        type="button"
        onClick={() => doExport("svg")}
        disabled={exporting || nodes.length === 0}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        title="Als SVG exportieren"
      >
        <FileCode className="size-3.5" />
        SVG
      </button>
      <div className="w-px h-5 bg-border" />
      <button
        type="button"
        onClick={() => doExport("pdf")}
        disabled={exporting || nodes.length === 0}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-40 disabled:pointer-events-none rounded-r-md"
        title="Als PDF exportieren"
      >
        <FileText className="size-3.5" />
        PDF
      </button>
    </div>
  );
}
