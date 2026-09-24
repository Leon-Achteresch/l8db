import { BinaryIcon, BoxIcon, CodeXmlIcon, ImageIcon, MapIcon, TypeIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { analyzeValue, type ValueViewerKind, VIEWER_LABELS } from "@/lib/value-viewers/detect";
import { BinaryValueViewer } from "./binary-value-viewer";
import { GeometryValueViewer } from "./geometry-value-viewer";
import { ImageValueViewer } from "./image-value-viewer";
import { VectorValueViewer } from "./vector-value-viewer";
import { XmlValueViewer } from "./xml-value-viewer";

const ICONS: Record<ValueViewerKind, typeof TypeIcon> = {
  text: TypeIcon,
  binary: BinaryIcon,
  image: ImageIcon,
  geometry: MapIcon,
  xml: CodeXmlIcon,
  vector: BoxIcon,
};

type ValueViewerPanelProps = {
  value: unknown;
  dataType?: string | null;
  columnName: string;
  textView: ReactNode;
  getColumnValues?: () => unknown[];
};

export function ValueViewerPanel({
  value,
  dataType,
  columnName,
  textView,
  getColumnValues,
}: ValueViewerPanelProps) {
  const analysis = useMemo(() => analyzeValue(value, dataType), [value, dataType]);
  const [selected, setSelected] = useState<ValueViewerKind | null>(null);
  const active = selected && analysis.kinds.includes(selected) ? selected : analysis.initial;
  const text = typeof value === "string" ? value : null;
  const fileName = columnName.replace(/[^\w.-]+/g, "_") || "wert";
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="value-viewer" data-viewer={active}>
      {analysis.kinds.length > 1 && (
        <Tabs value={active} onValueChange={(next) => setSelected(next as ValueViewerKind)}>
          <TabsList className="h-8">
            {analysis.kinds.map((kind) => {
              const Icon = ICONS[kind];
              return (
                <TabsTrigger key={kind} value={kind} className="gap-1 px-2.5 text-xs">
                  <Icon className="size-3.5" />
                  {VIEWER_LABELS[kind]}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      )}
      {active === "image" && analysis.image ? (
        <ImageValueViewer
          format={analysis.image}
          bytes={analysis.binary?.bytes ?? null}
          text={analysis.binary ? null : text}
        />
      ) : active === "geometry" && analysis.geometry ? (
        <GeometryValueViewer
          parsed={analysis.geometry}
          dataType={dataType}
          getColumnValues={getColumnValues}
        />
      ) : active === "vector" && analysis.vector ? (
        <VectorValueViewer vector={analysis.vector} />
      ) : active === "xml" && analysis.xml !== null ? (
        <XmlValueViewer text={analysis.xml} />
      ) : active === "binary" && analysis.binary ? (
        <BinaryValueViewer binary={analysis.binary} image={analysis.image} fileName={fileName} />
      ) : (
        textView
      )}
    </div>
  );
}
