import { useQueryClient } from "@tanstack/react-query";
import { InboxIcon, PlusIcon, RadioIcon, SendIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmActionDialog } from "@/features/storage/confirm-action-dialog";
import { useActiveConnection } from "@/lib/connections";
import { dropPublication, dropSubscription } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { errorMessageOf } from "@/lib/error-details";
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
  const [pendingDrop, setPendingDrop] = useState<{
    kind: "publication" | "subscription";
    name: string;
  } | null>(null);
  const { data: publications, isLoading: pubsLoading, error: pubsError } = usePublicationsQuery();
  const { data: subscriptions, isLoading: subsLoading, error: subsError } = useSubscriptionsQuery();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["publications"] });
    void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
  };

  const confirmDrop = async () => {
    if (!connection || !pendingDrop) return;
    const drop = pendingDrop.kind === "publication" ? dropPublication : dropSubscription;
    await drop(
      connection.kind,
      effectiveConnectionString(connection),
      pendingDrop.name,
      database ?? undefined,
    );
    toast.success(
      `${pendingDrop.kind === "publication" ? "Publikation" : "Subskription"} "${pendingDrop.name}" gelöscht.`,
    );
    refresh();
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
          ) : pubsError ? (
            <p role="alert" className="p-8 text-center text-sm text-destructive">
              Publikationen konnten nicht geladen werden: {errorMessageOf(pubsError)}
            </p>
          ) : (publications?.length ?? 0) === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SendIcon />
                </EmptyMedia>
                <EmptyTitle>Keine Publikationen</EmptyTitle>
                <EmptyDescription>
                  Eine Publikation legt fest, welche Tabellen per logischer Replikation an
                  Subskribenten gehen.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" variant="outline" onClick={() => setPubDialogOpen(true)}>
                  <PlusIcon data-icon="inline-start" />
                  Publikation anlegen
                </Button>
              </EmptyContent>
            </Empty>
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
                      onClick={() => setPendingDrop({ kind: "publication", name: pub.name })}
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
          ) : subsError ? (
            <p role="alert" className="p-8 text-center text-sm text-destructive">
              Subskriptionen konnten nicht geladen werden: {errorMessageOf(subsError)}
            </p>
          ) : (subscriptions?.length ?? 0) === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <InboxIcon />
                </EmptyMedia>
                <EmptyTitle>Keine Subskriptionen</EmptyTitle>
                <EmptyDescription>
                  Eine Subskription empfängt Änderungen aus der Publikation einer anderen Datenbank.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" variant="outline" onClick={() => setSubDialogOpen(true)}>
                  <PlusIcon data-icon="inline-start" />
                  Subskription anlegen
                </Button>
              </EmptyContent>
            </Empty>
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
                      onClick={() => setPendingDrop({ kind: "subscription", name: sub.name })}
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
      <ConfirmActionDialog
        open={pendingDrop !== null}
        title={pendingDrop?.kind === "publication" ? "Publikation löschen" : "Subskription löschen"}
        description={
          pendingDrop?.kind === "publication"
            ? `Publikation "${pendingDrop.name}" wirklich löschen?`
            : `Subskription "${pendingDrop?.name}" wirklich löschen? Der Provider-Slot wird dabei mit gelöscht.`
        }
        confirmLabel="Löschen"
        onOpenChange={(open) => {
          if (!open) setPendingDrop(null);
        }}
        onConfirm={confirmDrop}
      />
    </main>
  );
}
