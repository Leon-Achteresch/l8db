import { Ban, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolResultStatus } from "./shared";

export function StatusIcon({ status, reduce }: { status: ToolResultStatus; reduce: boolean }) {
  if (status === "running") {
    return <LoaderCircle className={cn("size-3", !reduce && "animate-spin")} />;
  }
  if (status === "success") return <CircleCheck className="size-3" />;
  if (status === "error") return <CircleX className="size-3" />;
  return <Ban className="size-3" />;
}
