import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { type ComponentType, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SupabaseStudioCapabilities } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { SupabaseSectionHeader } from "../supabase-section-header";
import { SECTION_TABS_CLASS } from "../supabase-section-tabs";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { LogsAdvisorsTab } from "./logs-advisors-tab";
import { LogsExplorerTab } from "./logs-explorer-tab";
import { type LogsTabProps, logsQueryKey } from "./logs-format";
import { LogsHealthTab } from "./logs-health-tab";
import { LogsLocksTab } from "./logs-locks-tab";
import { LogsSelfHostedNotice } from "./logs-self-hosted-notice";
import { LogsSessionsTab } from "./logs-sessions-tab";
import { LogsStatementsTab } from "./logs-statements-tab";
import { LogsUsageTab } from "./logs-usage-tab";

const SQL_REASON = "Benötigt SQL-Zugriff.";
const MANAGEMENT_REASON = "Nur für Supabase-Cloud-Projekte mit Zugangstoken.";

const TABS: {
  id: string;
  label: string;
  component: ComponentType<LogsTabProps>;
  unavailable: (capabilities: SupabaseStudioCapabilities) => string | null;
}[] = [
  {
    id: "sessions",
    label: "Sitzungen",
    component: LogsSessionsTab,
    unavailable: (c) => (c.sql ? null : SQL_REASON),
  },
  {
    id: "locks",
    label: "Sperren",
    component: LogsLocksTab,
    unavailable: (c) => (c.sql ? null : SQL_REASON),
  },
  {
    id: "statements",
    label: "Abfragen",
    component: LogsStatementsTab,
    unavailable: (c) => (c.sql ? null : SQL_REASON),
  },
  {
    id: "health",
    label: "Datenbank-Zustand",
    component: LogsHealthTab,
    unavailable: (c) => (c.sql ? null : SQL_REASON),
  },
  {
    id: "logs",
    label: "Logs",
    component: LogsExplorerTab,
    unavailable: (c) => (c.management || c.self_hosted ? null : MANAGEMENT_REASON),
  },
  {
    id: "advisors",
    label: "Advisors",
    component: LogsAdvisorsTab,
    unavailable: (c) => (c.management ? null : MANAGEMENT_REASON),
  },
  {
    id: "usage",
    label: "Nutzung",
    component: LogsUsageTab,
    unavailable: (c) => (c.management ? null : MANAGEMENT_REASON),
  },
];

const INTERVALS = [5, 10, 30, 60];

export function SupabaseLogsSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.logs");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(
    () => TABS.find((item) => !item.unavailable(capabilities))?.id ?? "logs",
  );
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [seconds, setSeconds] = useState(10);
  const refetchInterval = autoRefresh ? seconds * 1000 : false;
  const reference = project.reference;
  return (
    <div className="space-y-5">
      <SupabaseSectionHeader
        title="Logs & Leistung"
        titleRef={feature.ref}
        isNew={feature.isNew}
        description="Logs der Dienste, langsame Abfragen, Sperren und Hinweise zur Datenbank."
        actions={
          <>
            <Label className="flex items-center gap-2 text-xs">
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              Automatisch aktualisieren
            </Label>
            <Select value={String(seconds)} onValueChange={(value) => setSeconds(Number(value))}>
              <SelectTrigger size="sm" className="h-8 w-24 text-xs" aria-label="Intervall">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map((value) => (
                  <SelectItem key={value} value={String(value)} className="text-xs">
                    alle {value} s
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: logsQueryKey(reference, tab) })
              }
            >
              <RefreshCw className="size-3.5" />
              Aktualisieren
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className={SECTION_TABS_CLASS}>
          {TABS.map((item) => {
            const reason = item.unavailable(capabilities);
            return (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="text-xs"
                disabled={reason !== null}
                title={reason ?? undefined}
              >
                {item.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {TABS.map(({ id, component: Tab }) => (
          <TabsContent key={id} value={id} className="pt-3">
            {tab === id &&
              (id === "logs" && !capabilities.management ? (
                <LogsSelfHostedNotice />
              ) : (
                <Tab reference={reference} refetchInterval={refetchInterval} />
              ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
