import { describe, expect, test } from "bun:test";
import { isBlockedNativeShortcut } from "@/lib/native-guards";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe("isBlockedNativeShortcut", () => {
  test("blocks reload, print and find", () => {
    expect(isBlockedNativeShortcut(key("F5"))).toBe(true);
    for (const k of ["r", "P", "f"]) {
      expect(isBlockedNativeShortcut(key(k, { metaKey: true, ctrlKey: true }))).toBe(true);
    }
  });
  test("keeps editing shortcuts", () => {
    for (const k of ["c", "v", "x", "z", "a"]) {
      expect(isBlockedNativeShortcut(key(k, { metaKey: true, ctrlKey: true }))).toBe(false);
    }
    expect(isBlockedNativeShortcut(key("r"))).toBe(false);
  });
});
