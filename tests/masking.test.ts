import { describe, expect, test } from "bun:test";
import {
  applyMasks,
  fakeValue,
  hashText,
  maskValue,
  partialMask,
  resolveMasks,
} from "../src/lib/masking";
import { connectionMaskRules } from "../src/lib/masking-display";
import type { McpConfig } from "../src/lib/mcp";

describe("Maskierungsfunktionen", () => {
  test("Hash entspricht FNV-1a 64 wie im Backend", () => {
    expect(hashText("")).toBe("cbf29ce484222325");
    expect(hashText("a")).toBe("af63dc4c8601ec8c");
  });

  test("Teilmaske für E-Mail und Text", () => {
    expect(partialMask("jan@example.de")).toBe("j***@example.de");
    expect(partialMask("Schmidt")).toBe("S***t");
    expect(partialMask("Anna")).toBe("A***");
    expect(partialMask("ab")).toBe("***");
    expect(partialMask("Österreich")).toBe("Ö***h");
  });

  test("Ersatzwerte sind deterministisch und typgerecht", () => {
    const email = fakeValue("email", "a@b.de");
    expect(email).toBe(fakeValue("email", "a@b.de"));
    expect(email).toMatch(/^[a-z]+\.[a-z]+\d{3}@example\.de$/);
    expect(fakeValue("vorname", "Max")).not.toBe("Max");
    expect(fakeValue("amount", "1234")).toMatch(/^\d{4}$/);
  });

  test("Modi ersetzen Werte, NULL bleibt NULL", () => {
    expect(maskValue("x", "geheim", { column: "x", mode: "null" })).toBeNull();
    expect(maskValue("x", "geheim", { column: "x", mode: "text", text: "***" })).toBe("***");
    expect(maskValue("x", null, { column: "x", mode: "hash" })).toBeNull();
    expect(maskValue("x", { a: 1 }, { column: "x", mode: "hash" })).toBe(hashText('{"a":1}'));
  });

  test("Mischen behält die Werte der Spalte", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: i, v: `w${i}` }));
    const out = applyMasks(["id", "v"], rows, [{ column: "v", mode: "shuffle" }]);
    expect(out.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(out.map((row) => row.v).sort()).toEqual(rows.map((row) => row.v).sort());
    expect(out.some((row, i) => row.v !== rows[i].v)).toBe(true);
    expect(applyMasks(["id", "v"], rows, [{ column: "v", mode: "shuffle" }])).toEqual(out);
  });
});

describe("Regeln pro Verbindung", () => {
  const config = {
    redaction: {
      columns: [{ name: "Passwort", pattern: "pass(word)?", enabled: true }],
      values: [],
      replacement: "[redacted]",
    },
    connections: [{ id: "c1", redactColumns: ["iban"] }],
  } as unknown as McpConfig;

  test("Verbindungsregeln vor MCP-Spalten und globalen Regeln", () => {
    const { rules, replacement } = connectionMaskRules(
      {
        id: "c1",
        maskRules: [{ name: "mail", pattern: "e.?mail", enabled: true, mask: "partial" }],
      },
      config,
    );
    const masks = resolveMasks(["id", "email", "iban", "password", "name"], rules, replacement);
    expect(masks).toEqual([
      { column: "email", mode: "partial", text: null },
      { column: "iban", mode: "text", text: "[redacted]" },
      { column: "password", mode: "text", text: "[redacted]" },
    ]);
  });

  test("ungültige oder deaktivierte Regeln werden ignoriert", () => {
    expect(
      resolveMasks(
        ["a", "b"],
        [
          { name: "x", pattern: "(", enabled: true },
          { name: "y", pattern: "b", enabled: false },
          { name: "z", pattern: "(?i)A", enabled: true, mask: "hash" },
        ],
      ),
    ).toEqual([{ column: "a", mode: "hash", text: null }]);
  });
});
