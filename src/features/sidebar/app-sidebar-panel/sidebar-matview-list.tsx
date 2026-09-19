import { useQueryClient } from "@tanstack/react-query";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { LayersIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import { useActiveConnection } from "@/lib/connections";
import { createMaterializedView } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

export function SidebarMatviewList({
  items,
}: {
  items: { schema: string; name: string; is_populated: boolean }[] | undefined;
}) {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const activeConnection = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [schema, setSchemaName] = useState("public");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [withData, setWithData] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!activeConnection || !name.trim() || !query.trim()) return;
    setSaving(true);
    try {
      await createMaterializedView(
        activeConnection.kind,
        effectiveConnectionString(activeConnection),
        {
          schema: schema.trim() || "public",
          name: name.trim(),
          query: query.trim(),
          with_data: withData,
        },
        activeDatabase ?? undefined,
      );
      toast.success(`Materialized View "${name.trim()}" erstellt.`);
      setName("");
      setQuery("");
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["matviews"] });
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between py-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Materialized Views
        </p>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Materialized View erstellen"
        >
          <PlusIcon className="size-3" />
        </button>
      </div>
      {(!items || items.length === 0) && (
        <p className="py-1 text-xs text-muted-foreground">Keine vorhanden.</p>
      )}
      <SidebarWindow count={items?.length ?? 0}>
        {(index) => {
          const item = items![index];
          const isActive = Boolean(
            matchRoute({
              to: "/matviews/$schema/$name",
              params: { schema: item.schema, name: item.name },
            }),
          );
          return (
            <SidebarMenuItem key={`${item.schema}.${item.name}`}>
              <SidebarMenuButton
                isActive={isActive}
                onClick={() => {
                  navigate({
                    to: "/matviews/$schema/$name",
                    params: { schema: item.schema, name: item.name },
                  });
                }}
              >
                <LayersIcon className="text-muted-foreground" />
                <span className="truncate">
                  {item.schema}.{item.name}
                  {item.is_populated ? "" : " (leer)"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        }}
      </SidebarWindow>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Materialized View erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Schema</Label>
                <Input
                  value={schema}
                  onChange={(e) => setSchemaName(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 text-xs font-mono"
                  placeholder="z. B. umsatz_pro_tag"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">SELECT-Abfrage</Label>
              <Textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-h-28 font-mono text-xs"
                placeholder="SELECT …"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Switch checked={withData} onCheckedChange={setWithData} />
              Sofort befüllen (WITH DATA)
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={saving || !name.trim() || !query.trim()}
            >
              {saving ? "Erstellen…" : "Erstellen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
