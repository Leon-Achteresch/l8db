import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon, RadioIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveConnection } from "@/lib/connections";
import { dropPublication, dropSubscription } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { usePublicationsQuery, useSubscriptionsQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { CreatePublicationDialog } from "./replication-view/create-publication-dialog";
import { CreateSubscriptionDialog } from "./replication-view/create-subscription-dialog";

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
