import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { HammerIcon, LoaderIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useActiveConnection } from "@/lib/connections";
import { compileObject } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { compileArgForInvalidType, filterInvalidByTypes } from "@/lib/invalid-objects";
import { useInvalidObjectsQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { cn } from "@/lib/utils";

export function CompileInvalidButton({ types }: { types: string[] }) {
  const caps = useActiveCapabilities();
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const invalidQuery = useInvalidObjectsQuery();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  if (!caps.compile_objects || !connection) return null;
  const items = filterInvalidByTypes(invalidQuery.data, types);
  if (items.length === 0) return null;
  const handleCompile = async () => {
    setLoading(true);
    try {
      let ok = 0;
      for (const item of items) {
        try {
          const result = await compileObject(
            connection.kind,
            effectiveConnectionString(connection),
            item.oid,
            compileArgForInvalidType(item.object_type),
            database ?? undefined,
          );
          if (result.status === "VALID") ok += 1;
        } catch {
          continue;
        }
      }
      const bad = items.length - ok;
      if (bad === 0) {
        toast.success(`${ok} Objekte kompiliert`, { description: "Alle INVALID-Objekte dieser Gruppe sind jetzt VALID" });
      } else {
        toast.error(`${bad} Objekte weiterhin INVALID`, {
          description: `${ok} kompiliert, Details siehe Outputs-Page`,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["invalid-objects"] });
      await queryClient.invalidateQueries({ queryKey: ["compile-errors"] });
      await queryClient.invalidateQueries({ queryKey: ["functions"] });
      await queryClient.invalidateQueries({ queryKey: ["procedures"] });
      await queryClient.invalidateQueries({ queryKey: ["views"] });
      await queryClient.invalidateQueries({ queryKey: ["function-definition"] });
      void navigate({ to: "/invalid-objects" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void handleCompile()}
      disabled={loading}
      title={`${items.length} invalide Objekte dieser Gruppe kompilieren`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {loading ? <LoaderIcon className="size-3 animate-spin" /> : <HammerIcon className="size-3" />}
      <span className="tabular-nums">Compile invalid ({items.length})</span>
    </button>
  );
}
