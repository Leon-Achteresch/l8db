import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { CellValueDialog } from "@/features/table/cell-value-dialog";
import { BINARY_UTF8_MAX_BYTES, bytesToHexLiteral } from "@/lib/value-viewers/binary";
import "@/index.css";

const text = "\uFEFFGrüße 東京 🧪\n<b>Nur Text</b>";
const source = bytesToHexLiteral(new TextEncoder().encode(text));

function fixtureValue(kind: string): string {
  switch (kind) {
    case "invalid":
      return "\\xe282";
    case "empty":
      return "\\x";
    case "limit":
      return `\\x${"61".repeat(BINARY_UTF8_MAX_BYTES + 1)}`;
    default:
      return source;
  }
}

function BinaryFixture() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(source);
  useEffect(() => {
    const change = (event: Event) => setValue(fixtureValue((event as CustomEvent<string>).detail));
    window.addEventListener("binary-fixture", change);
    return () => window.removeEventListener("binary-fixture", change);
  }, []);
  return (
    <main className="p-3">
      <Button type="button" onClick={() => setOpen(true)}>
        Binärwert öffnen
      </Button>
      {open && (
        <CellValueDialog
          columnName="inhalt"
          value={value}
          dataType="bytea"
          canEdit={false}
          isSaving={false}
          onClose={() => setOpen(false)}
          onSave={async () => {
            throw Error("Unexpected fixture save");
          }}
        />
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <ThemeProvider attribute="class" defaultTheme="system">
      <BinaryFixture />
    </ThemeProvider>,
  );
