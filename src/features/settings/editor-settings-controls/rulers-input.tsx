import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatRulers, parseRulersInput } from "@/lib/editor-options";
import { Row } from "./row";
import type { Store } from "./types";

export function RulersInput({ store, compact }: { store: Store; compact: boolean }) {
  const [text, setText] = useState(() => formatRulers(store.editorRulers));
  useEffect(() => {
    setText(formatRulers(store.editorRulers));
  }, [store.editorRulers]);
  return (
    <Row
      title="Lineale"
      description="Vertikale Hilfslinien bei Spalten, z. B. 80, 120. Leer lassen zum Deaktivieren."
      compact={compact}
    >
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => store.setEditorRulers(parseRulersInput(text))}
        onKeyDown={(event) => {
          if (event.key === "Enter") store.setEditorRulers(parseRulersInput(text));
        }}
        placeholder="80, 120"
        aria-label="Editor-Lineale"
        className="h-8 w-28 font-mono text-xs"
      />
    </Row>
  );
}
