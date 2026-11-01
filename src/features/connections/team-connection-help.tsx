import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import type { SavedConnection } from "@/lib/connections";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function TeamConnectionHelp({ connection }: { connection: SavedConnection }) {
  const [open, setOpen] = useState(false);
  const { ref } = useNewFeatureVisibility<HTMLDivElement>("connections.team.help");
  if (!connection.team) return null;
  return (
    <details
      className="mt-3 text-xs text-muted-foreground"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <summary className="cursor-pointer">Team-Verbindung · Hilfe & Zuständigkeit</summary>
      {open && (
        <div ref={ref} className="mt-2 space-y-1 break-words">
          <p>
            {connection.description ||
              "Die Verbindungsadresse und Sicherheitsvorgaben verwaltet deine IT."}
          </p>
          {connection.owner && <p>Verantwortlich: {connection.owner}</p>}
          <p>Zugriff beantragen: {connection.contact || "bei deiner Datenbankadministration"}</p>
          <p>
            Nutze dein persönliches Datenbankkonto. Die angezeigten Schemas ersetzen keine
            Datenbankrechte.
          </p>
          {connection.runbook && /^https:\/\//i.test(connection.runbook) && (
            <button
              type="button"
              className="text-primary underline underline-offset-2"
              onClick={() => void openUrl(connection.runbook as string)}
            >
              Betriebsanleitung öffnen
            </button>
          )}
        </div>
      )}
    </details>
  );
}
