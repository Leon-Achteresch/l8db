import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { ProviderLogo } from "@/components/provider-logo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SPRING_LAYOUT } from "@/lib/ease";
import { activateConnectionWithToast } from "@/lib/ssh";
import { BAAS_PROVIDERS } from "./baas-providers";
import { type BaasSection, DATABASE_LABEL, PROVIDER_SECTIONS, SECTION_INFO } from "./baas-sections";
import { disconnectBaas } from "./disconnect-baas";
import { SupabaseDatabaseConnectDialog } from "./supabase-database-connect-dialog";
import type { BaasConnection } from "./use-baas-connections";
import { useSupabaseDatabase } from "./use-supabase-database";

export function BaasConnectionCard({
  connection,
  onEditDatabase,
}: {
  connection: BaasConnection;
  onEditDatabase: (id: string) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();
  const [confirm, setConfirm] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const supabase = connection.provider === "supabase" && Boolean(connection.id);
  const database = useSupabaseDatabase(supabase ? connection.id : "");
  const providerName = BAAS_PROVIDERS.find((item) => item.id === connection.provider)?.name;
  const [primary, ...sections] = PROVIDER_SECTIONS[connection.provider];
  const PrimaryIcon = SECTION_INFO[primary].icon;

  function open(section?: BaasSection) {
    void navigate({
      to: "/baas",
      search: { provider: connection.provider, id: connection.id || undefined, section },
    });
  }

  async function openSql(id: string) {
    if (await activateConnectionWithToast(id)) await navigate({ to: "/" });
  }

  async function remove() {
    try {
      await disconnectBaas(connection);
      await queryClient.invalidateQueries({ queryKey: [connection.provider] });
      toast.success(`${providerName}-Zugang entfernt`);
    } catch (reason) {
      toast.error(String(reason));
    }
  }

  return (
    <motion.article
      layout
      initial={reduce ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ layout: SPRING_LAYOUT }}
      onDoubleClick={() => open()}
      className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card p-4 transition-all duration-200 hover:border-foreground/25 hover:shadow-md"
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg border bg-background/80 shadow-2xs transition-transform group-hover:scale-105">
              <ProviderLogo providerId={connection.provider} className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3
                className="truncate text-sm font-semibold tracking-tight text-foreground"
                title={connection.name}
              >
                {connection.name}
              </h3>
              <p className="truncate text-[11px] text-muted-foreground">
                {providerName} · {connection.detail}
              </p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${connection.name} Aktionen`}
                className="text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => open()}>
                <ArrowUpRight className="size-3.5" />
                Projekt öffnen
              </DropdownMenuItem>
              {database && (
                <DropdownMenuItem onSelect={() => onEditDatabase(database.id)}>
                  <Pencil className="size-3.5" />
                  Datenbankverbindung bearbeiten
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
                <Trash2 className="size-3.5" />
                Zugang entfernen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 p-2.5 text-[11px]">
          <PrimaryIcon className="size-3.5 shrink-0 text-muted-foreground/80" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground/90">
              {DATABASE_LABEL[connection.provider]}
            </p>
            {supabase && (
              <p className="flex items-center gap-1 truncate text-muted-foreground">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${database ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                />
                {database ? "Im SQL-Arbeitsplatz verbunden" : "Noch nicht verbunden"}
              </p>
            )}
          </div>
          {supabase ? (
            database ? (
              <Button size="xs" variant="outline" onClick={() => void openSql(database.id)}>
                SQL öffnen
              </Button>
            ) : (
              <Button size="xs" variant="outline" onClick={() => setConnecting(true)}>
                Verbinden
              </Button>
            )
          ) : (
            <Button size="xs" variant="outline" onClick={() => open(primary)}>
              Öffnen
            </Button>
          )}
        </div>

        {sections.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {sections.map((section) => {
              const Icon = SECTION_INFO[section].icon;
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => open(section)}
                  className="inline-flex h-6 items-center gap-1 rounded-full border bg-background px-2 text-[11px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon className="size-3" />
                  {SECTION_INFO[section].label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end border-t border-border/40 pt-3">
        <Button variant="default" size="xs" onClick={() => open()} className="gap-1 shadow-2xs">
          <Play className="size-3" />
          Projekt öffnen
        </Button>
      </div>

      {supabase && (
        <SupabaseDatabaseConnectDialog
          reference={connection.id}
          name={connection.name}
          open={connecting}
          onOpenChange={setConnecting}
        />
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{providerName}-Zugang entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              {connection.provider === "supabase"
                ? "Der Supabase-Zugangstoken wird aus dem Schlüsselbund entfernt. Das betrifft alle Supabase-Projekte. Verbundene Datenbanken bleiben als Verbindung erhalten."
                : `„${connection.name}“ und die gespeicherten Zugangsdaten werden aus l8db entfernt. Das Projekt selbst bleibt erhalten.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Entfernen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.article>
  );
}
