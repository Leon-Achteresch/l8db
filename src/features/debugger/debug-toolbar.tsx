import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CornerDownRight,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DebugAction } from "@/lib/db";

interface DebugToolbarProps {
  active: boolean;
  paused: boolean;
  busy: boolean;
  available: boolean;
  stepOut: boolean;
  hasSource: boolean;
  onStart: () => void;
  onStop: () => void;
  onEdit: () => void;
  onAction: (action: DebugAction) => void;
}

export function DebugToolbar(props: DebugToolbarProps) {
  return (
    <fieldset className="debug-toolbar" aria-label="Debug-Steuerung">
      <Button
        aria-label={props.active ? "Weiter" : "Starten"}
        className="debug-run-button"
        size="sm"
        disabled={props.busy || (props.active ? !props.paused : !props.available)}
        onClick={() => (props.active ? props.onAction({ type: "continue" }) : props.onStart())}
        title={props.active ? "Weiter (F5)" : "Starten (F5)"}
      >
        <Play className="size-3.5 fill-current" />
        {props.active ? "Weiter" : "Starten"}
        <kbd>F5</kbd>
      </Button>
      <span className="debug-toolbar-divider" />
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={!props.paused}
          onClick={() => props.onAction({ type: "step_over" })}
          aria-label="Darüber"
          title="Darüber (F10)"
        >
          <CornerDownRight />
          Darüber<kbd className="debug-shortcut">F10</kbd>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!props.paused}
          onClick={() => props.onAction({ type: "step_into" })}
          aria-label="Hinein"
          title="Hinein (F11)"
        >
          <ArrowDownToLine />
          Hinein<kbd className="debug-shortcut">F11</kbd>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!props.paused || !props.stepOut}
          onClick={() => props.onAction({ type: "step_out" })}
          title="Heraus (Shift+F11)"
        >
          <ArrowUpFromLine />
          Heraus
        </Button>
      </div>
      <span className="debug-toolbar-divider" />
      <Button
        size="sm"
        variant="ghost"
        disabled={!props.active || props.busy}
        onClick={props.onStop}
        className="debug-stop-button"
        title="Stoppen (Shift+F5)"
      >
        <Square className="size-3 fill-current" />
        Stoppen
      </Button>
      {!props.active && props.hasSource ? (
        <Button className="ml-auto" size="sm" variant="ghost" onClick={props.onEdit}>
          <RotateCcw />
          Aufruf bearbeiten
        </Button>
      ) : null}
    </fieldset>
  );
}
