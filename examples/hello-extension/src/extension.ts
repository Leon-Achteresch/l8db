import type { ExtensionContext, L8dbApi } from "@l8db/extension-api";
export function activate(context: ExtensionContext, api: L8dbApi) {
  context.subscriptions.push(api.commands.registerCommand("hello.greet", async () => {
    if (await api.configuration.get<boolean>("hello.enabled")) await api.notifications.showInfo("Hello l8db");
  }));
  context.subscriptions.push(api.commands.registerCommand("hello.inspect", async () => {
    const active = await api.database.getActive();
    if (!active) {
      await api.notifications.showWarning("Keine Datenbank ausgewählt");
      return;
    }
    const result = await api.database.query("SELECT 1 AS value");
    await api.views.setTreeData("hello.overview", [{
      id: "database",
      label: active.name,
      description: active.kind,
      children: result.rows.map((row, index) => ({ id: `row-${index}`, label: JSON.stringify(row) })),
    }]);
    await api.statusBar.set("hello.status", { text: `${active.name}: ${result.rows.length} Zeilen` });
  }));
  context.subscriptions.push(api.events.onDatabaseOpened(async database => {
    api.logger.info(`Database opened: ${database.name}`);
    await api.statusBar.set("hello.status", { text: database.name });
  }));
  context.subscriptions.push(api.events.onDatabaseClosed(async () => {
    await api.statusBar.hide("hello.status");
  }));
  context.subscriptions.push(api.configuration.onDidChange(event => {
    api.logger.info(`Configuration changed: ${event.keys.join(", ")}`);
  }));
  api.logger.info("Hello extension activated");
}
export function deactivate() {}
