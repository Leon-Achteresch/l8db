import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon, RadioIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveConnection } from "@/lib/connections";
import {
  type CreatePublicationRequest,
  type CreateSubscriptionRequest,
  createPublication,
  createSubscription,
  dropPublication,
  dropSubscription,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { usePublicationsQuery, useSubscriptionsQuery, useTablesQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";

function CreatePublicationDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const { data: tables } = useTablesQuery();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [forAllTables, setForAllTables] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishInsert, setPublishInsert] = useState(true);
  const [publishUpdate, setPublishUpdate] = useState(true);
  const [publishDelete, setPublishDelete] = useState(true);
  const [publishTruncate, setPublishTruncate] = useState(true);

  const toggleTable = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (!connection || !name.trim()) return;
    setSaving(true);
    try {
      const request: CreatePublicationRequest = {
        name: name.trim(),
        for_all_tables: forAllTables,
        tables: forAllTables
          ? []
          : [...selected].map((key) => {
              const [schema, table] = key.split(".", 2);
              return { schema, table };
            }),
        publish_insert: publishInsert,
        publish_update: publishUpdate,
        publish_delete: publishDelete,
        publish_truncate: publishTruncate,
      };
      await createPublication(
        connection.kind,
        effectiveConnectionString(connection),
        request,
        database ?? undefined,
      );
      toast.success(`Publikation "${name.trim()}" erstellt.`);
      onSuccess();
      onOpenChange(false);
      setName("");
      setSelected(new Set());
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Neue Publikation</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="z. B. app_pub"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Switch checked={forAllTables} onCheckedChange={setForAllTables} />
            Alle Tabellen (FOR ALL TABLES)
          </label>
          {!forAllTables && (
            <div className="space-y-1.5">
              <Label className="text-xs">Tabellen ({selected.size} gewählt)</Label>
              <div className="max-h-44 overflow-y-auto rounded-lg border p-2">
                {(tables ?? []).map((table) => {
                  const key = `${table.schema}.${table.name}`;
                  return (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/60"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggleTable(key)}
                        className="size-3.5 accent-primary"
                      />
                      <span className="font-mono">{key}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(
              [
                ["INSERT", publishInsert, setPublishInsert],
                ["UPDATE", publishUpdate, setPublishUpdate],
                ["DELETE", publishDelete, setPublishDelete],
                ["TRUNCATE", publishTruncate, setPublishTruncate],
              ] as const
            ).map(([label, value, setValue]) => (
              <label key={label} className="flex cursor-pointer items-center gap-2 text-xs">
                <Switch checked={value} onCheckedChange={setValue} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !name.trim() || (!forAllTables && selected.size === 0)}
          >
            {saving ? "Erstellen…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateSubscriptionDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [publications, setPublications] = useState("");
  const [slotName, setSlotName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [connect, setConnect] = useState(true);

  const handleSave = async () => {
    if (!connection || !name.trim() || !providerUrl.trim() || !publications.trim()) return;
    setSaving(true);
    try {
      const request: CreateSubscriptionRequest = {
        name: name.trim(),
        connection_string: providerUrl.trim(),
        publications: publications
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        enabled,
        connect,
      };
      if (slotName.trim()) request.slot_name = slotName.trim();
      await createSubscription(
        connection.kind,
        effectiveConnectionString(connection),
        request,
        database ?? undefined,
      );
      toast.success(`Subskription "${name.trim()}" erstellt.`);
      onSuccess();
      onOpenChange(false);
      setName("");
      setProviderUrl("");
      setPublications("");
      setSlotName("");
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Neue Subskription</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="z. B. app_sub"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Provider-Connection-String</Label>
            <Input
              value={providerUrl}
              onChange={(e) => setProviderUrl(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="postgresql://user:pass@host:5432/db"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Publikationen (kommagetrennt)</Label>
            <Input
              value={publications}
              onChange={(e) => setPublications(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="z. B. app_pub"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Slot-Name (optional, Standard = Subskriptions-Name)</Label>
            <Input
              value={slotName}
              onChange={(e) => setSlotName(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            Aktiviert (Worker starten)
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <Switch checked={connect} onCheckedChange={setConnect} />
            <span>
              Sofort verbinden
              <span className="block text-muted-foreground">
                Aus = nur anlegen ohne Provider-Kontakt, z. B. wenn der Provider gerade nicht
                erreichbar ist.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !name.trim() || !providerUrl.trim() || !publications.trim()}
          >
            {saving ? "Erstellen…" : "Erstellen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReplicationView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("publications");
  const [pubDialogOpen, setPubDialogOpen] = useState(false);
  const [subDialogOpen, setSubDialogOpen] = useState(false);
  const { data: publications, isLoading: pubsLoading } = usePublicationsQuery();
  const { data: subscriptions, isLoading: subsLoading } = useSubscriptionsQuery();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["publications"] });
    void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
  };

  const handleDropPub = async (name: string) => {
    if (!connection) return;
    if (!window.confirm(`Publikation "${name}" wirklich löschen?`)) return;
    try {
      await dropPublication(
        connection.kind,
        effectiveConnectionString(connection),
        name,
        database ?? undefined,
      );
      toast.success(`Publikation "${name}" gelöscht.`);
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    }
  };

  const handleDropSub = async (name: string) => {
    if (!connection) return;
    if (
      !window.confirm(
        `Subskription "${name}" wirklich löschen? Der Provider-Slot wird dabei mit gelöscht.`,
      )
    )
      return;
    try {
      await dropSubscription(
        connection.kind,
        effectiveConnectionString(connection),
        name,
        database ?? undefined,
      );
      toast.success(`Subskription "${name}" gelöscht.`);
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    }
  };

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-6xl min-h-0 flex-col gap-4 p-6">
      <header className="flex shrink-0 items-center gap-2">
        <RadioIcon className="size-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight">Logische Replikation</h1>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="publications" className="text-xs">
            Publikationen ({publications?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="subscriptions" className="text-xs">
            Subskriptionen ({subscriptions?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="publications" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-3 flex justify-end">
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setPubDialogOpen(true)}
            >
              <PlusIcon className="size-3.5" />
              Neue Publikation
            </Button>
          </div>
          {pubsLoading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Lade Publikationen…</p>
          ) : (publications?.length ?? 0) === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Keine Publikationen.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {publications!.map((pub) => (
                <motion.div
                  key={pub.name}
                  layout
                  transition={{ layout: SPRING_LAYOUT }}
                  className="rounded-lg border p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{pub.name}</span>
                    {pub.all_tables && (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        FOR ALL TABLES
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">Owner: {pub.owner}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-7 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void handleDropPub(pub.name)}
                      title={`Publikation "${pub.name}" löschen`}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    {pub.insert && (
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        insert
                      </Badge>
                    )}
                    {pub.update && (
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        update
                      </Badge>
                    )}
                    {pub.delete && (
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        delete
                      </Badge>
                    )}
                    {pub.truncate && (
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        truncate
                      </Badge>
                    )}
                  </div>
                  {!pub.all_tables && (
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      {pub.tables.length > 0 ? pub.tables.join(", ") : "Keine Tabellen zugeordnet."}
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="subscriptions" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-3 flex justify-end">
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setSubDialogOpen(true)}
            >
              <PlusIcon className="size-3.5" />
              Neue Subskription
            </Button>
          </div>
          {subsLoading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Lade Subskriptionen…</p>
          ) : (subscriptions?.length ?? 0) === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Keine Subskriptionen.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {subscriptions!.map((sub) => (
                <motion.div
                  key={sub.name}
                  layout
                  transition={{ layout: SPRING_LAYOUT }}
                  className="rounded-lg border p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{sub.name}</span>
                    <Badge
                      variant={sub.enabled ? "default" : "outline"}
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {sub.enabled ? "aktiv" : "deaktiviert"}
                    </Badge>
                    {sub.slot_name && (
                      <span className="font-mono text-xs text-muted-foreground">
                        Slot: {sub.slot_name}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-7 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void handleDropSub(sub.name)}
                      title={`Subskription "${sub.name}" löschen`}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                  <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                    Publikationen: {sub.publications.join(", ")}
                  </p>
                  <p
                    className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70"
                    title={sub.connection_string}
                  >
                    {sub.connection_string}
                  </p>
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CreatePublicationDialog
        open={pubDialogOpen}
        onOpenChange={setPubDialogOpen}
        onSuccess={refresh}
      />
      <CreateSubscriptionDialog
        open={subDialogOpen}
        onOpenChange={setSubDialogOpen}
        onSuccess={refresh}
      />
    </main>
  );
}
