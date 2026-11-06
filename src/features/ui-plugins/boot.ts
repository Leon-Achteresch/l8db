import { startUiPluginHost } from "@/lib/ui-plugins/host";
import { UI_PLUGIN_MODULES } from "./sdk-modules";

export function bootUiPlugins() {
  return startUiPluginHost(UI_PLUGIN_MODULES);
}
