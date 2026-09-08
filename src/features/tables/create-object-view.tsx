import { useActiveCapabilities } from "@/lib/db-selection";
import { CreateCollectionView } from "@/features/tables/create-collection-view";
import { CreateTableView } from "@/features/tables/create-table-view";

export function CreateObjectView() {
  const caps = useActiveCapabilities();
  return caps.query_language === "json" ? <CreateCollectionView /> : <CreateTableView />;
}
