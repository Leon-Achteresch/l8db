import { uiPluginStatusReport } from "./status";
import { useUiPluginRuntime } from "./store";

export function waitForProposalStatus(file: string, signal?: AbortSignal) {
  return new Promise<ReturnType<typeof uiPluginStatusReport>["plugins"][number] | undefined>(
    (resolve) => {
      let quiet: ReturnType<typeof setTimeout>;
      const finish = () => {
        clearTimeout(quiet);
        clearTimeout(deadline);
        unsubscribe();
        signal?.removeEventListener("abort", finish);
        resolve(uiPluginStatusReport().plugins.find((plugin) => plugin.file === file));
      };
      const changed = () => {
        clearTimeout(quiet);
        quiet = setTimeout(finish, 250);
      };
      const unsubscribe = useUiPluginRuntime.subscribe(changed);
      const deadline = setTimeout(finish, 2000);
      signal?.addEventListener("abort", finish, { once: true });
      changed();
      if (signal?.aborted) finish();
    },
  );
}
