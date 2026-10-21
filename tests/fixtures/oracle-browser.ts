import type { Page } from "playwright";

export const oracleBridge = process.env.L8DB_ORACLE_BRIDGE ?? "http://127.0.0.1:27031";
export const oracleAppUrl = process.env.L8DB_ORACLE_BROWSER_URL ?? "http://127.0.0.1:1431";

type Call = { command: string; args: Record<string, unknown> };

export async function openOracleApp(page: Page, path = "/", activeId = "oracle-lab") {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message !== "ResizeObserver loop completed with undelivered notifications.")
      errors.push(error.message);
  });
  await page.addInitScript(
    ({ bridge, activeId }) => {
      if (!localStorage.getItem("l8db.connections")) {
        localStorage.setItem(
          "l8db.settings",
          JSON.stringify({ state: { tourFinished: true, onboardingDone: true }, version: 0 }),
        );
        localStorage.setItem(
          "l8db.connections",
          JSON.stringify({
            state: {
              connections: [
                {
                  id: "oracle-lab",
                  name: "Oracle Lab",
                  kind: "oracle",
                  connectionString: "oracle://l8db@127.0.0.1:15219/FREEPDB1",
                  sslMode: "disable",
                  ssh: null,
                },
                {
                  id: "oracle-debug",
                  name: "Oracle Debug",
                  kind: "oracle",
                  connectionString: "oracle://l8db_debug@127.0.0.1:15219/FREEPDB1",
                  sslMode: "disable",
                  ssh: null,
                },
              ],
              activeId,
            },
            version: 0,
          }),
        );
      }
      const host = window as unknown as {
        __TAURI_INTERNALS__: unknown;
        __TAURI_EVENT_PLUGIN_INTERNALS__: unknown;
        oracleCalls: { command: string; args: Record<string, unknown> }[];
        oracleFailures: { command: string; error: string }[];
      };
      host.oracleCalls = [];
      host.oracleFailures = [];
      host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      host.__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        unregisterCallback: () => {},
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          if (/^(mcp_|automation_|team_)/.test(command)) return Promise.reject("not available");
          if (command.endsWith("secret"))
            return command === "load_secret" &&
              ["oracle-lab", "oracle-debug"].includes(String(args.account))
              ? "l8dbtest"
              : null;
          if (
            command.startsWith("plugin:") ||
            command.includes("extension") ||
            command === "list_ssh_tunnels"
          )
            return [];
          host.oracleCalls.push({ command, args });
          const response = await fetch(bridge, {
            method: "POST",
            body: JSON.stringify({ command, args }),
          });
          const value = await response.json();
          if (value.error !== undefined) {
            host.oracleFailures.push({ command, error: value.error });
            return Promise.reject(value.error);
          }
          return value.result;
        },
      };
    },
    { bridge: oracleBridge, activeId },
  );
  await page.goto(`${oracleAppUrl}${path}`);
  return errors;
}

export function oracleCalls(page: Page) {
  return page.evaluate(() => (window as unknown as { oracleCalls: Call[] }).oracleCalls);
}

export function oracleFailures(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { oracleFailures: { command: string; error: string }[] })
        .oracleFailures,
  );
}
