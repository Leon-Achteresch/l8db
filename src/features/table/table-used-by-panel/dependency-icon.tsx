import { BracesIcon, EyeIcon, TableIcon, ZapIcon } from "lucide-react";

export function DependencyIcon({ objectType }: { objectType: string }) {
  const type = objectType.toLowerCase();
  if (type.includes("view")) return <EyeIcon className="size-4 text-blue-500" />;
  if (type.includes("trigger")) return <ZapIcon className="size-4 text-amber-500" />;
  if (type.includes("table")) return <TableIcon className="size-4 text-muted-foreground" />;
  return <BracesIcon className="size-4 text-violet-500" />;
}
