(() => {
  const send = self.postMessage.bind(self);
  const pending = new Map();
  const handlers = new Map();
  const listeners = new Map();
  const registration = new Set();
  let sequence = 0;
  let extension;
  let context;
  let api;
  let active = false;
  const rpc = (method, ...args) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      send({ type: "rpc", id, method, args });
    });
  const tracked = (promise) => {
    if (!active) registration.add(promise);
    promise.catch((error) => {
      if (active) log("error", error);
    });
    return promise;
  };
  const log = (level, message) => {
    void rpc("logger", level, String(message)).catch(() => undefined);
  };
  const subscribe = (event, listener) => {
    let callbacks = listeners.get(event);
    if (!callbacks) {
      callbacks = new Set();
      listeners.set(event, callbacks);
      tracked(rpc("events.on", event));
    }
    callbacks.add(listener);
    let disposed = false;
    const disposable = {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        callbacks.delete(listener);
        if (!callbacks.size) {
          listeners.delete(event);
          tracked(rpc("dispose", `event:${event}`));
        }
      },
    };
    context.subscriptions.push(disposable);
    return disposable;
  };
  self.onmessage = async ({ data: message }) => {
    if (message.type === "rpc-result") {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(message.error));
      else request?.resolve(message.value);
      return;
    }
    if (message.type === "event") {
      for (const listener of listeners.get(message.name) ?? []) {
        try {
          Promise.resolve(listener(message.payload)).catch((error) => log("error", error));
        } catch (error) {
          log("error", error);
        }
      }
      return;
    }
    if (message.type !== "request") return;
    try {
      let value;
      if (message.method === "load") {
        context = { ...message.context, subscriptions: [] };
        api = {
          version: "1.0.0",
          commands: {
            registerCommand: (id, handler) => {
              if (handlers.has(id)) throw new Error(`DuplicateCommandError: ${id}`);
              if (typeof handler !== "function")
                throw new Error("Command handler must be a function");
              handlers.set(id, handler);
              tracked(rpc("commands.register", id));
              let disposed = false;
              const disposable = {
                dispose: () => {
                  if (disposed) return;
                  disposed = true;
                  handlers.delete(id);
                  tracked(rpc("dispose", `command:${id}`));
                },
              };
              context.subscriptions.push(disposable);
              return disposable;
            },
            executeCommand: (id, payload) => rpc("commands.execute", id, payload ?? null),
          },
          events: {
            onDatabaseOpened: (listener) => subscribe("databaseOpened", listener),
            onDatabaseClosed: (listener) => subscribe("databaseClosed", listener),
          },
          notifications: { showInfo: (message) => rpc("notifications.info", message) },
          configuration: { get: (key) => rpc("configuration.get", key) },
          database: { getActive: () => rpc("database.active") },
          assets: { readText: (path) => rpc("assets.readText", path) },
          storage: {
            get: (key) => rpc("storage.get", key),
            set: (key, value) => rpc("storage.set", key, value),
          },
          logger: {
            info: (message) => log("info", message),
            warn: (message) => log("warn", message),
            error: (message) => log("error", message),
          },
        };
        const module = { exports: {} };
        new Function("module", "exports", message.code)(module, module.exports);
        extension = module.exports;
        if (typeof extension.activate !== "function")
          throw new Error("Entry point must export activate");
      } else if (message.method === "activate") {
        await extension.activate(context, api);
        while (registration.size) {
          const batch = [...registration];
          registration.clear();
          await Promise.all(batch);
        }
        active = true;
      } else if (message.method === "deactivate") {
        try {
          await extension?.deactivate?.();
        } finally {
          for (const resource of context.subscriptions.splice(0).reverse()) {
            try {
              resource.dispose();
            } catch (error) {
              log("error", error);
            }
          }
          handlers.clear();
          listeners.clear();
        }
      } else if (message.method === "execute") {
        const handler = handlers.get(message.command);
        if (!handler) throw new Error(`CommandNotFoundError: ${message.command}`);
        value = await handler(message.payload);
      } else throw new Error("Unknown runtime request");
      send({ type: "result", id: message.id, value });
    } catch (error) {
      send({ type: "result", id: message.id, error: String(error) });
    }
  };
  self.addEventListener("unhandledrejection", (event) => log("error", event.reason));
})();
