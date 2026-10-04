import { Check, ChevronDown, Database, Lock } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type AiAccessLevel = "locked" | "read" | "write" | "ddl";

const LEVELS = [
  {
    id: "read",
    label: "Nur lesen",
    hint: "Abfragen und Diagramme, keine Änderungen",
    dot: "bg-emerald-500",
  },
  {
    id: "write",
    label: "Daten ändern",
    hint: "INSERT, UPDATE, DELETE nach deiner Freigabe",
    dot: "bg-amber-500",
  },
  {
    id: "ddl",
    label: "Schema ändern",
    hint: "Auch Tabellen anlegen, ändern und löschen",
    dot: "bg-red-500",
  },
] as const;

const TONE: Record<AiAccessLevel | "production", string> = {
  locked: "bg-emerald-500/[0.06] text-emerald-900 dark:text-emerald-200",
  read: "bg-emerald-500/[0.06] text-emerald-900 dark:text-emerald-200",
  write: "bg-amber-500/[0.1] text-amber-950 dark:text-amber-200",
  ddl: "bg-red-500/[0.08] text-red-950 dark:text-red-200",
  production: "bg-red-500/[0.08] text-red-950 dark:text-red-200",
};

const trigger =
  "flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 data-[state=open]:bg-foreground/[0.06]";

export function AiAccessStrip({
  level,
  production,
  connectionLabel,
  connections,
  onLevel,
  disabled,
  approval,
  trailing,
  className,
}: {
  level: AiAccessLevel;
  production: boolean;
  connectionLabel: string;
  connections: ReactNode;
  onLevel: (level: "read" | "write" | "ddl") => void;
  disabled: boolean;
  approval: ReactNode;
  trailing: ReactNode;
  className?: string;
}) {
  const current = LEVELS.find((entry) => entry.id === level);
  const tone = production && level !== "locked" && level !== "read" ? "production" : level;
  return (
    <div
      role="toolbar"
      aria-label="Zugriff der KI"
      className={cn(
        "flex h-9 min-w-0 items-center gap-0.5 border-b border-foreground/[0.07] px-1.5 transition-colors duration-300",
        TONE[tone],
        className,
      )}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Kontext"
            title="Verbindungen im Gespräch"
            className={cn(trigger, "max-w-[45%] font-medium")}
          >
            <Database className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate">{connectionLabel}</span>
            {production && (
              <span className="shrink-0 rounded bg-red-500/15 px-1 text-[10px] font-semibold text-red-700 dark:text-red-300">
                Produktion
              </span>
            )}
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          className="w-72 max-w-[calc(100vw-32px)] rounded-2xl p-0 shadow-lg"
          aria-label="AI-Kontext"
        >
          {connections}
        </PopoverContent>
      </Popover>
      <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-current opacity-15" />
      {level === "locked" ? (
        <span
          className={cn(trigger, "pointer-events-none")}
          title="Verbindung ist schreibgeschützt"
        >
          <Lock className="size-3.5 opacity-70" />
          Schreibgeschützt
        </span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Zugriff: ${current?.label}`}
              disabled={disabled}
              className={trigger}
            >
              <span className={cn("size-2 shrink-0 rounded-full", current?.dot)} />
              {current?.label}
              <ChevronDown className="size-3 shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-72 rounded-2xl">
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
              Was darf die KI in diesem Gespräch?
            </DropdownMenuLabel>
            {LEVELS.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                onSelect={() => onLevel(entry.id)}
                className="items-start gap-2.5 rounded-lg py-2"
              >
                <span className={cn("mt-1 size-2 shrink-0 rounded-full", entry.dot)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{entry.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{entry.hint}</span>
                </span>
                {entry.id === level && <Check className="mt-0.5 size-3.5 shrink-0" />}
              </DropdownMenuItem>
            ))}
            <p className="px-2 pt-1 pb-1.5 text-[10px] leading-relaxed text-muted-foreground">
              Verbindungsschutz, Produktionssperren und Maskierung gelten immer.
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-current opacity-15" />
      {approval}
      <span className="min-w-2 flex-1" />
      {trailing}
    </div>
  );
}
