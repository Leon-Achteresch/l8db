import { useNavigate } from "@tanstack/react-router";
import type { PackagePart } from "@/lib/plsql";
import { useTableTabs } from "@/lib/table-tabs";

export function usePackageNavigate(schema: string, name: string) {
  const navigate = useNavigate();
  const openPackageTab = useTableTabs((state) => state.openPackageTab);
  return (part?: PackagePart, member?: string) => {
    openPackageTab({ schema, name });
    void navigate({
      to: "/packages/$schema/$name",
      params: { schema, name },
      search: { part, member },
    });
  };
}
