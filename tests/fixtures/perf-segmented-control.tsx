import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SegmentedControl } from "../../src/components/motion/segmented-control";

const options = Array.from({ length: 10 }, (_, index) => ({
  value: String(index),
  label: `Option ${index}`,
}));
const durations: number[] = [];
Object.assign(window, { segmentDurations: durations });
document.addEventListener(
  "change",
  () => {
    const started = performance.now();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => durations.push(performance.now() - started)),
    );
  },
  true,
);

function App() {
  const [values, setValues] = useState(() =>
    Array.from({ length: 50 }, (_, index) => ({ id: `control-${index}`, value: "0" })),
  );
  return (
    <div className="flex flex-col gap-2 p-2">
      {values.map((item, index) => (
        <SegmentedControl
          key={item.id}
          value={item.value}
          onChange={(next) =>
            setValues((previous) =>
              previous.map((entry, position) =>
                position === index ? { ...entry, value: next } : entry,
              ),
            )
          }
          label={`Control ${index}`}
          options={options}
        />
      ))}
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<App />);
