import { assertCompatible, validateArchive } from "../../../packages/extension-api/src/manifest";
import type { ExtensionDescriptor, ExtensionRuntime, RpcHandler } from "./contracts";
export class ExtensionLoader {
  constructor(
    private readonly runtime: ExtensionRuntime,
    private readonly version: string,
  ) {}
  validate(extension: ExtensionDescriptor) {
    extension.archive = validateArchive(extension.archive);
    assertCompatible(extension.archive.manifest, this.version);
    extension.state = "validated";
  }
  async load(extension: ExtensionDescriptor, rpc: RpcHandler, failure: (error: Error) => void) {
    this.validate(extension);
    await this.runtime.load(extension, rpc, failure);
    extension.state = "loaded";
  }
}
