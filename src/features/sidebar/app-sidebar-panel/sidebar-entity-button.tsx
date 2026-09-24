import { Link } from "@tanstack/react-router";
import { EyeIcon, TableIcon } from "lucide-react";
import type { ComponentProps, MouseEvent } from "react";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { InvalidMarker } from "@/features/sidebar/invalid-marker";
import { useRouteActive } from "@/lib/hooks/use-route-active";

export function SidebarEntityButton({
  entity,
  schema,
  name,
  first,
  invalid,
  onOpenView,
  onClick,
  ...props
}: ComponentProps<"button"> & {
  entity: "table" | "view";
  schema: string;
  name: string;
  first: boolean;
  invalid: boolean;
  onOpenView: () => void;
}) {
  const isActive = useRouteActive(
    entity === "view"
      ? "/_app/_workspace/view-editor/$schema/$view"
      : "/_app/_workspace/tables/$schema/$table",
    entity === "view" ? { schema, view: name } : { schema, table: name },
  );

  if (entity === "view") {
    return (
      <SidebarMenuButton
        {...props}
        isActive={isActive}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          onClick?.(event);
          onOpenView();
        }}
      >
        <EyeIcon className="text-muted-foreground" />
        <span className="truncate">{name}</span>
        {invalid ? <InvalidMarker /> : null}
      </SidebarMenuButton>
    );
  }

  return (
    <SidebarMenuButton {...props} onClick={onClick} asChild isActive={isActive}>
      <Link
        to="/tables/$schema/$table"
        params={{ schema, table: name }}
        search={{ type: entity }}
        data-tour={first ? "sidebar-table" : undefined}
        data-schema={schema}
        data-name={name}
      >
        <TableIcon className="text-muted-foreground" />
        <span className="truncate">{name}</span>
      </Link>
    </SidebarMenuButton>
  );
}
