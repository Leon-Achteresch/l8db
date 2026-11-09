import { useNavigate } from "@tanstack/react-router";
import { GaugeIcon, PlusIcon, ShieldIcon, UserIcon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import { CreatePrincipalDialog } from "@/features/users/principal-view/create-principal-dialog";
import type { PrincipalKind } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { usePaneTabTarget } from "@/lib/pane-tab-target";
import { usePrincipalsQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

const KINDS: { kind: PrincipalKind; label: string; icon: typeof UserIcon }[] = [
  { kind: "user", label: "Benutzer", icon: UserIcon },
  { kind: "role", label: "Rollen", icon: ShieldIcon },
  { kind: "profile", label: "Profile", icon: GaugeIcon },
];

export function SidebarPrincipalList() {
  const navigate = useNavigate();
  const openRoleTab = useTableTabs((state) => state.openRoleTab);
  const target = usePaneTabTarget();
  const { data, isLoading, isError, error } = usePrincipalsQuery();
  const feature = useNewFeatureVisibility<HTMLDivElement>("sidebar.roles.principals");
  const [kind, setKind] = useState<PrincipalKind>("user");
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Benutzer…
      </div>
    );
  }

  if (isError) {
    return <SidebarQueryError error={error} />;
  }

  const all = data?.items ?? [];
  const kinds = KINDS.filter((entry) => all.some((item) => item.kind === entry.kind));
  const needle = filter.trim().toUpperCase();
  const items = all.filter(
    (item) => item.kind === kind && item.name.toUpperCase().includes(needle),
  );
  const Icon = KINDS.find((entry) => entry.kind === kind)?.icon ?? UserIcon;

  return (
    <div ref={feature.ref} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <div className="flex min-w-0 flex-1 rounded-full bg-sidebar-accent/60 p-0.5">
          {kinds.map((entry) => (
            <Button
              key={entry.kind}
              size="xs"
              variant="ghost"
              aria-pressed={kind === entry.kind}
              title={`${all.filter((item) => item.kind === entry.kind).length} ${entry.label}`}
              className={cn(
                "min-w-0 flex-1 rounded-full px-1.5",
                kind === entry.kind && "bg-background shadow-xs hover:bg-background",
              )}
              onClick={() => setKind(entry.kind)}
            >
              <span className="truncate">{entry.label}</span>
            </Button>
          ))}
        </div>
        {feature.isNew && <NewBadge />}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Neu anlegen"
          onClick={() => setCreating(true)}
        >
          <PlusIcon />
        </Button>
      </div>
      <Input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Suchen"
        className="h-7 text-xs"
      />
      {items.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Keine Treffer.</p>
      ) : (
        <SidebarWindow count={items.length}>
          {(index) => {
            const item = items[index];
            const profile = item.kind === "profile" || undefined;
            return (
              <SidebarMenuItem key={`${item.kind}:${item.name}`}>
                <SidebarMenuButton
                  onClick={() => {
                    if (target) {
                      target.open({ kind: "role", name: item.name, profile });
                      return;
                    }
                    openRoleTab({ name: item.name, profile });
                    navigate({
                      to: "/users/$name",
                      params: { name: item.name },
                      search: { profile },
                    });
                  }}
                >
                  <Icon className="text-muted-foreground" />
                  <span className={cn("truncate", item.system && "text-muted-foreground")}>
                    {item.name}
                  </span>
                  {item.status && item.status !== "OPEN" && (
                    <span
                      title={item.status}
                      className={cn(
                        "ml-auto size-1.5 shrink-0 rounded-full",
                        item.status.includes("LOCKED") ? "bg-destructive" : "bg-amber-500",
                      )}
                    />
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          }}
        </SidebarWindow>
      )}
      {creating && (
        <CreatePrincipalDialog
          open
          onOpenChange={(open) => !open && setCreating(false)}
          kind={kind}
        />
      )}
    </div>
  );
}
