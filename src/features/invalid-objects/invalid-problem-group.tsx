import { Hammer, Loader } from "lucide";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { Button } from "@/components/ui/button";
import {
  INVALID_ERRORS_PER_OBJECT,
  type InvalidProblem,
  invalidTypeLabel,
} from "@/lib/invalid-objects";
import { cn } from "@/lib/utils";
import { InvalidMessageRow } from "./invalid-message-row";
import { InvalidTypeIcon } from "./invalid-type-icon";

export function InvalidProblemGroup({
  problem,
  open,
  compiling,
  blocked,
  messages,
  onToggle,
  onOpen,
  onCompile,
}: {
  problem: InvalidProblem;
  open: boolean;
  compiling: boolean;
  blocked: boolean;
  messages: "loading" | "error" | "ready";
  onToggle: () => void;
  onOpen: () => void;
  onCompile: () => void;
}) {
  const { item, errors } = problem;
  const synonym = item.object_type.toUpperCase() === "SYNONYM";
  const shown = errors.slice(0, INVALID_ERRORS_PER_OBJECT);
  return (
    <li>
      <div className="group flex h-7 items-center gap-1.5 pr-3 pl-2 hover:bg-muted/60">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <InvalidTypeIcon objectType={item.object_type} className="size-3.5" />
          <span className="truncate font-medium">{item.name}</span>
          <span className="shrink-0 font-sans text-[11px] text-muted-foreground">
            {item.schema} · {invalidTypeLabel(item.object_type)}
          </span>
          {messages === "ready" && (
            <span className="ml-1 shrink-0 rounded-full bg-muted px-1.5 font-sans text-[10px] text-muted-foreground tabular-nums">
              {errors.length}
              <span className="sr-only"> Meldungen</span>
            </span>
          )}
        </button>
        <span
          className={cn(
            "flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
            compiling && "opacity-100",
          )}
        >
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onOpen}
            title="Öffnen"
            aria-label="Öffnen"
          >
            <ExternalLinkIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={compiling || blocked || synonym}
            onClick={onCompile}
            title={synonym ? "Synonyme können nicht kompiliert werden" : "Einzeln kompilieren"}
            aria-label="Kompilieren"
          >
            <MorphIcon
              icon={compiling ? Loader : Hammer}
              className={cn(compiling && "animate-spin")}
            />
          </Button>
        </span>
      </div>
      {open &&
        (messages !== "ready" ? (
          <p
            className={cn(
              "h-6 pl-[3.25rem] font-sans text-[11px] leading-6",
              messages === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {messages === "error" ? "Meldungen nicht geladen" : "Lade Meldungen…"}
          </p>
        ) : errors.length === 0 ? (
          <p className="h-6 pl-[3.25rem] font-sans text-[11px] leading-6 text-muted-foreground">
            {synonym ? "Ziel des Synonyms fehlt oder ist invalid" : "Keine Meldung in ALL_ERRORS"}
          </p>
        ) : (
          <ul>
            {shown.map((error, index) => (
              <InvalidMessageRow key={`${error.line}-${error.position}-${index}`} message={error} />
            ))}
            {errors.length > shown.length && (
              <li className="h-6 pl-[3.25rem] font-sans text-[11px] leading-6 text-muted-foreground">
                +{errors.length - shown.length} weitere{" "}
                {errors.length - shown.length === 1 ? "Meldung" : "Meldungen"}
              </li>
            )}
          </ul>
        ))}
    </li>
  );
}
