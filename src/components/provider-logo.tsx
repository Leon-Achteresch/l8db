import { Database } from "lucide-react";
import type { DatabaseKind } from "@/lib/db";
import { cn } from "@/lib/utils";
import { thesvgSvgForSlug } from "./provider-logo/icons";
import { KIND_SLUG, PROVIDER_SLUG } from "./provider-logo/slugs";
import { ThesvgIcon } from "./provider-logo/thesvg-icon";

export { thesvgSvgForSlug } from "./provider-logo/icons";
export { ThesvgIcon } from "./provider-logo/thesvg-icon";

interface ProviderLogoProps {
  providerId?: string | null;
  kind?: DatabaseKind | null;
  className?: string;
}

export function ProviderLogo({ providerId, kind, className }: ProviderLogoProps) {
  const slug =
    (providerId ? PROVIDER_SLUG[providerId] : undefined) ?? (kind ? KIND_SLUG[kind] : null) ?? null;
  const svg = thesvgSvgForSlug(slug);
  if (!svg) return <Database className={cn("size-4 shrink-0", className)} aria-hidden />;
  return <ThesvgIcon svg={svg} className={className} />;
}
