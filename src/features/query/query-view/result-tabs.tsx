import { NewBadge } from "@/components/new-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useServerOutputStore } from "@/lib/server-output";

interface ResultTabsProps {
  connectionId: string;
  label: string;
  outputOpen: boolean;
  onOutputOpenChange: (open: boolean) => void;
}

export function ResultTabs({
  connectionId,
  label,
  outputOpen,
  onOutputOpenChange,
}: ResultTabsProps) {
  const count = useServerOutputStore((state) => state.entries[connectionId]?.length ?? 0);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.results.output-tab");
  if (!outputOpen && count === 0) return null;
  return (
    <Tabs
      value={outputOpen ? "output" : "result"}
      onValueChange={(value) => onOutputOpenChange(value === "output")}
    >
      <TabsList variant="line" className="group-data-horizontal/tabs:h-8">
        <TabsTrigger value="result" aria-controls={undefined} className="text-xs">
          Ergebnis
        </TabsTrigger>
        <TabsTrigger ref={feature.ref} value="output" aria-controls={undefined} className="text-xs">
          {label}
          {count > 0 && (
            <span className="tabular-nums text-muted-foreground">
              {count.toLocaleString("de-DE")}
            </span>
          )}
          {feature.isNew && <NewBadge />}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
