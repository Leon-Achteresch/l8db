import { ArrowRightIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WidgetBlock } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { useDashboardInteraction } from "../dashboard-interaction";
import { openBlockUrl } from "./open-block-url";

export function LinkBlock({ block }: { block: WidgetBlock }) {
  const interaction = useDashboardInteraction();
  const external = !block.page && Boolean(block.href);
  return (
    <div
      className={cn(
        "flex h-full items-center",
        block.align === "center" && "justify-center",
        block.align === "right" && "justify-end",
      )}
    >
      <Button
        className="dashboard-block-link max-w-full"
        variant={
          block.variant === "plain" ? "ghost" : block.variant === "card" ? "outline" : "default"
        }
        disabled={!block.page && !block.href}
        onClick={() => {
          if (block.page) interaction?.goToPage(block.page);
          else openBlockUrl(block.href);
        }}
      >
        <span className="truncate">{block.text || "Button"}</span>
        {external ? <ExternalLinkIcon /> : <ArrowRightIcon />}
      </Button>
    </div>
  );
}
