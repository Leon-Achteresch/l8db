const AREAS = [
  [
    "Verbindungen",
    "Zentral hinterlegt, Rechte je Person und Verbindung. Zugangsdaten bleiben auf dem Server.",
  ],
  ["Gemeinsame SQL", "Abfragen, die das ganze Team nutzt und versioniert weiterpflegt."],
  ["Freigaben", "Schreibende SQL läuft erst, wenn eine zweite Person sie freigibt."],
  ["Benutzer und Rechte", "Admins und Mitglieder, Lese- oder Schreibrechte je Verbindung."],
  ["Einladungen", "Neue Mitglieder treten mit einem Einladungscode bei."],
  ["Audit", "Jede Anmeldung, Abfrage und Freigabe bleibt nachvollziehbar."],
] as const;

export function WorkspaceIntro() {
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-muted/40 p-4 text-sm">
      <p>
        Ein Workspace ist ein eigener l8db-Server, lokal auf diesem Rechner oder per HTTPS im
        Firmennetz. Alle Mitglieder melden sich dort an und arbeiten mit denselben Verbindungen.
      </p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {AREAS.map(([title, text]) => (
          <div key={title}>
            <dt className="font-medium">{title}</dt>
            <dd className="text-xs text-muted-foreground">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Zum Ausprobieren „Lokalen Workspace starten“ wählen. Ein eigenständiger Server startet mit{" "}
        <code className="rounded bg-muted px-1">l8db --workspace-server</code>.
      </p>
    </section>
  );
}
