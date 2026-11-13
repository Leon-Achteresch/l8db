import { useEffect, useState } from "react";
import { TransferCinema } from "@/features/transfer/cinema/transfer-cinema";
import type { SavedConnection } from "@/lib/connections";
import type { TransferOutcome, TransferProgress } from "@/lib/db";

const TABLES = ["users", "orders", "order_items", "invoices", "customers", "payments", "audit_log"];

function connection(id: string, name: string): SavedConnection {
  return { id, name, kind: "postgres", connectionString: "" } as SavedConnection;
}

const SOURCE = connection("dev-source", "Staging");
const TARGET = connection("dev-target", "Produktion");

export function TransferCinemaOverlayPreview({
  sourceName,
  targetName,
  seconds,
  fail,
}: {
  sourceName: string;
  targetName: string;
  seconds: number;
  fail: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 200);
    return () => window.clearInterval(timer);
  }, [open, startedAt]);

  const share = Math.min(1, elapsed / seconds);
  const done = elapsed >= seconds;
  const index = Math.min(TABLES.length - 1, Math.floor(share * TABLES.length));
  const totalRows = Math.floor(share * 1_842_330);
  const progress: TransferProgress["progress"] = {
    phase: share < 0.08 ? "pre" : share < 0.9 ? "data" : "post",
    table: TABLES[index],
    tableIndex: share < 0.08 ? 0 : Math.floor(((share - 0.08) / 0.82) * TABLES.length),
    tables: TABLES.length,
    rows: totalRows % 120_000,
    totalRows,
  };
  const outcome: TransferOutcome | null = done
    ? {
        tables: TABLES.map((name) => ({ schema: "public", name, rows: 1000 })),
        rows: totalRows,
        atomic: true,
        committed: !fail,
        rolledBack: fail,
        kept: false,
        leftovers: [],
        warnings: [],
        error: fail ? 'duplicate key value violates unique constraint "orders_pkey"' : null,
      }
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStartedAt(Date.now());
          setElapsed(0);
          setOpen(true);
        }}
        className="h-8 rounded-md border px-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        Im Overlay ansehen
      </button>
      <TransferCinema
        open={open}
        source={SOURCE}
        target={TARGET}
        sourceDatabase={sourceName}
        targetDatabase={targetName}
        plan={null}
        progress={progress}
        outcome={outcome}
        running={open && !done}
        startedAt={startedAt}
        onCancel={() => setStartedAt(Date.now() - seconds * 1000)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
