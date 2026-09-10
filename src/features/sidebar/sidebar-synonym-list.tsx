import { useNavigate } from "@tanstack/react-router";
import { LinkIcon } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import type { SynonymInfo } from "@/lib/db";
import { resolveSynonym } from "@/lib/synonyms";
import { normalizeObjectType } from "@/lib/used-by";

interface SidebarSynonymListProps {
  items: SynonymInfo[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function SidebarSynonymList({
  items,
  isLoading,
  isError,
  error,
}: SidebarSynonymListProps) {
  const navigate = useNavigate();
  const all = useMemo(() => items ?? [], [items]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Synonyme…
      </div>
    );
  }
  if (isError) {
    return <p className="py-1 text-sm text-destructive">{String(error)}</p>;
  }
  if (all.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Synonyme gefunden.</p>;
  }

  const open = (synonym: SynonymInfo) => {
    const resolution = resolveSynonym(synonym, all);
    if (resolution.cycle) {
      toast.error(`Zirkuläre Synonymkette: ${resolution.chain.join(" → ")}`);
      return;
    }
    const target = resolution.target;
    if (!target) {
      toast.error(`Ziel von ${synonym.name} konnte nicht aufgelöst werden.`);
      return;
    }
    if (resolution.remote) {
      toast.info(
        `${synonym.name} zeigt über den Datenbank-Link ${synonym.db_link} auf ${target.owner}.${target.name}.`,
      );
      return;
    }
    const type = normalizeObjectType(target.type);
    if (type === "view" || type === "materialized_view") {
      void navigate({
        to: "/view-editor/$schema/$view",
        params: { schema: target.owner, view: target.name },
      });
      return;
    }
    if (type === "table") {
      void navigate({
        to: "/tables/$schema/$table",
        params: { schema: target.owner, table: target.name },
        search: {},
      });
      return;
    }
    toast.info(`${synonym.name} → ${target.owner}.${target.name} (${target.type})`);
  };

  return (
    <SidebarMenu>
      {all.map((synonym) => {
        const resolution = resolveSynonym(synonym, all);
        const targetLabel = resolution.cycle
          ? "Zirkel erkannt"
          : `${resolution.target?.owner}.${resolution.target?.name} (${resolution.target?.type})`;
        return (
          <SidebarMenuItem key={`${synonym.owner}.${synonym.name}`}>
            <SidebarMenuButton
              onClick={() => open(synonym)}
              title={`${synonym.name} → ${targetLabel} · ${synonym.status}`}
              className="h-auto flex-col items-start gap-0.5 py-1.5"
            >
              <span className="flex w-full items-center gap-2">
                <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{synonym.name}</span>
                <span
                  className={`ml-auto shrink-0 text-[10px] ${
                    synonym.status.toUpperCase() === "VALID"
                      ? "text-muted-foreground"
                      : "text-destructive"
                  }`}
                >
                  {synonym.status}
                </span>
              </span>
              <span className="w-full truncate pl-6 text-[11px] text-muted-foreground">
                {targetLabel}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
