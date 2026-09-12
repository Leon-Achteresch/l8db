import { cn } from "@/lib/utils";

export function WorkflowNavigation({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string; description: string; count?: number }[];
}) {
  return (
    <nav aria-label="Arbeitsbereiche" className="flex shrink-0 border-b bg-card">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-current={value === item.value ? "step" : undefined}
          onClick={() => onChange(item.value)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 border-b-2 px-5 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring",
            value === item.value
              ? "border-primary bg-primary/5"
              : "border-transparent text-muted-foreground",
          )}
        >
          <span>
            <span className="block text-sm font-semibold">
              {item.label}
              {item.count !== undefined && (
                <span className="ml-2 font-normal text-muted-foreground">{item.count}</span>
              )}
            </span>
            <span className="hidden text-xs text-muted-foreground md:block">
              {item.description}
            </span>
          </span>
        </button>
      ))}
    </nav>
  );
}
