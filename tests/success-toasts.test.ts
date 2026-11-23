import { beforeEach, describe, expect, test } from "bun:test";
import { toast } from "sonner";
import "../src/components/ui/sonner";
import { DEFAULT_SETTINGS, useSettingsStore } from "../src/lib/settings";

globalThis.requestAnimationFrame ??= (callback: FrameRequestCallback) => {
  callback(0);
  return 0;
};
globalThis.cancelAnimationFrame ??= () => {};

beforeEach(() => {
  useSettingsStore.setState(structuredClone(DEFAULT_SETTINGS));
  toast.dismiss();
});

const active = () => toast.getToasts().filter((entry) => !("dismiss" in entry));

describe("success toasts", () => {
  test("are hidden by default", () => {
    toast.success("Kopiert");
    expect(active()).toHaveLength(0);
  });

  test("with an action stay visible", () => {
    toast.success("Gelöscht", { action: { label: "Rückgängig", onClick: () => {} } });
    expect(active().map((entry) => entry.title)).toContain("Gelöscht");
  });

  test("replacing a loading toast dismisses it", () => {
    const id = toast.loading("Exportiere …");
    toast.success("Exportiert", { id });
    expect(active().some((entry) => entry.id === id)).toBe(false);
  });

  test("show again when enabled", () => {
    useSettingsStore.setState({ successToasts: true });
    toast.success("Gespeichert");
    expect(active().map((entry) => entry.title)).toContain("Gespeichert");
  });

  test("hiding 10k success toasts stays fast and creates none", () => {
    const start = performance.now();
    for (let index = 0; index < 10_000; index++) toast.success(`Kopiert ${index}`);
    expect(performance.now() - start).toBeLessThan(200);
    expect(active()).toHaveLength(0);
  });
});
