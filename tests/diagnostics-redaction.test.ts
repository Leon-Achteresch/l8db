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
