import {
  ArrowLeft,
  Ellipsis,
  History,
  Maximize2,
  Minus,
  PanelRightOpen,
  Settings2,
  SquarePen,
  X,
} from "lucide-react";
import type { Ref } from "react";
import { IconMenu, IconMenuContent, IconMenuItem, IconMenuSeparator } from "@/components/icon-menu";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function AiPanelHeader({
  title,
  view,
  minimized,
  busy,
  minimizeNew,
  minimizeRef,
  onBack,
  onNew,
  onHistory,
  onSettings,
  onFullPage,
  onMinimize,
  onRestore,
  onClose,
}: {
  title: string;
  view: "chat" | "settings" | "history";
  minimized: boolean;
  busy: boolean;
  minimizeNew: boolean;
  minimizeRef: Ref<HTMLDivElement>;
  onBack: () => void;
  onNew: () => void;
  onHistory: () => void;
  onSettings: () => void;
  onFullPage: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={cn(
        "shrink-0 items-center gap-0.5 px-2",
        minimized ? "hidden h-11 group-data-active/mini:flex" : "flex h-12",
      )}
    >
      {minimized ? (
        <Button
          size="icon"
          variant="ghost"
          aria-label="Als Seitenleiste öffnen"
          onClick={onRestore}
        >
          <PanelRightOpen className="size-4" />
        </Button>
      ) : view !== "chat" ? (
        <Button size="icon" variant="ghost" aria-label="Zurück zum Gespräch" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
      ) : null}
      <h2
        className={cn(
          "mr-auto min-w-0 truncate text-[13px] font-semibold tracking-[-0.005em]",
          view === "chat" && !minimized && "pl-1.5",
        )}
      >
        {view === "settings" ? "Einstellungen" : view === "history" ? "Gespräche" : title}
      </h2>
      {!minimized && view === "chat" && (
        <>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Neues Gespräch"
            title="Neues Gespräch"
            disabled={busy}
            onClick={onNew}
          >
            <SquarePen className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Gesprächsverlauf"
            title="Gesprächsverlauf"
            disabled={busy}
            onClick={onHistory}
          >
            <History className="size-4" />
          </Button>
          <IconMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Weitere Aktionen"
                className="relative"
              >
                <Ellipsis className="size-4" />
                {minimizeNew && (
                  <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <IconMenuContent>
              <IconMenuItem
                icon={<Maximize2 />}
                label="Im Arbeitsbereich öffnen"
                onSelect={onFullPage}
              />
              <IconMenuItem icon={<Minus />} label="Minimieren" onSelect={onMinimize}>
                <div ref={minimizeRef} className="pointer-events-none absolute inset-0" />
                {minimizeNew && <NewBadge className="absolute -right-1 -top-1" />}
              </IconMenuItem>
              <IconMenuSeparator />
              <IconMenuItem
                icon={<Settings2 />}
                label="KI-Einstellungen"
                disabled={busy}
                onSelect={onSettings}
              />
            </IconMenuContent>
          </IconMenu>
        </>
      )}
      <Button
        size="icon"
        variant="ghost"
        aria-label="AI schließen"
        title="Schließen"
        onClick={onClose}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
