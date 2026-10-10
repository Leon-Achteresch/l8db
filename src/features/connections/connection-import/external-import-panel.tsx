import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, FilePlus, FileSearch, FolderSearch, Info } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import type { DuplicateStrategy } from "@/lib/connection-export";
import {
  buildExternalCandidates,
  type DataGripFile,
  type ExternalImportCandidate,
  type ExternalImportSource,
  persistImportedSecrets,
  resolveExternalImport,
  type ExternalImportSummary as Summary,
} from "@/lib/connection-import";
import { useConnectionsStore } from "@/lib/connections";
import { storeSecret } from "@/lib/secrets";
import { proxySecretAccount, sshSecretAccount } from "@/lib/ssh";
import { DuplicateStrategyField } from "./duplicate-strategy-field";
import { ExternalImportRow } from "./external-import-row";
import { ExternalImportSummary } from "./external-import-summary";
import {
  addDataGripSshConfigs,
  detectDbeaverImport,
  type LoadedExternalImport,
  pickExternalImport,
} from "./load-external-import";

interface Props {
  source: ExternalImportSource;
  onClose: () => void;
}

const PICK_LABEL: Record<ExternalImportSource, string> = {
  dbeaver: "data-sources.json wählen",
  datagrip: "dataSources.xml wählen",
  navicat: ".ncx-Datei wählen",
};

export function ExternalImportPanel({ source, onClose }: Props) {
  const [candidates, setCandidates] = useState<ExternalImportCandidate[] | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [dataGripFiles, setDataGripFiles] = useState<DataGripFile[]>([]);
  const [needsSshConfigs, setNeedsSshConfigs] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [strategy, setStrategy] = useState<DuplicateStrategy>("skip");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ summary: Summary; failures: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const stats = useMemo(() => {
    let skipped = 0;
    let duplicates = 0;
    let importable = 0;
    for (const candidate of candidates ?? []) {
      if (candidate.skipReason) skipped++;
      else if (candidate.duplicateOf) duplicates++;
      if (!candidate.skipReason && selected.has(candidate.index))
        if (!candidate.duplicateOf || strategy === "copy") importable++;
    }
    return { skipped, duplicates, importable };
  }, [candidates, selected, strategy]);

  const virtualizer = useVirtualizer({
    count: candidates?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 8,
    useFlushSync: false,
  });

  function apply(loaded: LoadedExternalImport | null, missing?: string) {
    if (!loaded) {
      if (missing) setError(missing);
      return;
    }
    setFiles(loaded.files);
    setDataGripFiles(loaded.dataGripFiles);
    setNeedsSshConfigs(loaded.needsSshConfigs);
    setNotice(loaded.result.notice);
    setError(loaded.result.error);
    if (loaded.result.error) {
      setCandidates(null);
      return;
    }
    const next = buildExternalCandidates(
      loaded.result.connections,
      useConnectionsStore.getState().connections,
    );
    setCandidates(next);
    setSelected(
      new Set(
        next.filter((candidate) => !candidate.skipReason).map((candidate) => candidate.index),
      ),
    );
  }

  async function run(load: () => Promise<LoadedExternalImport | null>, missing?: string) {
    setBusy(true);
    setError(null);
    try {
      apply(await load(), missing);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setCandidates(null);
    } finally {
      setBusy(false);
    }
  }

  function toggle(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function confirm() {
    if (!candidates) return;
    setBusy(true);
    try {
      const resolved = resolveExternalImport(candidates, selected, strategy);
      const failures = await persistImportedSecrets(resolved.secrets, storeSecret, {
        ssh: sshSecretAccount,
        proxy: proxySecretAccount,
      });
      if (resolved.connections.length)
        useConnectionsStore.getState().addImported(resolved.connections);
      if (!resolved.connections.length) toast.info("Keine Verbindungen übernommen.");
      setSummary({ summary: resolved.summary, failures });
    } finally {
      setBusy(false);
    }
  }

  if (summary)
    return (
      <>
        <ExternalImportSummary summary={summary.summary} keychainFailures={summary.failures} />
        <DialogFooter>
          <Button onClick={onClose}>Schließen</Button>
        </DialogFooter>
      </>
    );

  const items = virtualizer.getVirtualItems();
  return (
    <>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {source === "dbeaver" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(
                  detectDbeaverImport,
                  "Kein DBeaver-Workspace am Standardpfad gefunden. Bitte data-sources.json manuell wählen.",
                )
              }
            >
              <FolderSearch className="size-4" />
              Standardpfad erkennen
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => pickExternalImport(source))}
          >
            <FileSearch className="size-4" />
            {PICK_LABEL[source]}
          </Button>
          {source === "datagrip" && needsSshConfigs && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => addDataGripSshConfigs(dataGripFiles))}
            >
              <FilePlus className="size-4" />
              sshConfigs.xml hinzufügen
            </Button>
          )}
          {files.length > 0 && (
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
              {files.join(", ")}
            </span>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        )}
        {notice && (
          <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {notice}
          </p>
        )}
        {candidates && candidates.length === 0 && (
          <p className="text-xs text-muted-foreground">Die Datei enthält keine Verbindungen.</p>
        )}
        {candidates && candidates.length > 0 && (
          <div
            ref={scrollRef}
            className="max-h-72 overflow-y-auto rounded-md border"
            data-testid="external-import-list"
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {items.map((item) => {
                const candidate = candidates[item.index];
                return (
                  <div
                    key={candidate.index}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className="absolute inset-x-0 top-0"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <ExternalImportRow
                      candidate={candidate}
                      checked={selected.has(candidate.index)}
                      onToggle={toggle}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {stats.duplicates > 0 && (
          <DuplicateStrategyField
            count={stats.duplicates}
            value={strategy}
            onChange={setStrategy}
          />
        )}
        {stats.skipped > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {stats.skipped === 1
              ? "1 Eintrag wird übersprungen (nicht unterstützt oder unvollständig)."
              : `${stats.skipped} Einträge werden übersprungen (nicht unterstützt oder unvollständig).`}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Abbrechen
        </Button>
        <Button
          onClick={() => void confirm()}
          disabled={busy || !candidates || stats.importable === 0}
        >
          {stats.importable === 0 ? "Importieren" : `${stats.importable} importieren`}
        </Button>
      </DialogFooter>
    </>
  );
}
