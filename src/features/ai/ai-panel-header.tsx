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
import { IconButton } from "@/components/icon-button";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { AiChatIcon } from "./ai-chat-icon";

const WAIT = "Erst nach der laufenden Antwort möglich";

export function AiPanelHeader({
  title,
  icon,
  titleNew,
  titleRef,
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
  icon?: string;
  titleNew?: boolean;
  titleRef?: Ref<HTMLSpanElement>;
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
        <IconButton
          size="icon"
          variant="ghost"
          aria-label="Als Seitenleiste öffnen"
          onClick={onRestore}
        >
          <PanelRightOpen className="size-4" />
        </IconButton>
      ) : view !== "chat" ? (
        <IconButton size="icon" variant="ghost" aria-label="Zurück zum Gespräch" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </IconButton>
      ) : null}
      <h2
        className={cn(
          "mr-auto flex min-w-0 items-center gap-2 text-[13px] font-semibold tracking-[-0.005em]",
          view === "chat" && !minimized && "pl-1.5",
        )}
      >
        {view === "chat" && icon && (
          <span ref={titleRef} className="grid shrink-0">
            <AiChatIcon name={icon} className="size-3.5 text-muted-foreground" />
          </span>
        )}
        <span className="truncate">
          {view === "settings" ? "Einstellungen" : view === "history" ? "Gespräche" : title}
        </span>
        {view === "chat" && icon && titleNew && <NewBadge />}
      </h2>
      {!minimized && view === "chat" && (
        <>
          <IconButton
            size="icon"
            variant="ghost"
            aria-label="Neues Gespräch"
            disabled={busy}
            disabledReason={WAIT}
            onClick={onNew}
          >
            <SquarePen className="size-4" />
          </IconButton>
          <IconButton
            data-feature="ai.history"
            size="icon"
            variant="ghost"
            aria-label="Gesprächsverlauf"
            title="Frühere Gespräche"
            disabled={busy}
            disabledReason={WAIT}
            onClick={onHistory}
          >
            <History className="size-4" />
          </IconButton>
          <DropdownMenu>
            <Tooltip delayDuration={350}>
              <TooltipTrigger asChild>
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
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>Ansicht und Einstellungen</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" sideOffset={6} className="w-auto min-w-56">
              <DropdownMenuItem onSelect={onFullPage}>
                <Maximize2 />
                Im Arbeitsbereich öffnen
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onMinimize}>
                <Minus />
                Minimieren
                {minimizeNew && <NewBadge className="ml-auto" />}
                <div ref={minimizeRef} className="pointer-events-none absolute inset-0" />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={busy} onSelect={onSettings}>
                <Settings2 />
                KI-Einstellungen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <IconButton
        size="icon"
        variant="ghost"
        aria-label="AI schließen"
        title="Schließen"
        onClick={onClose}
      >
        <X className="size-4" />
      </IconButton>
    </div>
  );
}
