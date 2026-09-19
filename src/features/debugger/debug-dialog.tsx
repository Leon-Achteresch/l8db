import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type DebugAction,
  type DebugAvailability,
  type DebugBreakpoint,
  type DebugContext,
  type DebugSnapshot,
  debugAction,
  debugAvailability,
  debugLaunch,
  debugSnapshot,
  debugStop,
} from "@/lib/db";
import type { DebugButtonProps } from "./debug-button";
import { DebugEditor } from "./debug-editor";

const labels: Record<DebugSnapshot["status"], string> = {
  starting: "Verbindung wird aufgebaut",
  running: "Läuft",
  paused: "Angehalten",
  finished: "Beendet",
  error: "Fehler",
  stopped: "Abgebrochen",
};

function initialCall(props: DebugButtonProps, context: DebugContext): string {
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const name = [
    props.schema,
    props.name,
    ...(props.objectType === "package_body" && props.member ? [props.member] : []),
  ]
    .map(quote)
    .join(".");
  if (context.kind === "oracle")
    return props.objectType === "function" || props.memberKind === "FUNCTION"
      ? `DECLARE\n  result_value VARCHAR2(32767);\nBEGIN\n  result_value := ${name}();\nEND;`
      : `BEGIN\n  ${name}();\nEND;`;
  return `${props.objectType === "function" ? "SELECT" : "CALL"} ${name}();`;
}

