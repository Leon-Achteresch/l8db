import { describe, expect, test } from "bun:test";
import { connectionStatusFor } from "../src/lib/connection-state";

const base = {
  activeId: null,
  isSwitching: false,
  targetId: null,
  errorId: null,
};

describe("connection status", () => {
  test("maps saved and active connections", () => {
    expect(connectionStatusFor({ ...base, connectionId: "saved" })).toBe("disconnected");
    expect(
      connectionStatusFor({ ...base, connectionId: "active", activeId: "active" }),
    ).toBe("connected");
  });

  test("shows both sides of a connection switch", () => {
    expect(
      connectionStatusFor({
        ...base,
        connectionId: "next",
        activeId: "current",
        isSwitching: true,
        targetId: "next",
      }),
    ).toBe("connecting");
    expect(
      connectionStatusFor({
        ...base,
        connectionId: "current",
        activeId: "current",
        isSwitching: true,
        targetId: "next",
      }),
    ).toBe("disconnecting");
  });

  test("shows a disconnect and a failed connection", () => {
    expect(
      connectionStatusFor({
        ...base,
        connectionId: "current",
        activeId: "current",
        isSwitching: true,
      }),
    ).toBe("disconnecting");
    expect(connectionStatusFor({ ...base, connectionId: "failed", errorId: "failed" })).toBe(
      "error",
    );
  });
});
