import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CsvMappingTable } from "../../src/features/import/csv-mapping-table";
import "../../src/index.css";

const headers = Array.from({ length: 120 }, (_, index) => `Spalte_${index}`);
const targets = headers.map((name) => ({
  name,
  data_type: "text",
  is_nullable: true,
  has_default: false,
  is_generated: false,
  is_identity: false,
}));

function App() {
  const [mappings, setMappings] = useState(
    headers.map((name, csvIndex) => ({
      csvIndex,
      target: csvIndex === 119 ? null : name,
    })),
  );
  return (
    <CsvMappingTable
      headers={headers}
      sampleRow={headers}
      targets={targets}
      mappings={mappings}
      onChange={(index, target) =>
        setMappings((current) => current.map((m) => (m.csvIndex === index ? { ...m, target } : m)))
      }
    />
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
