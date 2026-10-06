import { useEffect, useState } from "react";

export function useFieldDragActive(mime: string): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const start = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes(mime)) setActive(true);
    };
    const stop = () => setActive(false);
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", stop);
      window.removeEventListener("drop", stop);
    };
  }, [mime]);
  return active;
}
