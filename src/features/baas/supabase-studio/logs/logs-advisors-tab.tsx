import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabaseStudioObservabilityAdvisors } from "@/lib/db/supabase-studio-observability";
import { type LogsTabProps, logsQueryKey } from "./logs-format";
import { LogsQueryState } from "./logs-query-state";

const LEVEL_LABEL: Record<string, string> = { ERROR: "Fehler", WARN: "Warnung", INFO: "Info" };

export function LogsAdvisorsTab({ reference, refetchInterval }: LogsTabProps) {
  const [kind, setKind] = useState<"security" | "performance">("security");
  const query = useQuery({
    queryKey: logsQueryKey(reference, "advisors", kind),
    queryFn: () => supabaseStudioObservabilityAdvisors(reference, kind),
    refetchInterval,
  });
  return (
    <div className="space-y-3">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={kind}
        onValueChange={(value) => value && setKind(value as "security" | "performance")}
      >
        <ToggleGroupItem value="security" className="text-xs">
          Sicherheit
        </ToggleGroupItem>
        <ToggleGroupItem value="performance" className="text-xs">
          Leistung
        </ToggleGroupItem>
      </ToggleGroup>
      <LogsQueryState query={query}>
        {(data) =>
          data.rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Hinweise gefunden.</p>
          ) : (
            <ul className="space-y-2">
              {data.rows.map((lint, index) => (
                <li
                  key={lint.cache_key ?? `${lint.name}-${index}`}
                  className="rounded-xl border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={lint.level === "ERROR" ? "destructive" : "secondary"}>
                      {LEVEL_LABEL[lint.level] ?? lint.level}
                    </Badge>
                    <span className="text-sm font-medium">{lint.title}</span>
                    {lint.categories?.map((category) => (
                      <Badge key={category} variant="outline">
                        {category}
                      </Badge>
                    ))}
                  </div>
                  {lint.detail && <p className="mt-2 text-xs">{lint.detail}</p>}
                  {lint.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{lint.description}</p>
                  )}
                  {lint.remediation?.startsWith("https://") && (
                    <Button
                      size="sm"
                      variant="link"
                      className="mt-1 h-auto p-0 text-xs"
                      onClick={() => void openUrl(lint.remediation as string)}
                    >
                      Behebung ansehen
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </LogsQueryState>
    </div>
  );
}
