import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { MIN_AUTO_SYNC_MINUTES, syncTarget, useSyncStore } from "@/lib/sync/store";

export function SyncAutoRow() {
  const state = useSyncStore();
  const ready = syncTarget(state) !== null;
  return (
    <SettingsRow settingId="sync-auto">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Switch
          checked={state.autoSync}
          disabled={!ready && !state.autoSync}
          onCheckedChange={(checked) => state.configure({ autoSync: checked })}
          aria-label="Automatisch synchronisieren"
        />
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">alle</span>
          <Input
            type="number"
            min={MIN_AUTO_SYNC_MINUTES}
            max={1440}
            step={5}
            aria-label="Sync-Intervall in Minuten"
            disabled={!state.autoSync}
            defaultValue={state.intervalMinutes}
            key={state.intervalMinutes}
            onBlur={(event) => state.configure({ intervalMinutes: Number(event.target.value) })}
            className="h-8 w-16 text-center text-xs"
          />
          <span className="text-muted-foreground">Minuten</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={state.syncOnStart}
            disabled={!state.autoSync}
            onCheckedChange={(checked) => state.configure({ syncOnStart: checked })}
            aria-label="Beim Start synchronisieren"
          />
          <span>beim Start</span>
        </div>
      </div>
    </SettingsRow>
  );
}
