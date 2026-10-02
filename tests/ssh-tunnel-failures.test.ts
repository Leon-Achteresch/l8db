import { beforeEach, expect, mock, test } from "bun:test";

const toasts: { level: string; message: string }[] = [];
let handler: ((event: { payload: unknown }) => void) | null = null;
let listens = 0;

mock.module("sonner", () => ({
  toast: {
    error: (message: string) => toasts.push({ level: "error", message }),
    warning: (message: string) => toasts.push({ level: "warning", message }),
  },
}));

mock.module("@tauri-apps/api/event", () => ({
  listen: async (event: string, callback: (event: { payload: unknown }) => void) => {
    listens += 1;
    expect(event).toBe("ssh-tunnel-failed");
    handler = callback;
    return () => {};
  },
}));

const { useConnectionsStore } = await import("@/lib/connections");
const { watchTunnelFailures } = await import("@/lib/ssh/tunnel-failures");

beforeEach(() => {
  toasts.length = 0;
  useConnectionsStore.setState({
    connections: [
      {
        id: "c1",
        name: "Prod",
        connectionString: "postgres://u@db:5432/app",
        tunnelPort: 41000,
      } as never,
    ],
  });
});

test("a fatal tunnel failure is shown and forces the tunnel to be reopened", async () => {
  watchTunnelFailures();
  watchTunnelFailures();
  for (let i = 0; i < 5 && !handler; i += 1) await Bun.sleep(5);
  expect(listens).toBe(1);
  handler?.({
    payload: { id: "c1", error: "SSH-Host-Key von db:22 hat sich geändert", fatal: true },
  });
  expect(toasts).toEqual([
    {
      level: "error",
      message: "SSH-Tunnel „Prod“ getrennt: SSH-Host-Key von db:22 hat sich geändert",
    },
  ]);
  expect(useConnectionsStore.getState().connections[0]?.tunnelPort).toBeNull();
});

test("a transient tunnel failure warns without dropping the tunnel port", async () => {
  watchTunnelFailures();
  handler?.({ payload: { id: "c1", error: "Timeout", fatal: false } });
  expect(toasts[0]?.level).toBe("warning");
  expect(toasts[0]?.message).toContain("Prod");
  expect(useConnectionsStore.getState().connections[0]?.tunnelPort).toBe(41000);
});
