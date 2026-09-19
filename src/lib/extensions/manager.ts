import { gt } from "semver";
import { validateArchive } from "../../../packages/extension-api/src/manifest";
import type { ExtensionArchive, ExtensionDescriptor, Json, Permission } from "./contracts";
import { ExtensionError } from "./contracts";
import { ExtensionManagerBase } from "./manager/extension-manager-base";
import { isWriteQuery } from "./manager/is-write-query";

export { isWriteQuery };

export class ExtensionManager extends ExtensionManagerBase {
  installExtension(archive: ExtensionArchive, developmentPath?: string) {
    return this.serial(async () => {
      const validated = validateArchive(archive);
      const extension: ExtensionDescriptor = {
        archive: validated,
        enabled: false,
        grants: [],
        configuration: {},
        developmentPath,
        state: "discovered",
      };
      const id = validated.manifest.id;
      this.registry.add(extension);
      try {
        this.prepare(extension);
        await this.storage.install(validated, developmentPath);
      } catch (error) {
        this.release(id);
        this.registry.remove(id);
        throw error;
      }
      this.log(id, "info", "installed (disabled)");
    });
  }
  enableExtension(id: string, grants: Permission[]) {
    return this.serial(async () => {
      const extension = this.registry.get(id);
      this.permissions.validate(extension.archive.manifest, grants);
      this.loader.validate(structuredClone(extension));
      if (!this.contributions.has(id)) this.prepare(extension);
      await this.stop(id);
      await this.storage.update(id, true, grants, extension.configuration);
      extension.grants = [...grants];
      extension.enabled = true;
      extension.error = undefined;
      extension.state = "validated";
      this.changed();
      if (
        extension.archive.manifest.activationEvents.includes("onStartup") ||
        (this.core.database() &&
          extension.archive.manifest.activationEvents.includes("onDatabaseOpen"))
      )
        await this.activate(id);
    });
  }
  disableExtension(id: string) {
    return this.serial(async () => {
      const extension = this.registry.get(id);
      await this.storage.update(id, false, extension.grants, extension.configuration);
      extension.enabled = false;
      await this.stop(id);
    });
  }
  uninstallExtension(id: string) {
    return this.serial(async () => {
      const extension = this.registry.get(id);
      await this.storage.update(id, false, extension.grants, extension.configuration);
      extension.enabled = false;
      await this.stop(id);
      await this.storage.remove(id);
      this.release(id);
      this.registry.remove(id);
      this.fsGrants.delete(id);
      this.changed();
    });
  }
  updateExtension(archive: ExtensionArchive, developmentPath?: string) {
    return this.serial(async () => {
      const validated = validateArchive(archive);
      const id = validated.manifest.id;
      const extension = this.registry.get(id);
      const previous = extension.archive.manifest.version;
      if (!gt(validated.manifest.version, previous))
        throw new ExtensionError(
          "ManifestValidationError",
          `Version ${validated.manifest.version} is not newer than ${previous}`,
        );
      const wasEnabled = extension.enabled;
      await this.stop(id);
      this.release(id);
      const declared = validated.manifest.permissions ?? [];
      const settings = validated.manifest.contributes?.configuration ?? {};
      const restore = structuredClone(extension);
      extension.archive = validated;
      extension.developmentPath = developmentPath;
      extension.grants = extension.grants.filter((grant) => declared.includes(grant));
      extension.configuration = Object.fromEntries(
        Object.entries(extension.configuration).filter(([key]) => Object.hasOwn(settings, key)),
      );
      extension.state = wasEnabled ? "validated" : "discovered";
      extension.error = undefined;
      try {
        this.prepare(extension);
        await this.storage.replace(id, validated, developmentPath);
      } catch (error) {
        this.release(id);
        Object.assign(extension, restore);
        this.prepare(extension);
        throw error;
      }
      this.log(id, "info", `updated ${previous} -> ${validated.manifest.version}`);
      this.changed();
      if (
        wasEnabled &&
        (validated.manifest.activationEvents.includes("onStartup") ||
          (this.core.database() && validated.manifest.activationEvents.includes("onDatabaseOpen")))
      )
        await this.activate(id);
    });
  }
  reloadExtension(id: string, archive?: ExtensionArchive) {
    return this.serial(async () => {
      const extension = this.registry.get(id);
      if (archive) {
        const validated = validateArchive(archive);
        if (validated.manifest.id !== id)
          throw new ExtensionError(
            "ManifestValidationError",
            "Development reload cannot change ID",
          );
        if (JSON.stringify(validated.manifest) !== JSON.stringify(extension.archive.manifest))
          throw new ExtensionError(
            "ManifestValidationError",
            "Manifest changed: reinstall to review permissions and contributions",
          );
        extension.archive = validated;
      }
      await this.stop(id);
      if (extension.enabled) await this.activate(id);
    });
  }
  setConfiguration(id: string, values: Record<string, Json>) {
    return this.serial(async () => {
      const extension = this.registry.get(id);
      this.configuration.validate(extension, values);
      await this.storage.update(id, extension.enabled, extension.grants, values);
      extension.configuration = structuredClone(values);
      this.changed();
      if (extension.state === "activated")
        this.runtime.event(id, "configurationChanged", { keys: Object.keys(values) });
    });
  }
  revealView(viewId: string) {
    const owner = this.views.owner(viewId);
    if (!owner) throw new ExtensionError("ViewNotFoundError", viewId);
    const event = `onView:${viewId}`;
    return Promise.allSettled(
      this.registry
        .list()
        .filter((e) => e.enabled && e.archive.manifest.activationEvents.includes(event as never))
        .map((e) => this.activate(e.archive.manifest.id)),
    ).then(() => undefined);
  }
}
