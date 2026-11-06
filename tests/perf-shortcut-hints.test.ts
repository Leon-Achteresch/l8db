import { expect, test } from "bun:test";
import { HOTKEY_COMMANDS, useHotkeysStore } from "@/lib/hotkeys";
import {
  eventHotkey,
  HINT_STARTUP_GRACE_MS,
  hotkeyIndex,
  useShortcutHintsStore,
} from "@/lib/shortcut-hints";
import { reportScenario } from "../scripts/performance-report";

function percentiles(durations: number[]) {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    runs: sorted.length,
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(4)),
    p95Ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(4)),
  };
}

const letters = "abcdefghijklmnopqrstuvwxyz";

test("shortcut hints: keydown and click paths stay cheap and bounded", async () => {
  const store = useShortcutHintsStore.getState();
  store.reset();
  const overrides = useHotkeysStore.getState().overrides;
  const events = Array.from({ length: 50_000 }, (_, i) => {
    const letter = letters[i % letters.length];
    return {
      key: letter,
      code: `Key${letter.toUpperCase()}`,
      metaKey: i % 3 !== 0,
      ctrlKey: false,
      altKey: i % 7 === 0,
      shiftKey: i % 5 === 0,
    };
  });

  const keydown: number[] = [];
  let matches = 0;
  for (const event of events) {
    const start = performance.now();
    const hotkey = eventHotkey(event, true);
    const ids = hotkey ? hotkeyIndex(overrides).get(hotkey) : undefined;
    if (ids) {
      matches++;
      for (const id of ids) store.recordKeyboard(id);
    }
    keydown.push(performance.now() - start);
  }

  store.reset();
  const ids = [...HOTKEY_COMMANDS.map((command) => command.id), "unknown.a", "unknown.b"];
  const now = Date.now() + HINT_STARTUP_GRACE_MS + 1;
  const click: number[] = [];
  for (let i = 0; i < 20_000; i++) {
    const start = performance.now();
    useShortcutHintsStore.getState().recordClick(ids[i % ids.length], now + i);
    click.push(performance.now() - start);
  }

  const state = useShortcutHintsStore.getState();
  const storedEntries = Object.keys(state.stats).length;
  const shown = Object.values(state.stats).reduce((sum, stat) => sum + stat.shown, 0);
  const keydownTiming = percentiles(keydown);
  const clickTiming = percentiles(click);

  expect(storedEntries).toBeLessThanOrEqual(HOTKEY_COMMANDS.length);
  expect(shown).toBe(1);
  expect(keydownTiming.p95Ms).toBeLessThan(0.05);
  expect(clickTiming.p95Ms).toBeLessThan(0.2);

  await reportScenario("shortcut-hints", {
    commands: HOTKEY_COMMANDS.length,
    keydownEvents: events.length,
    keydownMatches: matches,
    clicks: click.length,
    storedEntries,
    hintsShown: shown,
    keydown: keydownTiming,
    click: clickTiming,
  });
  store.reset();
});
