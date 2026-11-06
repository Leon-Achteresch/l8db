import { createRoot } from "react-dom/client";
import { CommandPalette } from "../../src/components/motion/command-palette";
import "../../src/index.css";

const items = Array.from({ length: 40 }, (_, i) => ({
  id: `item-${i}`,
  label: i % 2 ? `orders_${i}` : `customers_${i}`,
  group: i < 20 ? "Tabellen" : "Befehle",
  onSelect: () => {
    document.body.dataset.selected = `item-${i}`;
  },
}));

const root = document.getElementById("root");
if (root) createRoot(root).render(<CommandPalette items={items} open onOpenChange={() => {}} />);
