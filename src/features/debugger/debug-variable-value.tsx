import { useState } from "react";

interface DebugVariableValueProps {
  name: string;
  value: string | null;
  editable: boolean;
  oracle: boolean;
  onSubmit: (value: string) => void;
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

function editText(value: string | null, oracle: boolean): string {
  if (!oracle) return value ?? "";
  if (value === null) return "NULL";
  return NUMBER.test(value.trim()) ? value.trim() : `'${value.split("'").join("''")}'`;
}

export function DebugVariableValue({
  name,
  value,
  editable,
  oracle,
  onSubmit,
}: DebugVariableValueProps) {
  const [draft, setDraft] = useState<string>();
  const hint = oracle ? "PL/SQL-Ausdruck, z. B. 42, 'Text' oder NULL" : "Wert, z. B. 42 oder Text";
  if (draft !== undefined)
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) onSubmit(draft.trim());
          setDraft(undefined);
        }}
      >
        <input
          ref={(element) => element?.focus()}
          className="debug-value-input"
          aria-label={`Neuer Wert für ${name}`}
          placeholder={hint}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setDraft(undefined)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setDraft(undefined);
          }}
        />
      </form>
    );
  return (
    <button
      type="button"
      className="debug-value-button"
      disabled={!editable}
      title={editable ? `Wert ändern (${hint})` : undefined}
      onClick={() => setDraft(editText(value, oracle))}
    >
      {value ?? "NULL"}
    </button>
  );
}
