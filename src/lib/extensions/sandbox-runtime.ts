import type { ExtensionDescriptor, ExtensionRuntime, Json, RpcHandler } from "./contracts";
import bootstrap from "./worker-bootstrap.js?raw";

interface Sandbox {
  frame: HTMLIFrameElement;
  port: MessagePort;
  requests: Map<
    number,
    {
      resolve(value: Json | void): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  failure(error: Error): void;
  sequence: number;
}
export class SandboxRuntime implements ExtensionRuntime {
  private sandboxes = new Map<string, Sandbox>();
  constructor(private readonly timeout = 10000) {}
  async load(extension: ExtensionDescriptor, rpc: RpcHandler, failure: (error: Error) => void) {
    const id = extension.archive.manifest.id;
    await this.unload(id);
    const frame = document.createElement("iframe");
    frame.sandbox.add("allow-scripts");
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    const channel = new MessageChannel();
    const sandbox: Sandbox = {
      frame,
      port: channel.port1,
      requests: new Map(),
      failure,
      sequence: 0,
    };
    this.sandboxes.set(id, sandbox);
    let count = 0;
    let windowStart = Date.now();
    sandbox.port.onmessage = ({ data: message }) => {
      if (this.sandboxes.get(id) !== sandbox) return;
      if (Date.now() - windowStart > 1000) {
        count = 0;
        windowStart = Date.now();
      }
      if (++count > 500) {
        failure(new Error("Extension exceeded RPC rate limit"));
        return;
      }
      if (!message || typeof message !== "object") return;
      if (message.type === "crash") {
        failure(new Error(String(message.error)));
        return;
      }
      if (message.type === "result") {
        const request = sandbox.requests.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        sandbox.requests.delete(message.id);
        if (message.error) request.reject(new Error(String(message.error)));
        else request.resolve(message.value);
      }
      if (
        message.type === "rpc" &&
        Number.isSafeInteger(message.id) &&
        typeof message.method === "string"
      ) {
        void rpc(message.method, message.args).then(
          (value) => {
            if (this.sandboxes.get(id) === sandbox)
              sandbox.port.postMessage({ type: "rpc-result", id: message.id, value });
          },
          (error) => {
            if (this.sandboxes.get(id) === sandbox)
              sandbox.port.postMessage({
                type: "rpc-result",
                id: message.id,
                error: String(error),
              });
          },
        );
      }
    };
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Extension sandbox startup timed out")),
        this.timeout,
      );
      frame.onload = () => {
        clearTimeout(timer);
        frame.contentWindow!.postMessage({ bootstrap }, "*", [channel.port2]);
        resolve();
      };
    });
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; child-src 'none'; frame-src 'none'"><script>
      addEventListener('message', function initialize(event) {
        if (event.source !== parent || !event.ports[0]) return;
        removeEventListener('message', initialize);
        const port = event.ports[0];
        const url = URL.createObjectURL(new Blob([event.data.bootstrap], {type:'text/javascript'}));
        let worker;
        try { worker = new Worker(url); } catch(error) { port.postMessage({type:'crash', error:String(error)}); return; }
        worker.onmessage = event => port.postMessage(event.data);
        worker.onerror = event => port.postMessage({type:'crash', error:event.message});
        port.onmessage = event => {
          if (event.data.type === 'terminate') { worker.terminate(); URL.revokeObjectURL(url); port.close(); }
          else worker.postMessage(event.data);
        };
        port.start();
        addEventListener('pagehide', () => worker.terminate());
      });
    </script>`;
    document.body.append(frame);
    try {
      await loaded;
      await this.request(id, "load", {
        code: extension.archive.files[extension.archive.manifest.main],
        context: {
          extensionId: id,
          extensionPath: `extension://${id}/`,
          storagePath: `extension-storage://${id}/`,
        },
      });
    } catch (error) {
      await this.unload(id);
      throw error;
    }
  }
  private request(
    id: string,
    method: string,
    data: Record<string, unknown> = {},
  ): Promise<Json | void> {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) return Promise.reject(new Error(`Extension runtime unavailable: ${id}`));
    const requestId = ++sandbox.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sandbox.requests.delete(requestId);
        const error = new Error(`Extension ${method} timed out`);
        reject(error);
        sandbox.failure(error);
      }, this.timeout);
      sandbox.requests.set(requestId, { resolve, reject, timer });
      try {
        sandbox.port.postMessage({ type: "request", id: requestId, method, ...data });
      } catch (error) {
        clearTimeout(timer);
        sandbox.requests.delete(requestId);
        reject(error);
      }
    });
  }
  async activate(id: string) {
    await this.request(id, "activate");
  }
  async deactivate(id: string) {
    await this.request(id, "deactivate");
  }
  execute(id: string, command: string, payload?: Json) {
    return this.request(id, "execute", { command, payload });
  }
  event(id: string, name: string, payload: Json) {
    this.sandboxes.get(id)?.port.postMessage({ type: "event", name, payload });
  }
  async unload(id: string) {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) return;
    this.sandboxes.delete(id);
    sandbox.port.postMessage({ type: "terminate" });
    for (const request of sandbox.requests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Extension runtime stopped"));
    }
    sandbox.requests.clear();
    await new Promise((resolve) => setTimeout(resolve, 0));
    sandbox.port.close();
    sandbox.frame.remove();
  }
}
