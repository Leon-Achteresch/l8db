import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SqlEditor } from "../../src/features/table/sql-editor";
import "../../src/index.css";

function SqlEditorFixture() {
  const [value, setValue] = useState("select id from users");
  const [submits, setSubmits] = useState(0);
  const [readOnly, setReadOnly] = useState(false);
  return (
    <main>
      <button type="button" onClick={() => setValue("select 1")}>
        Extern ändern
      </button>
      <button type="button" onClick={() => setReadOnly((current) => !current)}>
        Schreibschutz
      </button>
      <output aria-label="Editorwert">{value}</output>
      <output aria-label="Ausführungen">{submits}</output>
      <SqlEditor
        value={value}
        onChange={setValue}
        onSubmit={() => setSubmits((current) => current + 1)}
        columns={["id", "name", "full name"]}
        placeholder="SQL eingeben"
        readOnly={readOnly}
        className="h-56 w-[600px]"
      />
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<SqlEditorFixture />);
