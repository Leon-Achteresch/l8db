import { createRoot } from "react-dom/client";
import { JsonEditor } from "../../src/features/table/json-editor/json-editor";
import "../../src/index.css";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <JsonEditor
      columnName="payload"
      readOnly
      text={JSON.stringify({ "a/b": { "x~1": "Beispielwert" } })}
    />,
  );
