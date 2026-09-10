import type { ExtensionContext, L8dbApi } from "@l8db/extension-api";
export function activate(context: ExtensionContext, api: L8dbApi) {
  context.subscriptions.push(api.commands.registerCommand("hello.greet", async () => {
    if (await api.configuration.get<boolean>("hello.enabled")) await api.notifications.showInfo("Hello l8db");
  }));
  context.subscriptions.push(api.events.onDatabaseOpened(database => {
    api.logger.info(`Database opened: ${database.name}`);
  }));
  api.logger.info("Hello extension activated");
}
export function deactivate() {}
