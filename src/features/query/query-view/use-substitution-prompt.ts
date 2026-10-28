import { useCallback, useRef, useState } from "react";

import type { AskVariables } from "@/lib/sql-statements/sqlplus";

export function useSubstitutionPrompt() {
  const pending = useRef<((values: Record<string, string> | null) => void) | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const ask = useCallback<AskVariables>(
    (missing, defaults) =>
      new Promise((resolve) => {
        pending.current?.(null);
        pending.current = resolve;
        setValues(Object.fromEntries(missing.map((name) => [name, defaults[name] ?? ""])));
        setNames(missing);
      }),
    [],
  );

  const finish = useCallback((result: Record<string, string> | null) => {
    pending.current?.(result);
    pending.current = null;
    setNames(null);
  }, []);

  return {
    ask,
    dialog: {
      open: names !== null,
      names: names ?? [],
      values,
      onValuesChange: setValues,
      onConfirm: () => finish(values),
      onCancel: () => finish(null),
    },
  };
}

export type SubstitutionPrompt = ReturnType<typeof useSubstitutionPrompt>;
