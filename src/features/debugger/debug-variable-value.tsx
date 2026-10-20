import { useState } from "react";

interface DebugVariableValueProps {
  name: string;
  value: string | null;
  editable: boolean;
  hint: string;
  onSubmit: (value: string) => void;
}

export function DebugVariableValue({
  name,
  value,
  editable,
  hint,
  onSubmit,
}: DebugVariableValueProps) {
  const [draft, setDraft] = useState<string>();
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
      onClick={() => setDraft(value ?? "")}
    >
      {value ?? "NULL"}
    </button>
  );
}
