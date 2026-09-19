import { Database } from "lucide-react";
import type { DatabaseKind } from "@/lib/db";
import { cn } from "@/lib/utils";
import { ProviderLogo } from "../provider-logo";
import { ThesvgIcon } from "../provider-logo/thesvg-icon";
import { brandSvgForName } from "./brand-icons";
import { SystemIconForName } from "./system-icon-for-name";

export function DatabaseLogo({
  name,
  kind,
  providerId,
  className,
}: {
  name: string;
  kind?: DatabaseKind | null;
  providerId?: string | null;
  className?: string;
}) {
  const svg = brandSvgForName(name);
  if (svg) return <ThesvgIcon svg={svg} className={className} />;
  const system = SystemIconForName({ name, className });
  if (system) return system;
  if (providerId || kind)
    return <ProviderLogo providerId={providerId} kind={kind} className={className} />;
  return (
    <Database className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-hidden />
  );
}
