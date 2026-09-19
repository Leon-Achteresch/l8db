import { ChevronDown, CornerDownRight, Eye, Layers, Plus, Search, Variable, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DebugAction, DebugSnapshot } from "@/lib/db";

interface DebugInspectorProps {
  snapshot?: DebugSnapshot;
  paused: boolean;
  onAction: (action: DebugAction) => void;
}

export function DebugInspector({ snapshot, paused, onAction }: DebugInspectorProps) {
  const [filter, setFilter] = useState("");
  const [watchName, setWatchName] = useState("");
  const variables =
    snapshot?.variables.filter((v) => v.name.toLowerCase().includes(filter.toLowerCase())) ?? [];
  const watches = snapshot?.watches ?? [];
  return (
    <aside className="debug-inspector" aria-label="Debug-Inspektion">
      <div className="debug-pane-heading">
        <span>Inspektion</span>
        <span className="text-[10px] font-normal text-muted-foreground">
          {paused ? "Aktueller Frame" : "Sitzung"}
        </span>
      </div>
      <details className="debug-section" open>
        <summary>
          <ChevronDown className="debug-section-chevron" />
          <Layers />
          <span>Call Stack</span>
          <span className="debug-count">{snapshot?.frames.length ?? 0}</span>
        </summary>
        <div className="pb-3">
          {snapshot?.frames.map((frame, index) => (
            <button
              type="button"
              key={frame.id}
              disabled={!paused}
              aria-pressed={frame.id === snapshot.selectedFrame}
              className="debug-stack-frame"
              onClick={() => onAction({ type: "select_frame", frame: frame.id })}
            >
              <span className="debug-frame-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1 truncate font-mono" title={frame.name}>
                {frame.name}
              </span>
              <span className="debug-frame-line">:{frame.line}</span>
              <CornerDownRight className="size-3.5 shrink-0" />
            </button>
          ))}
          {!snapshot?.frames.length ? (
            <p className="debug-empty">Der Aufrufpfad erscheint, sobald die Ausführung anhält.</p>
          ) : null}
        </div>
      </details>
      <details className="debug-section" open>
        <summary>
          <ChevronDown className="debug-section-chevron" />
          <Variable />
          <span>Variablen und Parameter</span>
          <span className="debug-count">{snapshot?.variables.length ?? 0}</span>
        </summary>
        <div className="debug-search">
          <Search className="size-3.5" />
          <input
            aria-label="Variablen filtern"
            placeholder="Variablen filtern …"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {variables.length ? (
          <table className="debug-variable-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Wert</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((variable, index) => (
                <tr key={`${variable.name}-${index}`}>
                  <td title={variable.datatype}>
                    <span className="debug-variable-symbol">v</span>
                    {variable.name}
                  </td>
                  <td className={variable.value === null ? "debug-null" : ""}>
                    {variable.value ?? "NULL"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="debug-empty">
            {filter
              ? "Keine passende Variable."
              : paused
                ? "In diesem Frame sind keine Variablen verfügbar."
                : "Lokale Werte werden beim nächsten Halt angezeigt."}
          </p>
        )}
      </details>
      <details className="debug-section" open>
        <summary>
          <ChevronDown className="debug-section-chevron" />
          <Eye />
          <span>Watches</span>
          <span className="debug-count">{watches.length}</span>
        </summary>
        <form
          className="debug-watch-form"
          onSubmit={(event) => {
            event.preventDefault();
            const name = watchName.trim();
            if (!name || !paused) return;
            onAction({
              type: "watches",
              names: [...new Set([...watches.map((w) => w.name), name])],
            });
            setWatchName("");
          }}
        >
          <input
            aria-label="Watch hinzufügen"
            placeholder="Variable beobachten …"
            value={watchName}
            onChange={(e) => setWatchName(e.target.value)}
          />
          <Button
            size="icon-xs"
            type="submit"
            variant="ghost"
            aria-label="Watch hinzufügen bestätigen"
            disabled={!paused || !watchName.trim()}
          >
            <Plus className="size-3.5" />
          </Button>
        </form>
        {!watches.length ? (
          <p className="debug-empty pt-0">
            Behalte ausgewählte Werte über mehrere Schritte im Blick.
          </p>
        ) : (
          watches.map((watch) => (
            <div className="debug-watch-row" key={watch.name}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono" title={watch.name}>
                  {watch.name}
                </span>
                <button
                  className="debug-remove-watch"
                  type="button"
                  aria-label={`Watch ${watch.name} entfernen`}
                  disabled={!paused}
                  onClick={() =>
                    onAction({
                      type: "watches",
                      names: watches.filter((w) => w.name !== watch.name).map((w) => w.name),
                    })
                  }
                >
                  <X className="size-3" />
                </button>
              </div>
              <pre className={watch.error ? "text-destructive" : "text-muted-foreground"}>
                {watch.error ?? watch.value ?? "NULL"}
              </pre>
            </div>
          ))
        )}
      </details>
    </aside>
  );
}
