import { useEffect, useState } from "react";
import { brandSvgForName } from "./brand-icons";

export function useBrandSvg(name: string): string | null {
  const [loaded, setLoaded] = useState<{ name: string; svg: string | null } | null>(null);
  useEffect(() => {
    let current = true;
    void brandSvgForName(name)
      .then((svg) => {
        if (current) setLoaded({ name, svg });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [name]);
  return loaded?.name === name ? loaded.svg : null;
}
