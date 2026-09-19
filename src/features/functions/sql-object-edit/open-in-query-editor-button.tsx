import { useNavigate } from "@tanstack/react-router";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTableTabs } from "@/lib/table-tabs";

export function OpenInQueryEditorButton({ sql, title }: { sql: string; title: string }) {
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={!sql}
      onClick={() => {
        const id = openQueryTabWithSql(sql, title);
        void navigate({ to: "/query/$id", params: { id } });
      }}
      title="Öffnet den Quelltext als neuen SQL-Tab im Query-Editor."
    >
      <SquareArrowOutUpRightIcon data-icon="inline-start" />
      Im Query-Editor
    </Button>
  );
}
