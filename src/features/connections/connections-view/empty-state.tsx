import { useNavigate } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { BookOpen, FolderOpen, History, Keyboard, Link2, Plus, Route, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AppLogo } from "@/components/app-logo";
import { pasteText } from "@/lib/clipboard";
import { resolveOpenFiles } from "@/lib/db";
import { runOpenFileActions } from "@/lib/file-open";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { emitHotkeyAction } from "@/lib/hotkeys";
import { useNotebookStore } from "@/lib/notebook/store";
import { useTourStore } from "@/lib/tour/store";
import { WelcomeAction } from "./welcome-action";
import { WelcomeShortcuts } from "./welcome-shortcuts";

export function ConnectionsEmptyState({
  openEditor,
  setImportOpen,
  onPasteUrl,
}: {
  openEditor: (id: string | null) => void;
  setImportOpen: (open: boolean) => void;
  onPasteUrl: (url: string) => void;
}) {
  const navigate = useNavigate();
  const [openingFile, setOpeningFile] = useState(false);
  const recent = useNotebookStore((state) => state.recent);
  const { ref } = useNewFeatureVisibility<HTMLElement>("connections.welcome");

  async function openFile() {
    if (openingFile) return;
    setOpeningFile(true);
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Datenbanken und Dateien",
            extensions: ["db", "sqlite", "sqlite3", "duckdb", "csv", "parquet", "sql", "l8nb"],
          },
        ],
      });
      if (typeof path !== "string") return;
      const target = await runOpenFileActions(await resolveOpenFiles([path]));
      if (target?.to === "/query/$id") await navigate({ to: target.to, params: { id: target.id } });
      else if (target) await navigate({ to: target.to });
    } catch {
      toast.error("Datei konnte nicht geöffnet werden.");
    } finally {
      setOpeningFile(false);
    }
  }

  async function openRecent(path: string) {
    const { openNotebook } = await import("@/lib/notebook/actions");
    if (await openNotebook(path)) await navigate({ to: "/notebook" });
  }

  return (
    <section
      ref={ref}
      aria-label="Willkommen bei l8db"
      className="@container min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-5xl px-2 pt-8 pb-12 sm:px-6 sm:pt-14 lg:px-10 lg:pt-20">
        <header className="mb-12 flex items-center gap-4">
          <AppLogo alt="" className="size-14 shadow-sm" />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">l8db</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Datenbanken verbinden, abfragen und verwalten.
            </p>
          </div>
        </header>
        <div className="grid gap-12 @min-[44rem]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] @min-[44rem]:gap-16">
          <div className="min-w-0 space-y-10">
            <section aria-labelledby="welcome-start">
              <h2 id="welcome-start" className="mb-3 text-sm font-semibold">
                Starten
              </h2>
              <div className="space-y-1">
                <WelcomeAction
                  icon={Plus}
                  label="Neue Verbindung…"
                  description="Mit deiner Datenbank verbinden"
                  primary
                  dataTour="connection-add"
                  onClick={() => openEditor("new")}
                />
                <WelcomeAction
                  icon={Link2}
                  label="Verbindungs-URL einfügen…"
                  onClick={() =>
                    void pasteText()
                      .catch(() => "")
                      .then(onPasteUrl)
                  }
                />
                <WelcomeAction
                  icon={FolderOpen}
                  label={openingFile ? "Datei wird geöffnet…" : "Datei öffnen…"}
                  description="SQLite, DuckDB, CSV, Parquet, SQL"
                  disabled={openingFile}
                  onClick={() => void openFile()}
                />
                <WelcomeAction
                  icon={Upload}
                  label="Profile importieren…"
                  description="Aus anderen Datenbank-Tools"
                  onClick={() => setImportOpen(true)}
                />
              </div>
            </section>
            <section aria-labelledby="welcome-recent">
              <h2 id="welcome-recent" className="mb-3 text-sm font-semibold">
                Zuletzt geöffnet
              </h2>
              {recent.length > 0 ? (
                <div className="space-y-1">
                  {recent.slice(0, 5).map((entry) => (
                    <WelcomeAction
                      key={entry.path}
                      icon={BookOpen}
                      label={entry.name}
                      description="Notebook"
                      onClick={() => void openRecent(entry.path)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-xl bg-muted/35 p-4">
                  <History
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground/70"
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Dein Arbeitsplatz beginnt hier. Öffne eine Datenbank oder eine Datei, um
                    loszulegen.
                  </p>
                </div>
              )}
            </section>
          </div>
          <aside aria-label="Tastenkürzel und Hilfe" className="min-w-0 space-y-10">
            <WelcomeShortcuts />
            <section aria-labelledby="welcome-help">
              <h2 id="welcome-help" className="mb-3 text-sm font-semibold">
                Hilfe
              </h2>
              <div className="space-y-1">
                <WelcomeAction
                  icon={BookOpen}
                  label="Dokumentation"
                  onClick={() => void navigate({ to: "/docs" })}
                />
                <WelcomeAction
                  icon={Route}
                  label="Produkttour starten"
                  onClick={() => useTourStore.getState().startFromBeginning()}
                />
                <WelcomeAction
                  icon={Keyboard}
                  label="Alle Tastenkürzel"
                  onClick={() => emitHotkeyAction("shortcuts.open")}
                />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
