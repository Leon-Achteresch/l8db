import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { brandSvgForName } from "./named-logo/brand-icons";
import { SystemIconForName } from "./named-logo/system-icon-for-name";
import { ThesvgIcon } from "./provider-logo/thesvg-icon";

export { DatabaseLogo } from "./named-logo/database-logo";

export function SchemaLogo({ name, className }: { name: string; className?: string }) {
  const svg = brandSvgForName(name);
  if (svg) return <ThesvgIcon svg={svg} className={className} />;
  const system = SystemIconForName({ name, className });
  if (system) return system;
  return <Layers className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-hidden />;
}
