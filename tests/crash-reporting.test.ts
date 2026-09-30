import { describe, expect, test } from "bun:test";
import { scrubEvent } from "@/lib/crash-reporting";

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
