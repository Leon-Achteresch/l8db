import { describe, expect, test } from "bun:test";
import { type SavedView, savedViewKey, transferableFilters } from "../src/lib/views";

const view: SavedView = {
  id: "active-users",
  name: "Aktive Nutzer",
  filter: "active = true",
  filterRaw: true,
  color: "#3b82f6",
};

describe("transferableFilters", () => {
  test("findet Filter anderer Connections unabhängig von Datenbank und Schema", () => {
    const key = savedViewKey("production", "main", "custom", "users");
    const views = {
      [key]: [view],
      [savedViewKey("development", "other", "public", "users")]: [view],
      [savedViewKey("production", "main", "custom", "orders")]: [view],
      [savedViewKey("production", "main", "custom", "Users")]: [view],
    };

    expect(transferableFilters(views, "development", "users")).toEqual([
      {
        key,
        sourceConnectionId: "production",
        database: "main",
        schema: "custom",
        view,
      },
    ]);
    expect(views[key]).toEqual([view]);
  });

  test("ignoriert Ansichten ohne Filter und ungültige Schlüssel", () => {
    const key = savedViewKey("production", null, "public", "users");
    const views = {
      [key]: [{ ...view, filter: "  " }, view],
      invalid: [view],
      null: [view],
      '["production",null,"users"]': [view],
      '["production",{},"public","users"]': [view],
    };

    expect(transferableFilters(views, "development", "users").map((entry) => entry.view)).toEqual([
      view,
    ]);
  });
});
