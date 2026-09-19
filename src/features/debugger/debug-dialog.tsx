import { Bug, CircleDot, Code2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
import { DebugInspector } from "./debug-inspector";
import { DebugSetup } from "./debug-setup";
import { DebugToolbar } from "./debug-toolbar";
import "./debugger.css";

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
        if (cancelled) return;
        setError(String(e));
        setSnapshot((value) => (value ? { ...value, status: "error" } : value));
        return;
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
  const preparing = !active && !snapshot?.source;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent
        className="debug-workbench"
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
        <header className="debug-header">
          <span className="debug-brand-icon">
            <Bug />
          </span>
          <div className="min-w-0 flex-1">
            <span className="debug-eyebrow">Debugger</span>
            <DialogTitle className="truncate font-mono text-sm font-medium">
              {props.schema}.{props.name}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Datenbankcode schrittweise ausführen und Variablen untersuchen.
            </DialogDescription>
          </div>
          <span className="debug-engine">
            {context.kind === "oracle" ? "Oracle · PL/SQL" : "PostgreSQL · PL/pgSQL"}
          </span>
          <span
            className="debug-status"
            data-state={snapshot?.status ?? (availability?.available ? "ready" : "pending")}
            role="status"
          >
            <span />
            {snapshot
              ? labels[snapshot.status]
              : availability?.available
                ? "Bereit"
                : availability
                  ? "Nicht verfügbar"
                  : "Wird geprüft"}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Schließen"
            disabled={busy}
            onClick={() => void close()}
          >
            <X />
          </Button>
        </header>
        <DebugToolbar
          active={Boolean(active)}
          paused={paused}
          busy={busy}
          available={Boolean(availability?.available)}
          stepOut={Boolean(availability?.stepOut)}
          hasSource={Boolean(snapshot?.source)}
          onStart={() => void start()}
          onStop={() => void stop()}
          onEdit={() => setSnapshot(undefined)}
          onAction={(action) => void act(action)}
        />
        {error || snapshot?.message ? (
          <p role="alert" className="debug-alert">
            {error ?? snapshot?.message}
          </p>
        ) : null}
        <div className="debug-body">
          <div className="debug-code-pane">
            <div className="debug-filebar">
              <span className="debug-file-tab">
                <Code2 className="size-3.5" />
                <span className="truncate">
                  {preparing ? "Aufrufskript" : (frame?.name ?? "Quelltext")}
                </span>
                <span className="debug-file-extension">sql</span>
              </span>
              <span className="debug-file-hint">
                {preparing
                  ? "Parameter und Rückgabetyp anpassen"
                  : frame
                    ? `Zeile ${frame.line}`
                    : "Warte auf Quelltext"}
              </span>
            </div>
            <DebugEditor
              source={preparing ? sql : (snapshot?.source ?? "")}
              onChange={preparing ? setSql : undefined}
              line={preparing ? undefined : frame?.line}
              enabled={Boolean(paused && frame)}
              breakpoints={
                preparing ? [] : breakpoints.filter((b) => b.oid === frame?.oid).map((b) => b.line)
              }
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
            <div className="debug-editor-footer">
              <span className="flex items-center gap-1.5">
                <CircleDot className="size-3" />
                {breakpoints.length} Breakpoints
              </span>
              <span>{preparing ? "Bearbeitbar" : "Schreibgeschützt"}</span>
              <span className="ml-auto">{context.kind === "oracle" ? "PL/SQL" : "PL/pgSQL"}</span>
            </div>
          </div>
          {preparing ? (
            <DebugSetup availability={availability} />
          ) : (
            <DebugInspector
              snapshot={snapshot}
              paused={paused}
              onAction={(action) => void act(action)}
            />
          )}
        </div>
        <footer className="debug-footer">
          <span className="debug-footer-dot" />
          {preparing
            ? "Start führt echten Datenbankcode aus. COMMIT, DDL und autonome Transaktionen können Änderungen dauerhaft speichern."
            : paused
              ? "Ausführung angehalten. Breakpoints am linken Editorrand setzen."
              : "Die Sitzung bleibt mit der Datenbank verbunden, bis sie beendet wird."}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
