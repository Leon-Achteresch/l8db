import { listSchemas } from "@/lib/db";
import { prepareConnection } from "@/lib/schema-compare/store";
import { effectiveConnectionString } from "@/lib/ssh";

export async function loadCopyTargetSchemas(
  targetId: string,
  activeId: string | undefined,
  database: string | undefined,
): Promise<string[]> {
  const ready = await prepareConnection(targetId);
  return listSchemas(
    ready.kind,
    effectiveConnectionString(ready),
    ready.id === activeId ? database : undefined,
  );
}
