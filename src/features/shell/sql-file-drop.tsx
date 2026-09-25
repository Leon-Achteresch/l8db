import { useNavigate } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { toast } from "sonner";

import { isMainWindow } from "@/lib/connections";
import { OPEN_FILES_EVENT, resolveOpenFiles, takePendingOpenFiles } from "@/lib/db";
import { type OpenFileTarget, runOpenFileActions } from "@/lib/file-open";
import { isSqlDropName } from "@/lib/sql-file";
import { useTableTabs } from "@/lib/table-tabs";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function SqlFileDrop() {
  const navigate = useNavigate();

  useEffect(() => {
    const go = (id: string | null) => {
      if (id) void navigate({ to: "/query/$id", params: { id } });
    };
    const open = (target: OpenFileTarget) => {
      if (target?.to === "/query/$id") go(target.id);
      else if (target) void navigate({ to: target.to });
    };
    let draining = Promise.resolve();
    const drainPending = () => {
      draining = draining
        .then(takePendingOpenFiles)
        .then(runOpenFileActions)
        .then(open)
        .catch(() => undefined);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (isTauri()) return;
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        isSqlDropName(file.name),
      );
      if (files.length === 0) {
        toast.error("Nur .sql-Dateien können per Drag-and-Drop geöffnet werden.");
        return;
      }
      void Promise.all(files.map((file) => file.text())).then((texts) => {
        let last: string | null = null;
        for (let i = 0; i < files.length; i++) {
          last = useTableTabs.getState().openQueryTabWithSql(texts[i] ?? "", files[i]?.name);
        }
        go(last);
      });
    };

    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);

    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const keep = (fn: () => void) => {
      if (disposed) fn();
      else unlisteners.push(fn);
    };
    if (isTauri()) {
      void getCurrentWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          void resolveOpenFiles(event.payload.paths)
            .then(runOpenFileActions)
            .then(open)
            .catch(() => undefined);
        })
        .then(keep);
      if (isMainWindow) {
        void listen(OPEN_FILES_EVENT, drainPending).then(keep).finally(drainPending);
      }
    }

    return () => {
      disposed = true;
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("drop", onDrop, true);
      for (const fn of unlisteners) fn();
    };
  }, [navigate]);

  return null;
}
