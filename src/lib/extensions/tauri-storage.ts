import { communityExtensionStore, deleteSecret, loadSecret, storeSecret } from "@/lib/db";
import type {
  ExtensionArchive,
  ExtensionStorage,
  InstalledExtension,
  Json,
  Permission,
} from "./contracts";
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
  remove(id: string) {
    return communityExtensionStore<void>("remove", id);
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
    return loadSecret(`extension:${id}:${key}`);
  }
  secretSet(id: string, key: string, value: string) {
    return storeSecret(`extension:${id}:${key}`, value);
  }
  secretDelete(id: string, key: string) {
    return deleteSecret(`extension:${id}:${key}`);
  }
}
