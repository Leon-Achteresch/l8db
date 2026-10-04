import { PROVIDER_SLUG } from "@/components/provider-logo/slugs";
import type { DatabaseKind, ProviderInfo } from "@/lib/db";
import type { DriverSummary } from "@/lib/drivers";

export interface DriverVariantProps {
  summaries: DriverSummary[];
  installing: DatabaseKind | null;
  onInstall: (kind: DatabaseKind) => void;
  onRecheck: (kind: DatabaseKind) => void;
}

export function distinctLogos(providers: ProviderInfo[]): ProviderInfo[] {
  const seen = new Set<string>();
  return providers.filter((provider) => {
    const key = PROVIDER_SLUG[provider.id] ?? provider.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function missingFirst(summaries: DriverSummary[]): DriverSummary[] {
  return [...summaries].sort((a, b) => Number(a.status.available) - Number(b.status.available));
}
