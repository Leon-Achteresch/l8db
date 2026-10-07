import { beforeEach, describe, expect, mock, test } from "bun:test";
import { isQueryTask } from "@/lib/tasks";
import {
  clearWorkspaceMessage,
  formatQueryElapsed,
  showCopiedMessage,
  showWorkspaceMessage,
  useWorkspaceStatusStore,
  WORKSPACE_MESSAGE_DURATION,
} from "@/lib/workspace-status";

const writeText = mock(async (_text: string) => {});
mock.module("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText,
  readText: async () => "",
}));
const { copyText } = await import("@/lib/clipboard");

beforeEach(() => {
  writeText.mockReset();
  writeText.mockImplementation(async () => {});
  useWorkspaceStatusStore.setState({ message: null });
});

describe("Footer-Status", () => {
  test("bestätigt Kopieren erst nach erfolgreichem Schreiben, ohne den Inhalt anzuzeigen", async () => {
    let complete: (() => void) | undefined;
    writeText.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const operation = copyText("private cell contents");
    expect(useWorkspaceStatusStore.getState().message).toBeNull();
    complete?.();
    await operation;
    expect(useWorkspaceStatusStore.getState().message?.title).toBe("In die Zwischenablage kopiert");
    expect(WORKSPACE_MESSAGE_DURATION).toBe(3_000);
  });

  test("beibehält die Meldung bei ablaufendem Timer einer früheren Kopie", () => {
    showCopiedMessage("Name kopiert");
    const oldId = useWorkspaceStatusStore.getState().message?.id;
    showCopiedMessage("SQL kopiert");
    if (oldId !== undefined) clearWorkspaceMessage(oldId);
    expect(useWorkspaceStatusStore.getState().message?.title).toBe("SQL kopiert");
    const currentId = useWorkspaceStatusStore.getState().message?.id;
    if (currentId !== undefined) clearWorkspaceMessage(currentId);
    expect(useWorkspaceStatusStore.getState().message).toBeNull();
  });

  test("zeigt bei fehlgeschlagenem Kopieren keine Erfolgsmeldung", async () => {
    writeText.mockImplementation(async () => {
      throw new Error("clipboard unavailable");
    });
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText: async () => {
            throw new Error("denied");
          },
        },
      },
    });
    try {
      await expect(copyText("private contents")).rejects.toThrow("denied");
      expect(useWorkspaceStatusStore.getState().message).toBeNull();
    } finally {
      if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });

  test("trennt SQL-Aufgaben von Exporten und Transaktionen", () => {
    expect(isQueryTask({ title: "SQL-Abfrage" })).toBe(true);
    expect(isQueryTask({ title: "SQL-Skript" })).toBe(true);
    expect(isQueryTask({ title: "CSV-Export" })).toBe(false);
    expect(isQueryTask({ title: "Transaktion" })).toBe(false);
  });

  test("formatiert Laufzeit und den Abfrageabschluss", () => {
    expect(formatQueryElapsed(1_000, 4_000)).toBe("00:03");
    expect(formatQueryElapsed(1_000, 66_000)).toBe("01:05");
    expect(formatQueryElapsed(1_000, 500)).toBe("00:00");
    showWorkspaceMessage("SQL-Abfrage fehlgeschlagen", "error");
    expect(useWorkspaceStatusStore.getState().message?.tone).toBe("error");
  });
});
