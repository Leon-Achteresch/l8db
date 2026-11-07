import { describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: async () => {
    throw new Error("not available in tests");
  },
}));

const { redactErrorMessage } = await import("@/lib/diagnostics/redact");

describe("redactErrorMessage entfernt Geheimnisse vollständig", () => {
  const cases: [string, string[]][] = [
    ["Authorization: Bearer abc.def.ghi", ["abc.def.ghi"]],
    ["authorization=Basic dXNlcjpwYXNz", ["dXNlcjpwYXNz"]],
    ["request failed with header Bearer eyJhbGciOi.payload.sig", ["eyJhbGciOi"]],
    ["password='correct horse battery'", ["correct", "horse", "battery"]],
    ['password="correct horse battery"', ["correct", "horse", "battery"]],
    ['{"password":"s3cret value","user":"app"}', ["s3cret", "value"]],
    ["Server=db;PWD={my secret};Database=x", ["my secret", "secret}"]],
    ["api_key: 'k 1 2'", ["k 1 2", "1 2'"]],
    ["token = abc123", ["abc123"]],
  ];
  for (const [input, leaked] of cases) {
    test(input, () => {
      const output = redactErrorMessage(input);
      for (const fragment of leaked) expect(output).not.toContain(fragment);
      expect(output).toContain("<redacted>");
    });
  }

  test("normale Fehlermeldungen bleiben lesbar", () => {
    expect(redactErrorMessage('password authentication failed for user "app"')).toBe(
      'password authentication failed for user "app"',
    );
    expect(redactErrorMessage('{"password":"x","user":"app"}')).toContain('"user":"app"');
    expect(redactErrorMessage("Server=db;PWD={a b};Database=x")).toContain("Database=x");
  });
});

describe("URL-Schwärzung bleibt linear und erfasst angrenzende Schemata", async () => {
  const { connectionError } = await import("@/lib/connection-url/errors");
  const { text } = await import("@/lib/ai/rich-core");
  const inputs = [
    "x".repeat(16_000),
    "a1".repeat(8_000),
    `a${"1".repeat(16_000)}`,
    `a://${":".repeat(15_990)}`,
    `a://${"a:".repeat(7_998)}`,
    `${"a1".repeat(7_990)}://x`,
  ];
  const redactors: [string, (input: string) => string][] = [
    ["redactErrorMessage", redactErrorMessage],
    ["connectionError", connectionError],
    ["text", (input) => text(input, 20_000)],
  ];
  for (const [name, redact] of redactors)
    test(`${name} bleibt bei langen Ausgaben ohne Leerzeichen linear`, () => {
      for (const input of inputs) {
        redact(input);
        const runs = Array.from({ length: 3 }, () => {
          const start = performance.now();
          redact(input);
          return performance.now() - start;
        });
        expect(Math.min(...runs)).toBeLessThan(50);
      }
    });
  test("Schema direkt nach Ziffer oder Unterstrich", () => {
    for (const prefix of ["1", "_", "-", "x+"]) {
      const url = `${prefix}postgres://user:pw@host/db`;
      expect(redactErrorMessage(url)).not.toContain("pw");
      expect(connectionError(url)).not.toContain("pw");
      expect(text(url)).not.toContain("pw");
    }
    expect(text("1postgres://user:secret@host/db")).toBe("1postgres://[redacted]@host/db");
    expect(text("see 123://u:p@h")).toBe("see 123://u:p@h");
    expect(text("jdbc:mysql://a:b:c@h x")).toBe("jdbc:mysql://[redacted]@h x");
    expect(connectionError("failed at postgres://u:p@h/db now")).toBe(
      "failed at [Verbindungs-URL] now",
    );
  });
});