export function DebugDialog(
  props: DebugButtonProps & { context: DebugContext; onClose: () => void },
) {
  const [context] = useState(props.context);
  const [availability, setAvailability] = useState<DebugAvailability>();
  const [sql, setSql] = useState(() => initialCall(props, context));
  const [snapshot, setSnapshot] = useState<DebugSnapshot>();
  const [breakpoints, setBreakpoints] = useState<DebugBreakpoint[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [watch, setWatch] = useState("");
  const [watchName, setWatchName] = useState("");
  const session = useRef<string | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void debugAvailability(context)
      .then((result) => {
        if (mounted.current) setAvailability(result);
      })
      .catch((e) => {
        if (mounted.current) setError(String(e));
      });
    return () => {
      mounted.current = false;
      if (session.current) void debugStop(context, session.current).catch(() => undefined);
    };
  }, [context]);

  const pollId = snapshot?.id;
  const pollStatus = snapshot?.status;
  useEffect(() => {
    if (!pollId || !pollStatus || !["starting", "running", "paused"].includes(pollStatus)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await debugSnapshot(context, pollId);
        if (!cancelled) setSnapshot(next);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
      if (!cancelled) timer = setTimeout(poll, pollStatus === "paused" ? 1000 : 350);
    };
    timer = setTimeout(poll, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [context, pollId, pollStatus]);

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      if (session.current) {
        await debugStop(context, session.current);
        session.current = undefined;
      }
      const id = crypto.randomUUID();
      const next = await debugLaunch(context, { id, oid: props.oid, sql, breakpoints });
      session.current = id;
      if (!mounted.current) {
        await debugStop(context, id);
        return;
      }
      setSnapshot(next);
    });

  const act = (action: DebugAction) =>
    run(async () => {
      if (!snapshot) return;
      await debugAction(context, snapshot.id, action);
      setSnapshot({ ...snapshot, status: "running" });
    });

  const stop = () =>
    run(async () => {
      if (!session.current) return;
      await debugStop(context, session.current);
      session.current = undefined;
      setSnapshot((value) => (value ? { ...value, status: "stopped" } : value));
    });

  const close = () =>
    run(async () => {
      if (session.current) await debugStop(context, session.current);
      session.current = undefined;
      props.onClose();
    });

  const paused = snapshot?.status === "paused" && !busy;
  const active = snapshot && ["starting", "running", "paused"].includes(snapshot.status);
  const frame = snapshot?.frames.find((item) => item.id === snapshot.selectedFrame);
  const visibleVariables =
    snapshot?.variables.filter(
      (v) => !watch || v.name.toLowerCase().includes(watch.toLowerCase()),
    ) ?? [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent
        className="flex h-[85vh] w-[min(1200px,95vw)] max-w-none flex-col gap-3 sm:max-w-none"
        showCloseButton={false}
        onKeyDown={(event) => {
          if (!["F5", "F10", "F11"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          if (busy) return;
          if (event.key === "F5" && event.shiftKey && active) void stop();
          else if (event.key === "F5" && paused) void act({ type: "continue" });
          else if (event.key === "F5" && !active && availability?.available) void start();
          else if (event.key === "F10" && paused) void act({ type: "step_over" });
          else if (event.key === "F11" && paused && !event.shiftKey)
            void act({ type: "step_into" });
          else if (event.key === "F11" && paused && availability?.stepOut)
            void act({ type: "step_out" });
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Debugger · {props.schema}.{props.name}
          </DialogTitle>
          <DialogDescription>
            {availability?.message ?? "Debug-Unterstützung wird geprüft …"}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-wrap items-center gap-2" aria-label="Debug-Steuerung">
          <Button
            size="sm"
            title="Starten (F5)"
            disabled={!availability?.available || Boolean(active) || busy}
            onClick={() => void start()}
          >
            Starten
          </Button>
          {!active && snapshot?.source ? (
            <Button size="sm" variant="outline" onClick={() => setSnapshot(undefined)}>
              Aufruf bearbeiten
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={!paused}
            onClick={() => void act({ type: "continue" })}
          >
            Weiter
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!paused}
            onClick={() => void act({ type: "step_into" })}
          >
            Hinein
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!paused}
            onClick={() => void act({ type: "step_over" })}
          >
            Darüber
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!paused || !availability?.stepOut}
            onClick={() => void act({ type: "step_out" })}
          >
            Heraus
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!active || busy}
            onClick={() => void stop()}
          >
            Stoppen
          </Button>
          <span className="ml-auto text-xs" role="status">
            {snapshot ? labels[snapshot.status] : "Bereit"}
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void close()}>
            Schließen
          </Button>
        </fieldset>
        {error || snapshot?.message ? (
          <p role="alert" className="whitespace-pre-wrap text-xs text-destructive">
            {error ?? snapshot?.message}
          </p>
        ) : null}
        {!active && !snapshot?.source ? (
          <label className="flex min-h-0 flex-1 flex-col gap-2 text-xs">
            Aufrufskript — Parameter und Rückgabetyp anpassen
            <textarea
              className="min-h-32 flex-1 resize-none rounded-md border bg-background p-3 font-mono"
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              spellCheck={false}
            />
            <span className="text-muted-foreground">
              Start führt echten Datenbankcode aus. COMMIT, DDL und autonome Transaktionen können
              dauerhaft Änderungen speichern.
            </span>
          </label>
        ) : (
          <div className="flex min-h-0 flex-1 gap-3">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border">
              <p className="border-b px-3 py-2 text-xs">
                {frame?.name ?? "Quelltext"}
                {frame ? ` · Zeile ${frame.line}` : ""} · Breakpoints am linken Rand setzen
              </p>
              <DebugEditor
                source={snapshot?.source ?? ""}
                line={frame?.line}
                enabled={Boolean(paused && frame)}
                breakpoints={breakpoints.filter((b) => b.oid === frame?.oid).map((b) => b.line)}
                onToggle={(line) => {
                  if (!frame) return;
                  const next = breakpoints.some((b) => b.oid === frame.oid && b.line === line)
                    ? breakpoints.filter((b) => b.oid !== frame.oid || b.line !== line)
                    : [...breakpoints, { oid: frame.oid, line }];
                  void run(async () => {
                    if (!snapshot) return;
                    await debugAction(context, snapshot.id, {
                      type: "breakpoints",
                      breakpoints: next,
                    });
                    setBreakpoints(next);
                    setSnapshot({ ...snapshot, status: "running" });
                  });
                }}
              />
            </div>
            <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-auto text-xs">
              <div className="rounded-md border p-3">
                <h3 className="mb-2 font-semibold">Watches</h3>
                <form
                  className="flex gap-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = watchName.trim();
                    if (!name || !paused) return;
                    void act({
                      type: "watches",
                      names: [
                        ...new Set([...(snapshot?.watches ?? []).map((item) => item.name), name]),
                      ],
                    });
                    setWatchName("");
                  }}
                >
                  <input
                    aria-label="Watch hinzufügen"
                    placeholder="Variablenname"
                    className="min-w-0 flex-1 rounded border bg-background px-2 py-1"
                    value={watchName}
                    onChange={(event) => setWatchName(event.target.value)}
                  />
                  <Button
                    size="xs"
                    type="submit"
                    variant="outline"
                    disabled={!paused || !watchName.trim()}
                  >
                    +
                  </Button>
                </form>
                {(snapshot?.watches ?? []).map((item) => (
                  <div className="border-b py-2 last:border-0" key={item.name}>
                    <div className="flex justify-between gap-2">
                      <span className="font-mono">{item.name}</span>
                      <button
                        type="button"
                        aria-label={`Watch ${item.name} entfernen`}
                        disabled={!paused}
                        onClick={() =>
                          void act({
                            type: "watches",
                            names:
                              snapshot?.watches
                                .filter((value) => value.name !== item.name)
                                .map((value) => value.name) ?? [],
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap break-all text-muted-foreground">
                      {item.error ?? item.value ?? "NULL"}
                    </pre>
                  </div>
                ))}
              </div>
              <div className="rounded-md border p-3">
                <h3 className="mb-2 font-semibold">Call Stack</h3>
                {snapshot?.frames.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    disabled={!paused}
                    aria-pressed={item.id === snapshot.selectedFrame}
                    className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted aria-pressed:bg-muted"
                    onClick={() => void act({ type: "select_frame", frame: item.id })}
                  >
                    {item.name} : {item.line}
                  </button>
                ))}
              </div>
              <div className="min-h-0 rounded-md border p-3">
                <h3 className="mb-2 font-semibold">Variablen und Parameter</h3>
                <input
                  aria-label="Variablen filtern"
                  placeholder="Variable suchen …"
                  className="mb-2 w-full rounded border bg-background px-2 py-1"
                  value={watch}
                  onChange={(event) => setWatch(event.target.value)}
                />
                {visibleVariables.map((variable, index) => (
                  <div key={`${variable.name}-${index}`} className="border-b py-2 last:border-0">
                    <span className="font-mono font-medium">{variable.name}</span>
                    <pre className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">
                      {variable.value ?? "NULL"}
                    </pre>
                  </div>
                ))}
                {!visibleVariables.length ? (
                  <p className="text-muted-foreground">Keine Variablen verfügbar.</p>
                ) : null}
              </div>
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
