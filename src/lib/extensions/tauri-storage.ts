import { communityExtensionStore, deleteSecret, loadSecret, storeSecret } from "@/lib/db";
import type {
  ExtensionArchive,
  ExtensionStorage,
  InstalledExtension,
  Json,
  Permission,
} from "./contracts";

const secretAccount = (id: string, key: string) => `extension:${id}:${key}`;
const indexAccount = (id: string) => `extension-secret-index:${id}`;

async function secretKeys(id: string): Promise<string[]> {
  const raw = await loadSecret(indexAccount(id));
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((key) => typeof key === "string"))
    throw new Error("Ungültiger Extension-Secret-Index.");
  return parsed;
}

export class TauriExtensionStorage implements ExtensionStorage {
  list() {
    return communityExtensionStore<InstalledExtension[]>("list");
  }
  install(archive: ExtensionArchive, developmentPath?: string) {
    return communityExtensionStore<void>("install", "", { archive, developmentPath });
  }
  replace(id: string, archive: ExtensionArchive, developmentPath?: string) {
    return communityExtensionStore<void>("replace", id, { archive, developmentPath });
  }
  async remove(id: string) {
    for (const key of await secretKeys(id)) await deleteSecret(secretAccount(id, key));
    await deleteSecret(indexAccount(id));
    await communityExtensionStore<void>("remove", id);
  }
  update(id: string, enabled: boolean, grants: Permission[], configuration: Record<string, Json>) {
    return communityExtensionStore<void>("update", id, { enabled, grants, configuration });
  }
  get(id: string, key: string) {
    return communityExtensionStore<Json>("get", id, { key });
  }
  set(id: string, key: string, value: Json) {
    return communityExtensionStore<void>("set", id, { key, value });
  }
  secretGet(id: string, key: string) {
    return loadSecret(secretAccount(id, key));
  }
  async secretSet(id: string, key: string, value: string) {
    const keys = await secretKeys(id);
    if (!keys.includes(key)) await storeSecret(indexAccount(id), JSON.stringify([...keys, key]));
    await storeSecret(secretAccount(id, key), value);
  }
  async secretDelete(id: string, key: string) {
    await deleteSecret(secretAccount(id, key));
    const keys = await secretKeys(id);
    if (keys.includes(key))
      await storeSecret(indexAccount(id), JSON.stringify(keys.filter((k) => k !== key)));
  }
}
