import { Input } from "@/components/ui/input";
import { SettingsRow } from "@/features/settings/settings-row";
import { useSettingsStore } from "@/lib/settings";

const FIELD =
  "h-8 w-16 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

function parsed(value: string, min: number, max: number): number | null {
  const number = Number.parseInt(value, 10);
  return Number.isNaN(number) || number < min || number > max ? null : number;
}

export function MultiTargetSettingsRow() {
  const concurrency = useSettingsStore((state) => state.multiTargetConcurrency);
  const rowLimit = useSettingsStore((state) => state.multiTargetRowLimit);
  const timeout = useSettingsStore((state) => state.multiTargetTimeout);
  const { setMultiTargetConcurrency, setMultiTargetRowLimit, setMultiTargetTimeout } =
    useSettingsStore.getState();
  return (
    <SettingsRow settingId="multi-target">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Input
            type="number"
            min={1}
            max={16}
            aria-label="Gleichzeitige Ziele"
            value={concurrency}
            onChange={(event) => {
              const value = parsed(event.target.value, 1, 16);
              if (value !== null) setMultiTargetConcurrency(value);
            }}
            className={FIELD}
          />
          gleichzeitig
        </span>
        <span className="flex items-center gap-1.5">
          <Input
            type="number"
            min={1}
            max={1000}
            aria-label="Zeilen je Ziel"
            value={rowLimit}
            onChange={(event) => {
              const value = parsed(event.target.value, 1, 1000);
              if (value !== null) setMultiTargetRowLimit(value);
            }}
            className={FIELD}
          />
          Zeilen je Ziel
        </span>
        <span className="flex items-center gap-1.5">
          <Input
            type="number"
            min={5}
            max={300}
            aria-label="Timeout je Ziel"
            value={timeout}
            onChange={(event) => {
              const value = parsed(event.target.value, 5, 300);
              if (value !== null) setMultiTargetTimeout(value);
            }}
            className={FIELD}
          />
          Sekunden
        </span>
      </div>
    </SettingsRow>
  );
}
