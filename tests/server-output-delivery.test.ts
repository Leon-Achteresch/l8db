import { beforeEach, describe, expect, mock, test } from "bun:test";

const toasts: string[] = [];
const invoked: string[] = [];

mock.module("sonner", () => ({
  toast: { warning: (title: string) => toasts.push(title) },
}));

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    invoked.push(command);
    if (command === "set_server_output") return null;
    if (command === "transaction_server_output")
      return [
        { level: "OUTPUT", message: "in tx", detail: null },
        { level: "INFO", message: "achtung", detail: "Meldung 50000, Ebene 10, Status 1, Zeile 3" },
      ];
    throw new Error(`unexpected command ${command}`);
  },
}));

const {
  deliverServerOutput,
  enableOracleOutput,
  MAX_SERVER_OUTPUT_ENTRIES,
  onNextServerOutput,
  useServerOutputStore,
} = await import("../src/lib/server-output");
const { transactionServerOutput } = await import("../src/lib/db");

const connectionId = "conn-output";
const entries = () => useServerOutputStore.getState().entries[connectionId] ?? [];

beforeEach(() => {
  toasts.length = 0;
  invoked.length = 0;
  useServerOutputStore.getState().clear(connectionId);
  useServerOutputStore.getState().setEnabled(connectionId, false);
});

describe("server output delivery", () => {
  test("toggle off keeps only warnings and toasts them", () => {
    deliverServerOutput(connectionId, "db", [
      { level: "OUTPUT", message: "print" },
      { level: "WARNING", message: "vorsicht\nZeile 2" },
      { level: "NOTE", message: "note" },
    ]);
    expect(entries().map((entry) => entry.message)).toEqual(["vorsicht\nZeile 2"]);
    expect(toasts).toEqual(["vorsicht"]);
  });

  test("transaction messages keep level and detail when the toggle is on", async () => {
    useServerOutputStore.getState().setEnabled(connectionId, true);
    deliverServerOutput(connectionId, null, await transactionServerOutput("tx_1"));
    expect(invoked).toEqual(["transaction_server_output"]);
    expect(entries().map((entry) => [entry.level, entry.message, entry.detail])).toEqual([
      ["OUTPUT", "in tx", null],
      ["INFO", "achtung", "Meldung 50000, Ebene 10, Status 1, Zeile 3"],
    ]);
    expect(toasts).toEqual([]);
  });

  test("Oracle output is on by default until the user decides otherwise", async () => {
    const enabled = (id: string) => useServerOutputStore.getState().enabled[id];
    await enableOracleOutput("postgres", "postgres://h/db", "pg-default");
    expect(enabled("pg-default")).toBeUndefined();
    await Promise.all([
      enableOracleOutput("oracle", "oracle://u@h/db", "ora-default"),
      enableOracleOutput("oracle", "oracle://u@h/db", "ora-default"),
    ]);
    expect(enabled("ora-default")).toBe(true);
    expect(invoked).toEqual(["set_server_output"]);
    expect(deliverServerOutput("ora-default", null, [{ level: "OUTPUT", message: "x" }])).toBe(1);
    expect(
      deliverServerOutput("ora-default", null, [{ level: "WARNING", message: "mit Warnungen" }]),
    ).toBe(1);
    expect(toasts).toEqual(["mit Warnungen"]);
    useServerOutputStore.getState().setEnabled("ora-off", false);
    await enableOracleOutput("oracle", "oracle://u@h/db", "ora-off");
    expect(enabled("ora-off")).toBe(false);
    expect(deliverServerOutput("ora-off", null, [{ level: "OUTPUT", message: "x" }])).toBe(0);
    expect(invoked).toEqual(["set_server_output"]);
  });

  test("120000 lines keep the newest 100000 in the store", () => {
    useServerOutputStore.getState().setEnabled(connectionId, true);
    const messages = Array.from({ length: 120_000 }, (_, index) => ({
      level: "OUTPUT",
      message: `Zeile ${index + 1}`,
    }));
    const durations: number[] = [];
    for (let run = 0; run < 11; run += 1) {
      useServerOutputStore.getState().clear(connectionId);
      const started = performance.now();
      deliverServerOutput(connectionId, null, messages);
      durations.push(performance.now() - started);
      expect(entries()).toHaveLength(MAX_SERVER_OUTPUT_ENTRIES);
      expect(entries()[0]?.message).toBe("Zeile 20001");
      expect(entries().at(-1)?.message).toBe("Zeile 120000");
    }
    durations.sort((a, b) => a - b);
    console.log(
      `performance server-output-delivery: messages=120000 retained=${MAX_SERVER_OUTPUT_ENTRIES} median_ms=${durations[5]?.toFixed(3)} p95_ms=${durations[10]?.toFixed(3)} runs=11`,
    );
    expect(durations[10]).toBeLessThan(100);
  });

  test("a running statement's watcher fires once on the first new line of its connection", () => {
    const store = useServerOutputStore.getState();
    store.append(connectionId, null, [{ level: "OUTPUT", message: "alt" }]);
    let fired = 0;
    const stop = onNextServerOutput(connectionId, () => {
      fired += 1;
    });
    store.append("conn-other", null, [{ level: "OUTPUT", message: "fremd" }]);
    store.setEnabled(connectionId, true);
    store.append(connectionId, null, []);
    expect(fired).toBe(0);
    store.append(connectionId, null, [{ level: "OUTPUT", message: "Schritt 1" }]);
    store.append(connectionId, null, [{ level: "OUTPUT", message: "Schritt 2" }]);
    expect(fired).toBe(1);
    stop();
    let stopped = 0;
    onNextServerOutput(connectionId, () => {
      stopped += 1;
    })();
    store.append(connectionId, null, [{ level: "OUTPUT", message: "Schritt 3" }]);
    expect(stopped).toBe(0);
    store.clear("conn-other");
  });

  test("2000 statements streaming 10 lines each cost the same with a watcher", () => {
    const store = useServerOutputStore.getState();
    const lines = Array.from({ length: 10 }, (_, index) => ({
      level: "OUTPUT",
      message: `Zeile ${index + 1}`,
    }));
    const stream = (watched: boolean) => {
      const durations: number[] = [];
      let fired = 0;
      for (let run = 0; run < 11; run += 1) {
        store.clear(connectionId);
        const started = performance.now();
        const stop = watched
          ? onNextServerOutput(connectionId, () => {
              fired += 1;
            })
          : () => {};
        for (let statement = 0; statement < 2000; statement += 1)
          store.append(connectionId, null, lines);
        stop();
        durations.push(performance.now() - started);
        expect(entries()).toHaveLength(20_000);
      }
      durations.sort((a, b) => a - b);
      return { median: durations[5] ?? 0, p95: durations[10] ?? 0, fired };
    };
    stream(true);
    const plain = stream(false);
    const watched = stream(true);
    console.log(
      `performance server-output-stream: statements=2000 lines=20000 plain_median_ms=${plain.median.toFixed(3)} plain_p95_ms=${plain.p95.toFixed(3)} watched_median_ms=${watched.median.toFixed(3)} watched_p95_ms=${watched.p95.toFixed(3)} callbacks_per_run=${watched.fired / 11} runs=11`,
    );
    expect(watched.fired).toBe(11);
    expect(watched.p95).toBeLessThan(150);
  });
});
