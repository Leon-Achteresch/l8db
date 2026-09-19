import { KeyRoundIcon, LinkIcon, ShieldCheckIcon } from "lucide-react";

export function constraintTypeColor(type: string) {
  switch (type) {
    case "PRIMARY KEY":
      return "text-amber-500";
    case "UNIQUE":
      return "text-blue-500";
    case "FOREIGN KEY":
      return "text-violet-500";
    case "CHECK":
      return "text-emerald-500";
    case "EXCLUDE":
      return "text-orange-500";
    default:
      return "text-muted-foreground";
  }
}

export function ConstraintTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "PRIMARY KEY":
      return <KeyRoundIcon className="size-4 text-amber-500" />;
    case "FOREIGN KEY":
      return <LinkIcon className="size-4 text-violet-500" />;
    case "UNIQUE":
      return <ShieldCheckIcon className="size-4 text-blue-500" />;
    default:
      return <ShieldCheckIcon className="size-4 text-emerald-500" />;
  }
}
