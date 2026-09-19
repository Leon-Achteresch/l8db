export function installDebuggerMock() {
  const target = window as unknown as {
    __TAURI_INTERNALS__: {
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    debugCalls: { command: string; args?: Record<string, unknown> }[];
    debugAvailable: boolean;
    debugFailure: boolean;
  };
  const previous = target.__TAURI_INTERNALS__?.invoke;
  target.debugCalls = [];
  target.debugAvailable = true;
  target.debugFailure = false;
  let state: Record<string, unknown> | undefined;
  let line = 4;
  const source =
    "DECLARE\n  value integer := 4;\nBEGIN\n  value := value + 1;\n  value := value * 2;\n  RETURN value;\nEND;";
  target.__TAURI_INTERNALS__ = {
    ...target.__TAURI_INTERNALS__,
    invoke: async (command, args) => {
      if (command.startsWith("debug_")) target.debugCalls.push({ command, args });
      switch (command) {
        case "get_function_definition":
          return `CREATE FUNCTION public.debug_sample() RETURNS integer AS $$${source}$$ LANGUAGE plpgsql;`;
        case "debug_availability":
          return {
            available: target.debugAvailable,
            engine: "pldebugger",
            stepOut: false,
            message: target.debugAvailable
              ? "PL/pgSQL-Debugger verfügbar."
              : "Die Server-Erweiterung pldbgapi fehlt.",
          };
        case "debug_launch": {
          if (target.debugFailure) throw new Error("Debug-Rechte fehlen");
          const request = args?.request as { id: string };
          line = 4;
          state = {
            id: request.id,
            status: "paused",
            message: null,
            selectedFrame: 0,
            source,
            frames: [{ id: 0, oid: "10000", name: "public.debug_sample", line }],
            variables: [{ name: "value", value: "4", datatype: "integer" }],
          };
          return { ...state, status: "starting" };
        }
        case "debug_snapshot":
          return state;
        case "debug_action": {
          const action = args?.action as { type: string };
          if (["step_into", "step_over", "continue"].includes(action.type)) line++;
          state = {
            ...state,
            status: line > 6 ? "finished" : "paused",
            frames: [{ id: 0, oid: "10000", name: "public.debug_sample", line }],
            variables: [{ name: "value", value: line > 4 ? "5" : "4", datatype: "integer" }],
          };
          return null;
        }
        case "debug_stop":
          state = undefined;
          return null;
        default:
          return previous ? previous(command, args) : [];
      }
    },
  };
}
