import { useNavigate } from "@tanstack/react-router";
import { usePaneTabTarget } from "@/lib/pane-tab-target";
import type { PackagePart } from "@/lib/plsql";
import { useTableTabs } from "@/lib/table-tabs";

export function usePackageNavigate(schema: string, name: string) {
  const navigate = useNavigate();
  const openPackageTab = useTableTabs((state) => state.openPackageTab);
  const target = usePaneTabTarget();
  return (part?: PackagePart, member?: string) => {
    if (target) {
      target.open({ kind: "package", schema, name });
      return;
    }
    openPackageTab({ schema, name });
    void navigate({
      to: "/packages/$schema/$name",
      params: { schema, name },
      search: { part, member },
    });
  };
}
