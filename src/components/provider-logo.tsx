import { Database } from "lucide-react";
import { useEffect, useState } from "react";
import type { DatabaseKind } from "@/lib/db";
import { cn } from "@/lib/utils";
import { thesvgSvgForSlug } from "./provider-logo/icons";
import { KIND_SLUG, PROVIDER_SLUG } from "./provider-logo/slugs";
import { ThesvgIcon } from "./provider-logo/thesvg-icon";

export { ThesvgIcon } from "./provider-logo/thesvg-icon";

interface ProviderLogoProps {
  providerId?: string | null;
  kind?: DatabaseKind | null;
  className?: string;
}

export function ProviderLogo({ providerId, kind, className }: ProviderLogoProps) {
  const slug =
    (providerId ? PROVIDER_SLUG[providerId] : undefined) ?? (kind ? KIND_SLUG[kind] : null) ?? null;
  const [loaded, setLoaded] = useState<{ slug: string; svg: string | null } | null>(null);
  useEffect(() => {
    if (!slug) return;
    let current = true;
    void thesvgSvgForSlug(slug)
      .then((svg) => {
        if (current) setLoaded({ slug, svg });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [slug]);
  const svg = loaded?.slug === slug ? loaded.svg : null;
  if (!svg) return <Database className={cn("size-4 shrink-0", className)} aria-hidden />;
  return <ThesvgIcon svg={svg} className={className} />;
}
