export function LogsSelfHostedNotice() {
  return (
    <div className="space-y-2 rounded-xl border p-4 text-xs">
      <p className="text-sm font-medium">Logs liegen im Analytics-Container</p>
      <p>
        Bei selbst gehosteten Instanzen sammelt der Container <code>analytics</code> (Logflare) die
        Logs von API-Gateway, Postgres, Auth, Storage, Realtime und Edge Functions. Das Kong-Gateway
        leitet <code>/analytics/v1</code> standardmäßig nicht weiter, daher kann l8db diese Logs
        nicht abrufen.
      </p>
      <p className="text-muted-foreground">
        Zum Lesen: <code>docker compose logs -f analytics</code> bzw. die einzelnen Dienste, oder
        die Analytics-Route in <code>volumes/api/kong.yml</code> freischalten. Sitzungen, Sperren,
        Abfragestatistiken und Datenbank-Zustand stehen in den anderen Reitern zur Verfügung.
      </p>
    </div>
  );
}
