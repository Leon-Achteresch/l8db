import { useConnectionEnvironment } from "@/lib/environments";
import { useFocusedConnection } from "@/lib/hooks/use-focused-connection";

export function EnvironmentBadge() {
  const environment = useConnectionEnvironment(useFocusedConnection());
  if (!environment) return null;
  return (
    <span
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium"
      style={{
        borderColor: environment.color,
        color: environment.color,
        backgroundColor: `${environment.color}1a`,
      }}
      role="status"
      aria-label={`Umgebung ${environment.label}`}
    >
      <span className="size-2 rounded-full" style={{ backgroundColor: environment.color }} />
      <span className="@max-[14rem]/header-search:sr-only">{environment.label}</span>
    </span>
  );
}
