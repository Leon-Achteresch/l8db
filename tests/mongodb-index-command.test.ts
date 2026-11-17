import { expect, test } from "bun:test";
import { EMPTY_MONGO_INDEX, mongoIndexCommand } from "../src/lib/mongo-index";

test("MongoDB index form builds a createIndexes command", () => {
  expect(JSON.parse(mongoIndexCommand("users", EMPTY_MONGO_INDEX))).toEqual({
    createIndexes: "users",
    indexes: [{ key: { field: 1 }, name: "field_1" }],
  });
  const command = mongoIndexCommand("sessions", {
    field: "created_at",
    direction: "-1",
    unique: true,
    ttl: "3600",
    name: "",
  });
  expect(JSON.parse(command).indexes[0]).toEqual({
    key: { created_at: -1 },
    name: "created_at_-1",
    unique: true,
    expireAfterSeconds: 3600,
  });
  const text = JSON.parse(
    mongoIndexCommand("docs", { ...EMPTY_MONGO_INDEX, field: "body", direction: "text", ttl: "x" }),
  );
  expect(text.indexes[0]).toEqual({ key: { body: "text" }, name: "body_text" });
});
