import { Markdown } from "@/components/markdown";
import { interpolateText, type WidgetBlock } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { useDashboardScope } from "../dashboard-scope";

export function TextBlock({ block }: { block: WidgetBlock }) {
  const scope = useDashboardScope();
  const text = interpolateText(block.text ?? "", scope.variables, scope.values);
  return (
    <div
      className={cn(
        "dashboard-block-text h-full overflow-auto",
        block.align === "center" && "text-center",
        block.align === "right" && "text-right",
      )}
    >
      <Markdown
        source={text}
        className="text-sm text-foreground [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-lg [&_p]:text-muted-foreground"
      />
    </div>
  );
}
