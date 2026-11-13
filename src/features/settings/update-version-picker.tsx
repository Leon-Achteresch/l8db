import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Update } from "@tauri-apps/plugin-updater";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsRow } from "@/features/settings/settings-row";
import { checkUpdate, listUpdateReleases } from "@/lib/db/updates";
import { type UpdateChannel, useSettingsStore } from "@/lib/settings";
import { getInstallPercent, presentUpdate, UPDATE_CHECK_TIMEOUT_MS } from "@/lib/updater";

interface Props {
  channel: UpdateChannel;
  currentVersion: string | null;
}

export function UpdateVersionPicker({ channel, currentVersion }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const preparingRef = useRef(false);
  const query = useQuery({
    queryKey: ["update-releases", channel, page],
    queryFn: ({ signal }) => listUpdateReleases(channel, page, signal),
    enabled,
    retry: false,
    staleTime: 60_000,
    gcTime: 0,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function onPrepare() {
    if (!selected || selected === currentVersion || preparingRef.current) return;
    if (getInstallPercent() !== null) {
      setError("Eine Installation läuft bereits.");
      return;
    }
    preparingRef.current = true;
    setPreparing(true);
    setError(null);
    try {
      const metadata = await checkUpdate(channel, UPDATE_CHECK_TIMEOUT_MS, selected);
      const update = metadata ? new Update(metadata) : null;
      if (!active.current || channel !== useSettingsStore.getState().updateChannel) {
        await update?.close();
        return;
      }
      if (getInstallPercent() !== null) {
        await update?.close();
        throw new Error("Eine Installation läuft bereits.");
      }
      if (!update) throw new Error("Version ist nicht mehr verfügbar oder bereits installiert.");
      useSettingsStore.getState().setSkippedUpdateVersion(null);
      presentUpdate(update, true);
    } catch (error) {
      if (active.current) setError(`Version konnte nicht geladen werden: ${String(error)}`);
    } finally {
      preparingRef.current = false;
      if (active.current) setPreparing(false);
    }
  }

  function onPage(next: number) {
    setSelected("");
    setError(null);
    setPage(next);
  }

  return (
    <SettingsRow title="Version wechseln" featureId="settings.about.version-history">
      <div className="flex max-w-full flex-col items-end gap-2">
        {!enabled ? (
          <Button variant="outline" onClick={() => setEnabled(true)}>
            Versionen laden
          </Button>
        ) : (
          <>
            <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
              <Select
                value={selected}
                onValueChange={setSelected}
                disabled={query.isFetching || query.isError || preparing}
              >
                <SelectTrigger className="w-64 max-w-full" aria-label="Version auswählen">
                  <SelectValue
                    placeholder={
                      query.isFetching ? "Versionen werden geladen …" : "Version auswählen"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {query.data?.versions.map((version) => (
                    <SelectItem key={version} value={version} disabled={version === currentVersion}>
                      {version} · {version.includes("-canary.") ? "Canary" : "Stable"}
                      {version === currentVersion ? " · Installiert" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={
                  !selected ||
                  selected === currentVersion ||
                  preparing ||
                  query.isFetching ||
                  query.isError
                }
                onClick={() => void onPrepare()}
              >
                {preparing ? "Lade …" : "Version verwenden"}
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={page === 1 || query.isFetching || preparing}
                onClick={() => onPage(page - 1)}
              >
                <ChevronLeft className="size-3.5" />
                Neuere
              </Button>
              <span className="px-2 text-xs tabular-nums text-muted-foreground">Seite {page}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!query.data?.nextPage || query.isFetching || query.isError || preparing}
                onClick={() => query.data?.nextPage && onPage(query.data.nextPage)}
              >
                Ältere
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
            {!query.isFetching && !query.isError && query.data?.versions.length === 0 ? (
              <span role="status" className="text-xs text-muted-foreground">
                Keine passenden Versionen auf dieser Seite.
              </span>
            ) : null}
            {query.isError ? (
              <div className="flex items-center gap-2">
                <span role="alert" className="text-xs text-destructive">
                  Versionen konnten nicht geladen werden.
                </span>
                <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                  Erneut versuchen
                </Button>
              </div>
            ) : null}
          </>
        )}
        {error ? (
          <span role="alert" className="max-w-sm text-xs text-destructive">
            {error}
          </span>
        ) : null}
      </div>
    </SettingsRow>
  );
}
