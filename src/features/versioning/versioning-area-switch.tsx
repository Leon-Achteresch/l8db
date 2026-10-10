import { DatabaseIcon, GitBranchIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useHasNewFeatures } from "@/lib/new-features";
import { cn } from "@/lib/utils";

export function VersioningAreaSwitch({
  area,
  onChange,
  count,
  className,
}: {
  area: "database" | "git";
  onChange: (area: "database" | "git") => void;
  count: number;
  className?: string;
}) {
  const databaseFeature = useNewFeatureVisibility<HTMLButtonElement>("versioning.database");
  const reviewsNew = useHasNewFeatures("versioning.reviews");
  const pipelineNew = useHasNewFeatures("versioning.pipeline");
  return (
    <Tabs
      value={area}
      onValueChange={(next) => onChange(next as "database" | "git")}
      className={cn("shrink-0 px-4 pb-3", className)}
    >
      <TabsList aria-label="Art der Versionierung" className="w-full">
        <TabsTrigger ref={databaseFeature.ref} value="database" className="gap-1.5 text-xs">
          <DatabaseIcon className="size-3.5" />
          Datenbank
          {databaseFeature.isNew && <NewBadge />}
        </TabsTrigger>
        <TabsTrigger value="git" className="gap-1.5 text-xs">
          <GitBranchIcon className="size-3.5" />
          Git &amp; Releases
          {area === "database" && count > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
          )}
          {area === "database" && (reviewsNew || pipelineNew) && <NewBadge />}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
