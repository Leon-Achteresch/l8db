import { useNavigate, useRouter } from "@tanstack/react-router";
import { type ComponentType, useContext, useEffect, useRef } from "react";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { WorkbenchContext } from "@/lib/workbench-context";
import { addWorkbenchTab, closeWorkbenchTab } from "@/lib/workbench-tabs";

type OpenProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function asWorkbenchTab<Props extends OpenProps>(
  Component: ComponentType<Props>,
  title: string | ((props: Props) => string),
  enabled: (props: Props) => boolean = () => true,
): ComponentType<Props> {
  return function WorkbenchLauncher(props: Props) {
    const connection = useActiveConnection();
    const database = useActiveDatabase();
    const navigate = useNavigate();
    const router = useRouter();
    const latest = useRef(props);
    latest.current = props;
    const launching = useRef(false);
    const host = useContext(WorkbenchContext);
    const useTab = !host && enabled(props);
    useEffect(() => {
      if (!props.open || !useTab) {
        launching.current = false;
        return;
      }
      if (launching.current) return;
      launching.current = true;
      const initial = latest.current;
      const id = crypto.randomUUID();
      const container = document.createElement("div");
      container.className = "flex h-full min-h-0 min-w-0 flex-1 flex-col";
      addWorkbenchTab({
        id,
        title: typeof title === "string" ? title : title(initial),
        connectionId: connection?.id ?? null,
        database,
        container,
        busy: false,
        returnTo: router.state.location.href,
        content: (
          <Component
            {...initial}
            open
            onOpenChange={(open) => {
              if (!open) closeWorkbenchTab(id);
            }}
          />
        ),
      });
      initial.onOpenChange(false);
      void navigate({ to: "/workbench", search: { compareId: id } });
    }, [props.open, useTab, connection?.id, database, navigate, router]);
    return useTab ? null : <Component {...props} />;
  };
}
