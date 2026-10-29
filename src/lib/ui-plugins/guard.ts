import { withoutHooks } from "../../../packages/ui-plugin-api/src/modules";

export type SlotName =
  | "grid.columns"
  | "grid.cell"
  | "grid.rowTone"
  | "table.toolbar"
  | "table.detailTabs"
  | "tabs.group"
  | "tabs.item"
  | "split.layout";

const WINDOW = 200;
const MIN_SAMPLES = 50;
const CHECK_EVERY = 25;
const MAX_ERRORS = 20;

export const SLOT_BUDGET_MS: Record<SlotName, number> = {
  "grid.cell": 4,
  "grid.rowTone": 2,
  "tabs.item": 4,
  "tabs.group": 2,
  "grid.columns": 50,
  "table.toolbar": 50,
  "table.detailTabs": 50,
  "split.layout": 10,
};

export type GuardEvents = {
  error(plugin: string, slot: SlotName, message: string): void;
  trip(plugin: string, slot: SlotName, reason: string): void;
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export class SlotGuard {
  private readonly samples = new Float64Array(WINDOW);
  private count = 0;
  private slow = 0;
  private errors = 0;
  tripped = false;

  constructor(
    readonly plugin: string,
    readonly slot: SlotName,
    private readonly events: GuardEvents,
    private readonly budget = SLOT_BUDGET_MS[slot],
  ) {}

  run<T>(call: () => T, fallback: T): T {
    if (this.tripped) return fallback;
    const start = performance.now();
    try {
      const result = withoutHooks(call);
      this.record(performance.now() - start);
      return result;
    } catch (error) {
      this.fail(error);
      return fallback;
    }
  }

  fail(error: unknown) {
    if (this.tripped) return;
    this.errors++;
    const message = errorMessage(error);
    if (this.errors === 1) this.events.error(this.plugin, this.slot, message);
    if (this.errors >= MAX_ERRORS) this.trip(`${this.errors} Fehler, zuletzt: ${message}`);
  }

  p95() {
    const size = Math.min(this.count, WINDOW);
    const sorted = Array.from(this.samples.subarray(0, size)).sort((a, b) => a - b);
    return sorted[Math.min(size - 1, Math.floor(size * 0.95))] ?? 0;
  }

  private record(duration: number) {
    const index = this.count % WINDOW;
    if (this.count >= WINDOW && this.samples[index] > this.budget) this.slow--;
    if (duration > this.budget) this.slow++;
    this.samples[index] = duration;
    this.count++;
    if (this.count < MIN_SAMPLES || this.count % CHECK_EVERY !== 0) return;
    const size = Math.min(this.count, WINDOW);
    if (this.slow >= size - Math.min(size - 1, Math.floor(size * 0.95)))
      this.trip(`zu langsam: p95 ${this.p95().toFixed(1)} ms bei erlaubten ${this.budget} ms`);
  }

  private trip(reason: string) {
    if (this.tripped) return;
    this.tripped = true;
    this.events.trip(this.plugin, this.slot, reason);
  }
}
