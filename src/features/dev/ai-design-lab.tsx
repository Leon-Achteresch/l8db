import {
  ArrowLeft,
  ArrowUpRight,
  Database,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelLeftClose,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AiLabApproval } from "./ai-lab-approval";
import { AiLabChat } from "./ai-lab-chat";
import { AiLabContext } from "./ai-lab-context";
import { AI_LAB_SCENES, type AiLabScene } from "./ai-lab-data";
import { AiLabEditor } from "./ai-lab-editor";
import { AiLabMcp } from "./ai-lab-mcp";
import { AiLabSettings } from "./ai-lab-settings";

export function AiDesignLab({ initialScene = "start" }: { initialScene?: AiLabScene }) {
  const [scene, setScene] = useState<AiLabScene>(initialScene);
  const [narrow, setNarrow] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [revision, setRevision] = useState(0);
  const selected = AI_LAB_SCENES.find((item) => item.id === scene) ?? AI_LAB_SCENES[0];
  const changeScene = (next: AiLabScene) => {
    setScene(next);
    setRevision((value) => value + 1);
  };

  return (
    <section
      aria-label="KI-Chat und MCP Design-Lab"
      className={cn(
        "space-y-5",
        fullscreen &&
          "fixed inset-3 z-50 flex flex-col overflow-auto rounded-2xl border bg-background p-5 shadow-2xl",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Sparkles className="size-4 text-primary" /> KI-Chat & MCP
          </h2>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            Echte App-Komponenten · interaktive Beispieldaten · keine KI- oder Datenbankaufrufe
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={narrow ? "secondary" : "ghost"}
            aria-pressed={narrow}
            onClick={() => setNarrow(!narrow)}
          >
            Schmale Ansicht
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRevision(revision + 1)}>
            <RotateCcw className="size-3.5" /> Zurücksetzen
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFullscreen(!fullscreen)}>
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            {fullscreen ? "Vorschau verkleinern" : "Vorschau vergrößern"}
          </Button>
        </div>
      </div>
      <fieldset aria-label="KI-Szenario auswählen" className="flex shrink-0 flex-wrap gap-1.5">
        {AI_LAB_SCENES.map((item, index) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={scene === item.id}
            onClick={() => changeScene(item.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              scene === item.id && "border-primary/40 bg-primary/5 font-medium text-primary",
            )}
          >
            <span className="font-mono text-[10px] opacity-60">0{index + 1}</span>
            {item.title}
          </button>
        ))}
      </fieldset>
      <div
        className={cn(
          "mx-auto flex h-[760px] min-h-[480px] w-full overflow-hidden rounded-xl border bg-background shadow-sm",
          narrow && "max-w-[560px]",
          fullscreen && "min-h-0 flex-1",
        )}
      >
        {sidebar && !narrow && (
          <aside className="hidden w-48 shrink-0 flex-col border-r bg-sidebar/50 p-3 xl:flex">
            <div className="mb-5 flex items-center justify-between gap-2 px-1">
              <span className="text-xs font-semibold">Gespräche</span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Gesprächsleiste einklappen"
                onClick={() => setSidebar(false)}
              >
                <PanelLeftClose className="size-3.5" />
              </Button>
            </div>
            <Button size="sm" className="justify-start" onClick={() => changeScene("start")}>
              <Plus className="size-3.5" /> Neues Gespräch
            </Button>
            <p className="mt-7 mb-2 px-2 text-[10px] tracking-widest text-muted-foreground uppercase">
              Heute
            </p>
            {[
              { label: "Umsatzrückgang verstehen", target: "results" },
              { label: "Kundenabfrage verbessern", target: "editor" },
            ].map((entry) => (
              <button
                key={entry.label}
                type="button"
                onClick={() => changeScene(entry.target as AiLabScene)}
                className="rounded-lg px-2 py-3 text-left text-xs leading-5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MessageSquare className="mb-2 size-3.5 text-muted-foreground" />
                {entry.label}
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  Shop · Beispielgespräch
                </span>
              </button>
            ))}
            <div className="mt-auto space-y-4 border-t px-2 pt-4">
              <div className="flex items-center gap-2 text-xs">
                <Database className="size-3.5 text-primary" /> Shop · PostgreSQL
              </div>
              <Button size="xs" variant="ghost" onClick={() => changeScene("context")}>
                <Search className="size-3" /> Kontext auswählen
              </Button>
              <Button size="xs" variant="ghost" onClick={() => changeScene("mcp")}>
                <ArrowUpRight className="size-3" /> MCP-Verbindungen
              </Button>
            </div>
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              {!sidebar && !narrow && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Gesprächsleiste öffnen"
                  onClick={() => setSidebar(true)}
                >
                  <ArrowLeft className="size-3.5" />
                </Button>
              )}
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium">
                  {selected.title === "Einstieg" ? "Neues Gespräch" : selected.title}
                </h3>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {selected.description}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              Beispieldaten
            </Badge>
          </header>
          <div key={`${scene}-${revision}`} className="@container min-h-0 min-w-0 flex-1">
            {scene === "editor" ? (
              <AiLabEditor />
            ) : scene === "approval" ? (
              <AiLabApproval />
            ) : scene === "context" ? (
              <AiLabContext />
            ) : scene === "settings" ? (
              <AiLabSettings />
            ) : scene === "mcp" ? (
              <AiLabMcp />
            ) : (
              <AiLabChat scene={scene} narrow={narrow} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
