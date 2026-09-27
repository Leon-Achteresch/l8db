import { useEffect, useState } from "react";

export function useBrandSvg(name: string): string | null {
  const [loaded, setLoaded] = useState<{ name: string; svg: string | null } | null>(null);
  useEffect(() => {
    let current = true;
    void import("./brand-icons")
      .then(({ brandSvgForName }) => {
        if (current) setLoaded({ name, svg: brandSvgForName(name) });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [name]);
  return loaded?.name === name ? loaded.svg : null;
}
