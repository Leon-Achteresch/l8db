import { type ReactNode, useState } from "react";
import { MasterSelectionContext } from "@/lib/master-detail";

export function MasterSelectionScope({
  selectionKey,
  children,
}: {
  selectionKey: string | null;
  children: ReactNode;
}) {
  const [scope, setScope] = useState({ source: selectionKey, key: selectionKey ?? "" });
  let current = scope;
  if (scope.source !== selectionKey) {
    current = {
      source: selectionKey,
      key: scope.source === null ? scope.key : (selectionKey ?? ""),
    };
    setScope(current);
  }
  return (
    <MasterSelectionContext.Provider key={current.key} value={selectionKey}>
      {children}
    </MasterSelectionContext.Provider>
  );
}
