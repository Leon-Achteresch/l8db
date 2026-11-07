import { useEffect } from "react";
import { useBackupToolPaths } from "@/lib/backup-runner";
import { isMainWindow, useConnectionsStore } from "@/lib/connections";
import {
  branchingLocal,
  branchingSchedules,
  branchingSnapshot,
  type ScheduleEntry,
} from "@/lib/db";
import { errorMessageOf } from "@/lib/error-details";
import { needsPassword } from "@/lib/password-prompt";
import { prepareConnection } from "@/lib/prepare-connection";
import { effectiveConnectionString } from "@/lib/ssh";
import { runBranchingJob } from "./jobs";

const RETRY_MS = 30 * 60_000;
const attempts = new Map<string, number>();

export function dueSchedules(
  entries: ScheduleEntry[],
  now: number,
  recent: Map<string, number>,
): ScheduleEntry[] {
  return entries.filter(({ key, schedule }) => {
    const last = schedule.lastRunAt ? Date.parse(schedule.lastRunAt) : Number.NaN;
    const due = Number.isNaN(last) || now - last >= schedule.everyHours * 3_600_000;
    const tried = recent.get(key);
    return due && (tried === undefined || now - tried >= RETRY_MS);
  });
}

export async function runDueSnapshots(now = Date.now()): Promise<void> {
  const entries = await branchingSchedules().catch(() => []);
  for (const entry of dueSchedules(entries, now, attempts)) {
    attempts.set(entry.key, now);
    const connection = useConnectionsStore
      .getState()
      .connections.find((item) => item.id === entry.schedule.connectionId);
    const skip = (reason: string) =>
      branchingLocal({ action: "schedule_skipped", key: entry.key, reason }).catch(() => undefined);
    if (!connection) {
      await skip("Sicherung übersprungen: Die Verbindung existiert nicht mehr.");
      continue;
    }
    if (connection.kind !== "postgres") continue;
    if (needsPassword(connection)) {
      await skip(
        "Sicherung übersprungen: Für die Verbindung ist eine Passworteingabe nötig. Passwort speichern, damit die Sicherung automatisch laufen kann.",
      );
      continue;
    }
    try {
      const ready = await prepareConnection(connection.id);
      const url = effectiveConnectionString(ready);
      void runBranchingJob(
        () =>
          branchingSnapshot(
            url,
            { database: entry.database, scheduled: true, server: entry.server },
            useBackupToolPaths.getState().paths,
          ),
        `Geplante Sicherung · ${entry.database}`,
        ready,
        entry.database,
      ).catch(() => undefined);
    } catch (error) {
      await skip(`Sicherung übersprungen: Verbindung nicht möglich (${errorMessageOf(error)}).`);
    }
  }
}

export function useSnapshotScheduler() {
  useEffect(() => {
    if (!isMainWindow) return;
    const tick = () => void runDueSnapshots();
    const first = window.setTimeout(tick, 30_000);
    const timer = window.setInterval(tick, 5 * 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
}
