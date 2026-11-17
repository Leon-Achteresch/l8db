import { invoke } from "@tauri-apps/api/core";
import type { DetailedColumnInfo } from "./columns";
import type { TableData } from "./types";

export type ArrayEditorSnapshot = {
  data: TableData;
  details: Record<string, string | null>;
};
export type ArrayEditorContext = {
  ephemeral: boolean;
  token: string;
  columns: DetailedColumnInfo[];
  snapshot: ArrayEditorSnapshot;
};

export async function arrayEditorDevelopmentContext(): Promise<ArrayEditorContext> {
  const context = await invoke<ArrayEditorContext>("array_editor_development_context");
  if (context.ephemeral !== true || !/^l8db_a01_[0-9a-f]{12}$/.test(context.token))
    throw Error("Keine isolierte A01-Entwicklungsumgebung.");
  return context;
}

export async function readArrayEditorFixture(): Promise<ArrayEditorSnapshot> {
  return invoke("array_editor_development_read");
}

export async function updateArrayEditorCell(
  token: string,
  ctid: string,
  column: string,
  value: string | null,
): Promise<void> {
  await invoke("update_row", {
    kind: "postgres",
    connectionString: token,
    database: undefined,
    schema: "a01_editor",
    table: "cells",
    ctid,
    updates: { [column]: value },
  });
}
