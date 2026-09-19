import { ArrowDownToLine, CircleDot, Code2, Info } from "lucide-react";
import type { DebugAvailability } from "@/lib/db";

export function DebugSetup({ availability }: { availability?: DebugAvailability }) {
  return (
    <aside className="debug-setup" aria-label="Debug-Sitzung vorbereiten">
      <div className="debug-pane-heading">Vorbereitung</div>
      <div className="px-6 py-5">
        <div className="debug-setup-symbol">
          <Code2 className="size-5" />
        </div>
        <h3 className="mt-5 text-base font-semibold tracking-tight">Sitzung vorbereiten</h3>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Starte mit deinem Aufrufskript und verfolge die Ausführung direkt im Quelltext.
        </p>
        <ol className="debug-setup-steps">
          <li>
            <span>01</span>
            <div>
              <strong>Aufruf vorbereiten</strong>
              <p>Parameter, Überladung und Rückgabetyp im Editor anpassen.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Sitzung starten</strong>
              <p>
                Mit <kbd>F5</kbd> starten. Der Debugger hält am Einstieg an.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Schrittweise prüfen</strong>
              <p>Breakpoints am Zeilenrand setzen und Variablen beobachten.</p>
            </div>
          </li>
        </ol>
        <div className="debug-setup-hints">
          <span>
            <CircleDot />
            Breakpoints
          </span>
          <span>
            <ArrowDownToLine />
            Einzelschritte
          </span>
        </div>
      </div>
      <div className="debug-runtime-info">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>{availability?.message ?? "Debug-Unterstützung wird geprüft …"}</p>
      </div>
    </aside>
  );
}
