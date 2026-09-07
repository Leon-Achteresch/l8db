(() => {
  const send = self.postMessage.bind(self);
  const pending = new Map();
  const handlers = new Map();
  const listeners = new Map();
  const webviewListeners = new Map();
  const configListeners = new Set();
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
  const subscribeWebview = (panelId, listener) => {
    let callbacks = webviewListeners.get(panelId);
    if (!callbacks) {
      callbacks = new Set();
      webviewListeners.set(panelId, callbacks);
      tracked(rpc("panels.onMessage", panelId));
    }
    callbacks.add(listener);
    let disposed = false;
    const disposable = {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        callbacks.delete(listener);
        if (!callbacks.size) {
          webviewListeners.delete(panelId);
          tracked(rpc("dispose", `webview:${panelId}`));
        }
      },
    };
    context.subscriptions.push(disposable);
    return disposable;
  };
  const notify = (level, message, actions) => rpc("notifications.show", level, message, actions ?? []);
  self.onmessage = async ({ data: message }) => {
    if (message.type === "rpc-result") {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(message.error));
      else request?.resolve(message.value);
      return;
    }
    if (message.type === "event") {
      if (message.name === "configurationChanged") {
        for (const listener of [...configListeners]) {
          try {
            Promise.resolve(listener(message.payload)).catch((error) => log("error", error));
          } catch (error) {
            log("error", error);
          }
        }
        return;
      }
      if (message.name.startsWith("webview:message:")) {
        const panelId = message.name.slice("webview:message:".length);
        for (const listener of webviewListeners.get(panelId) ?? []) {
          try {
            Promise.resolve(listener(message.payload)).catch((error) => log("error", error));
          } catch (error) {
            log("error", error);
          }
        }
        return;
      }
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
          version: "1.1.0",
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
            getCommands: () => rpc("commands.list"),
          },
          events: {
            onDatabaseOpened: (listener) => subscribe("databaseOpened", listener),
            onDatabaseClosed: (listener) => subscribe("databaseClosed", listener),
            onActiveDatabaseChanged: (listener) => subscribe("activeDatabaseChanged", listener),
          },
          notifications: {
            showInfo: (message, ...actions) => notify("info", message, actions),
            showWarning: (message, ...actions) => notify("warn", message, actions),
            showError: (message, ...actions) => notify("error", message, actions),
          },
          configuration: {
            get: (key) => rpc("configuration.get", key),
            onDidChange: (listener) => {
              if (typeof listener !== "function") throw new Error("Listener must be a function");
              if (!configListeners.size) tracked(rpc("configuration.onDidChange"));
              configListeners.add(listener);
              let disposed = false;
              const disposable = {
                dispose: () => {
                  if (disposed) return;
                  disposed = true;
                  configListeners.delete(listener);
                },
              };
              context.subscriptions.push(disposable);
              return disposable;
            },
          },
          database: {
            getActive: () => rpc("database.active"),
            query: (sql, params) => rpc("database.query", sql, params ?? null),
          },
          network: { fetch: (url, options) => rpc("network.fetch", url, options ?? null) },
          secrets: {
            get: (key) => rpc("secrets.get", key),
            set: (key, value) => rpc("secrets.set", key, value),
            delete: (key) => rpc("secrets.delete", key),
          },
          clipboard: {
            readText: () => rpc("clipboard.read"),
            writeText: (value) => rpc("clipboard.write", value),
          },
          workspace: {
            showOpenDialog: (title) => rpc("workspace.showOpenDialog", title ?? null),
            showSaveDialog: (filename) => rpc("workspace.showSaveDialog", filename ?? null),
            readTextFile: (path) => rpc("workspace.readFile", path),
            writeTextFile: (path, contents) => rpc("workspace.writeFile", path, contents),
          },
          process: { run: (command, options) => rpc("process.run", command, options ?? null) },
          window: {
            showQuickPick: (items, options) => rpc("window.showQuickPick", items, options ?? null),
            showInputBox: (options) => rpc("window.showInputBox", options ?? null),
            showInformationMessage: (message, ...actions) =>
              rpc("window.showMessage", "info", message, actions),
            showWarningMessage: (message, ...actions) =>
              rpc("window.showMessage", "warning", message, actions),
            showErrorMessage: (message, ...actions) =>
              rpc("window.showMessage", "error", message, actions),
          },
          views: {
            setTreeData: (viewId, items) => rpc("views.setTree", viewId, items),
            reveal: (viewId) => rpc("views.reveal", viewId),
          },
          statusBar: {
            set: (itemId, update) => rpc("statusBar.set", itemId, update),
            hide: (itemId) => rpc("statusBar.hide", itemId),
          },
          panels: {
            open: (panelId, html) => rpc("panels.open", panelId, html ?? ""),
            close: (panelId) => rpc("panels.close", panelId),
            postMessage: (panelId, msg) => rpc("panels.postMessage", panelId, msg ?? null),
            onDidReceiveMessage: (panelId, listener) => subscribeWebview(panelId, listener),
          },
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
          webviewListeners.clear();
          configListeners.clear();
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
