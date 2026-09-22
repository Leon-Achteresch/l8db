import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ExtensionArchive } from "../src/lib/extensions/contracts";
import { ExtensionManager } from "../src/lib/extensions/manager";
import {
  downloadMarketExtension,
  loadMarketCatalog,
  validateMarketCatalog,
} from "../src/lib/extensions/market";

const CATALOG_URL = "https://example.com/market/catalog.json";

function entry(bytes: string) {
  return {
    id: "l8db.jev",
    name: "Jev Plan-Diagnose",
    description: "BYOK-Diagnose",
    version: "1.0.0",
    publisher: "l8db",
    package: "packages/l8db.jev-1.0.0.l8db-extension",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

describe("offizieller Extension-Markt", () => {
  test("validiert Katalog und lehnt doppelte oder fremde Pakete ab", async () => {
    const bytes = await readFile("extention/l8db.jev-1.0.0.l8db-extension", "utf8");
    const item = entry(bytes);
    expect(validateMarketCatalog({ schemaVersion: 1, extensions: [item] }).extensions).toHaveLength(
      1,
    );
    expect(() => validateMarketCatalog({ schemaVersion: 1, extensions: [item, item] })).toThrow();
    expect(() =>
      validateMarketCatalog({
        schemaVersion: 1,
        extensions: [{ ...item, package: "https://evil.example/package" }],
      }),
    ).toThrow();
    expect(() => validateMarketCatalog({ schemaVersion: 2, extensions: [] })).toThrow();
  });

  test("lädt Katalog und Paket, prüft Hash und installiert deaktiviert", async () => {
    const bytes = await readFile("extention/l8db.jev-1.0.0.l8db-extension", "utf8");
    const item = entry(bytes);
    const called: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      called.push(url);
      return new Response(
        url === CATALOG_URL ? JSON.stringify({ schemaVersion: 1, extensions: [item] }) : bytes,
      );
    };
    const catalog = await loadMarketCatalog(fetcher, CATALOG_URL);
    const archive = await downloadMarketExtension(catalog.extensions[0], fetcher, CATALOG_URL);
    expect(called).toEqual([
      CATALOG_URL,
      "https://example.com/market/packages/l8db.jev-1.0.0.l8db-extension",
    ]);
    const stored = new Map<
      string,
      { archive: ExtensionArchive; enabled: boolean; grants: string[]; configuration: object }
    >();
    const manager = new ExtensionManager(
      {
        list: async () => [...stored.values()],
        install: async (value) => {
          stored.set(value.manifest.id, {
            archive: value,
            enabled: false,
            grants: [],
            configuration: {},
          });
        },
        replace: async () => undefined,
        remove: async (id) => {
          stored.delete(id);
        },
        update: async (id, enabled, grants, configuration) => {
          const item = stored.get(id);
          if (!item) throw new Error("Missing test extension");
          Object.assign(item, { enabled, grants, configuration });
        },
        get: async () => null,
        set: async () => undefined,
        secretGet: async () => null,
        secretSet: async () => undefined,
        secretDelete: async () => undefined,
      },
      {
        load: async () => undefined,
        activate: async () => undefined,
        deactivate: async () => undefined,
        unload: async () => undefined,
        execute: async () => undefined,
        event: () => undefined,
      },
      {
        database: () => null,
        notify: () => undefined,
        query: async () => {
          throw new Error("unavailable");
        },
        fetch: async () => {
          throw new Error("unavailable");
        },
        clipboardRead: async () => "",
        clipboardWrite: async () => undefined,
        showOpenDialog: async () => null,
        showSaveDialog: async () => null,
        readTextFile: async () => "",
        writeTextFile: async () => undefined,
        runProcess: async () => ({ status: 0, stdout: "", stderr: "" }),
        prompt: async () => undefined,
      },
      "0.6.0",
    );
    await manager.installExtension(archive);
    expect(stored.get("l8db.jev")?.enabled).toBe(false);
    await manager.enableExtension("l8db.jev", ["network", "filesystem:extension-storage"]);
    expect(stored.get("l8db.jev")?.grants).toEqual(["network", "filesystem:extension-storage"]);
    await manager.uninstallExtension("l8db.jev");
    expect(stored.size).toBe(0);
  });

  test("weist manipulierte und nicht passende Pakete zurück", async () => {
    const bytes = await readFile("extention/l8db.jev-1.0.0.l8db-extension", "utf8");
    const item = entry(bytes);
    const fetcher: typeof fetch = async () => new Response(`${bytes} `);
    await expect(downloadMarketExtension(item, fetcher, CATALOG_URL)).rejects.toThrow("Hash");
    const mismatched = { ...item, id: "l8db.other" };
    const original: typeof fetch = async () => new Response(bytes);
    await expect(downloadMarketExtension(mismatched, original, CATALOG_URL)).rejects.toThrow(
      "Metadaten",
    );
  });
});
