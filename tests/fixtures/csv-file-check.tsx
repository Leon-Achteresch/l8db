import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CsvFileCheck } from "../../src/features/import/csv-file-check";
import { useCsvFileCheck } from "../../src/features/import/csv-import-panel/use-csv-file-check";
import type { CsvCheckReport, CsvCheckRequest } from "../../src/lib/db";
import "../../src/index.css";

type Scenario = "clean" | "findings" | "incomplete" | "changed" | "error" | "slow" | "stuck";
type Job = {
  jobId: string;
  scenario: Scenario;
  path: string;
  rows: number;
  timer: ReturnType<typeof setInterval> | null;
  settle: (report: CsvCheckReport) => void;
  fail: (error: string) => void;
};

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") !== "light");

const fixture = {
  scenario: (params.get("scenario") ?? "slow") as Scenario,
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  jobs: [] as Job[],
  picks: 0,
  late: 0,
};
Object.assign(window, { __csvCheck: fixture });

const handlers = new Map<number, (event: unknown) => void>();
let nextHandler = 1;
const emit = (jobId: string, rows: number) => {
  for (const [id, handler] of handlers)
    handler({ event: "csv-check-progress", id, payload: { jobId, rows } });
};

const base: CsvCheckReport = {
  status: "complete",
  checked_rows: 20_000,
  error_count: 0,
  issues: [],
  source_size: 1_048_576,
  source_modified_ms: Date.UTC(2026, 10, 17, 8, 30, 12),
};

const findings: CsvCheckReport["issues"] = [
  {
    row: 0,
    line: 1,
    column: null,
    kind: "structure",
    message: "Kopfzeile hat eine andere Spaltenzahl als die Vorschau.",
  },
  { row: 12, line: 15, column: null, kind: "structure", message: "5 statt 4 CSV-Spalten." },
  { row: 48, line: 51, column: "customer_id", kind: "not_null", message: "Darf nicht NULL sein." },
  ...Array.from({ length: 7 }, (_, index) => ({
    row: 1_048_570 + index,
    line: 1_048_583 + index,
    column: "a_very_long_target_column_name_for_tax_identifiers",
    kind: "not_null" as const,
    message: "Darf nicht NULL sein.",
  })),
];

const reports: Record<Exclude<Scenario, "slow" | "stuck" | "error">, CsvCheckReport> = {
  clean: base,
  findings: { ...base, error_count: 1_234, issues: findings },
  incomplete: {
    ...base,
    status: "incomplete",
    checked_rows: 4_096,
    error_count: 1,
    issues: [
      {
        row: 4_097,
        line: 0,
        column: null,
        kind: "parse",
        message: "Anführungszeichen nicht geschlossen.",
      },
    ],
  },
  changed: { ...base, status: "changed", checked_rows: 9_000 },
};

Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    transformCallback: (callback: (event: unknown) => void) => {
      const id = nextHandler++;
      handlers.set(id, callback);
      return id;
    },
    invoke: async (cmd: string, args: Record<string, unknown>) => {
      fixture.calls.push({ cmd, args });
      if (cmd === "plugin:event|listen") return args.handler;
      if (cmd === "plugin:event|unlisten") {
        handlers.delete(args.eventId as number);
        return null;
      }
      if (cmd === "cancel_execution") {
        const job = fixture.jobs.find((entry) => entry.jobId === args.jobId);
        if (job?.scenario === "stuck") return false;
        job?.settle({ ...base, status: "cancelled", checked_rows: job.rows });
        return job !== undefined;
      }
      if (cmd !== "check_csv_file") return null;
      const request = args.request as CsvCheckRequest;
      const jobId = (args.options as { jobId: string }).jobId;
      const scenario = fixture.scenario;
      return new Promise<CsvCheckReport>((resolve, reject) => {
        const job: Job = {
          jobId,
          scenario,
          path: request.source.path,
          rows: 0,
          timer: null,
          settle: (report) => {
            if (job.timer) clearInterval(job.timer);
            fixture.jobs = fixture.jobs.filter((entry) => entry !== job);
            resolve(report);
          },
          fail: (error) => {
            if (job.timer) clearInterval(job.timer);
            fixture.jobs = fixture.jobs.filter((entry) => entry !== job);
            reject(error);
          },
        };
        fixture.jobs.push(job);
        setTimeout(() => emit(jobId, 0), 0);
        job.timer = setInterval(() => {
          job.rows += 8_192;
          emit(jobId, job.rows);
        }, 250);
        if (scenario === "slow" || scenario === "stuck") return;
        setTimeout(() => {
          if (scenario === "error") job.fail("Datei nicht lesbar: Zugriff verweigert");
          else job.settle(reports[scenario]);
        }, 600);
      });
    },
  },
});

function settleLate() {
  const job = fixture.jobs[0];
  if (!job) return;
  fixture.late++;
  job.settle(base);
}

function Fixture() {
  const [path, setPath] = useState("/synthetic/orders.csv");
  const [scenario, setScenario] = useState(fixture.scenario);
  const [light, setLight] = useState(params.get("theme") === "light");
  const request = useMemo<CsvCheckRequest>(
    () => ({
      source: {
        path,
        format: "csv",
        delimiter: ",",
        quote: '"',
        has_header: true,
        empty_as_null: true,
        null_text: null,
        indices: [0, 1, 2, 3],
      },
      expected_columns: 4,
      columns: [
        { index: 0, name: "id", nullable: false },
        { index: 1, name: "customer_id", nullable: false },
        { index: 2, name: "a_very_long_target_column_name_for_tax_identifiers", nullable: false },
        { index: 3, name: "note", nullable: true },
      ],
    }),
    [path],
  );
  const check = useCsvFileCheck(request, "fixture:orders");
  const pick = () => {
    fixture.picks++;
    setPath((value) =>
      value.endsWith("orders.csv") ? "/synthetic/orders-fixed.csv" : "/synthetic/orders.csv",
    );
  };
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b border-dashed px-4 py-2 font-mono text-[11px] text-muted-foreground">
        <span>Fixture</span>
        <label className="flex items-center gap-1">
          Szenario
          <select
            aria-label="Szenario"
            className="rounded border bg-background px-1"
            value={scenario}
            onChange={(event) => {
              fixture.scenario = event.target.value as Scenario;
              setScenario(fixture.scenario);
            }}
          >
            {["slow", "stuck", "clean", "findings", "incomplete", "changed", "error"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        <button type="button" className="underline" onClick={pick}>
          Quelle wechseln
        </button>
        <button type="button" className="underline" onClick={settleLate}>
          Alte Antwort spät liefern
        </button>
        <button
          type="button"
          className="underline"
          onClick={() => {
            document.documentElement.classList.toggle("dark", light);
            setLight(!light);
          }}
        >
          {light ? "Dunkel" : "Hell"}
        </button>
        <span data-testid="source">{path}</span>
      </div>
      <div className="flex h-9 items-center gap-2 border-b px-4">
        <h3 className="text-xs font-semibold">Zuordnung</h3>
        <span className="text-xs text-muted-foreground tabular-nums">4 von 4 Spalten</span>
      </div>
      <CsvFileCheck check={check} importing={false} onPickFile={pick} />
      <div className="flex h-9 items-center gap-2 px-4">
        <h3 className="text-xs font-semibold">Vorschau</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          erste 50 von 20.000 Zeilen
        </span>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
