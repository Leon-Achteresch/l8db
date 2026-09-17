import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

import { openDroppedSqlPaths } from "@/lib/hooks/use-query-file";
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
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void getCurrentWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          void openDroppedSqlPaths(event.payload.paths).then(go);
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        });
    }

    return () => {
      disposed = true;
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("drop", onDrop, true);
      unlisten?.();
    };
  }, [navigate]);

  return null;
}
