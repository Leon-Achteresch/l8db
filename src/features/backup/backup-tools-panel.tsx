import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBackupToolPaths } from "@/lib/backup-runner";
import type { BackupProbe } from "@/lib/db";

interface BackupToolsPanelProps {
  probe: BackupProbe | undefined;
  loading: boolean;
  onRefresh: () => void;
}

export function BackupToolsPanel({ probe, loading, onRefresh }: BackupToolsPanelProps) {
  const paths = useBackupToolPaths((state) => state.paths);
  const setPath = useBackupToolPaths((state) => state.setPath);

  const browse = async (tool: string) => {
    const picked = await open({ directory: false, multiple: false });
    if (typeof picked === "string") setPath(tool, picked);
  };

  if (!probe?.tools.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {loading
          ? "Werkzeuge werden gesucht…"
          : "Für diesen Datenbanktyp werden keine externen Werkzeuge benötigt."}
      </p>
    );
  }

  return (
    <div className="grid max-w-4xl gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={loading} onClick={onRefresh}>
          {loading ? "Suche läuft…" : "Erneut suchen"}
        </Button>
        {probe.installHint && (
          <span className="text-xs text-muted-foreground">
            Installation: <code className="font-mono">{probe.installHint}</code>
          </span>
        )}
      </div>
      {probe.tools.map((tool) => (
        <section key={tool.name} className="grid gap-2 rounded-md border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-sm font-medium">{tool.name}</span>
            <span
              className={
                tool.path
                  ? "text-xs text-emerald-600 dark:text-emerald-400"
                  : "text-xs text-destructive"
              }
            >
              {tool.path ? `Version ${tool.version ?? "unbekannt"}` : "Nicht gefunden"}
            </span>
          </div>
          {tool.path && (
            <p className="break-all font-mono text-xs text-muted-foreground">{tool.path}</p>
          )}
          {tool.error && <p className="text-xs text-destructive">{tool.error}</p>}
          {tool.candidates.length > 1 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                {tool.candidates.length} Installationen gefunden
              </summary>
              <ul className="mt-1 space-y-0.5 font-mono">
                {tool.candidates.map((candidate) => (
                  <li key={candidate.path} className="break-all">
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => setPath(tool.name, candidate.path)}
                    >
                      {candidate.path} · {candidate.version ?? "?"}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex gap-2">
            <Input
              key={paths[tool.name] ?? ""}
              aria-label={`Eigener Pfad für ${tool.name}`}
              defaultValue={paths[tool.name] ?? ""}
              placeholder="Eigener Pfad (optional, Datei oder Ordner)"
              className="h-8 font-mono text-xs"
              onBlur={(event) => setPath(tool.name, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setPath(tool.name, event.currentTarget.value);
              }}
            />
            <Button variant="outline" size="sm" onClick={() => void browse(tool.name)}>
              Wählen…
            </Button>
            {paths[tool.name] && (
              <Button variant="ghost" size="sm" onClick={() => setPath(tool.name, "")}>
                Zurücksetzen
              </Button>
            )}
          </div>
        </section>
      ))}
      {probe.searchDirs.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Durchsuchte Verzeichnisse</summary>
          <ul className="mt-1 space-y-0.5 font-mono">
            {probe.searchDirs.map((dir) => (
              <li key={dir} className="break-all">
                {dir}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
