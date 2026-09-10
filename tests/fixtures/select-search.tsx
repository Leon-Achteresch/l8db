import { createRoot } from "react-dom/client";
import {
  CenterMorphModal,
  CenterMorphModalContent,
  CenterMorphModalTrigger,
} from "../../src/components/motion/center-morph-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../src/components/ui/select";
import "../../src/index.css";

const params = new URLSearchParams(location.search);
const items = [
  "ECO_TEST",
  "LOBERON",
  "LOBERON_TEST",
  ...Array.from({ length: 12 }, (_, i) => `DB_${i}`),
];

function App() {
  return (
    <CenterMorphModal>
      <CenterMorphModalTrigger>
        <button type="button">Vergleich einrichten</button>
      </CenterMorphModalTrigger>
      <CenterMorphModalContent ariaLabel="Vergleich einrichten" className="max-w-xl">
        <div className="grid grid-cols-2 gap-3 p-5 pt-12">
          <div>Quelle</div>
          <Select defaultValue={params.has("selected") ? items[0] : undefined}>
            <SelectTrigger className="w-full" aria-label="Zielverbindung">
              <SelectValue placeholder="Verbindung wählen" />
            </SelectTrigger>
            <SelectContent searchable>
              {items.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
