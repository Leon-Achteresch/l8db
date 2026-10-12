import { describe, expect, test } from "bun:test";
import { scrubEvent, scrubLog, scrubTransaction } from "@/lib/crash-reporting";

describe("scrubEvent", () => {
  test("entfernt URLs, Geheimnisse, Request und Nutzer", () => {
    const event = scrubEvent({
      message: "password=hunter2",
      request: { url: "tauri://localhost/tables/public/users" },
      user: { ip_address: "1.2.3.4" },
      exception: {
        values: [{ type: "Error", value: "connect postgres://admin:hunter2@db.example.com/prod" }],
      },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("db.example.com");
    expect(text).not.toContain("tables/public/users");
    expect(event?.user).toBeUndefined();
  });

  test("verwirft Promise-Rejections ohne Error-Objekt", () => {
    expect(
      scrubEvent({ exception: { values: [{ type: "UnhandledRejection", value: "relation x" }] } }),
    ).toBeNull();
  });
});

describe("scrubTransaction", () => {
  test("entfernt Pfade, Hosts und Attributwerte aus Spans", () => {
    const event = scrubTransaction({
      request: { url: "tauri://localhost/tables/public/users" },
      contexts: { trace: { data: { url: "tauri://localhost/tables/public/users" } } },
      spans: [
        { description: 'body > button[title="users"]', data: {} },
        { description: "GET https://db.example.com/x?token=hunter2", data: { url: "x" } },
      ],
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain("users");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("db.example.com");
  });
});

describe("scrubLog", () => {
  test("redigiert die Nachricht und verwirft Roh-Parameter", () => {
    const log = scrubLog({
      message: "failed postgres://admin:hunter2@db.example.com/prod",
      attributes: { "sentry.message.parameter.0": "select * from users", "sentry.origin": "x" },
    });
    const text = JSON.stringify(log);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("select");
    expect(log.attributes?.["sentry.origin"]).toBe("x");
  });
});
