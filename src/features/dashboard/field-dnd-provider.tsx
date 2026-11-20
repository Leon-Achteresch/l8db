import { DragDropProvider } from "@dnd-kit/react";
import type { ReactNode } from "react";
import { FIELD_DND_PLUGINS, FIELD_DND_SENSORS, runFieldDrop } from "./field-dnd";

export function FieldDndProvider({ children }: { children: ReactNode }) {
  return (
    <DragDropProvider
      sensors={FIELD_DND_SENSORS}
      plugins={FIELD_DND_PLUGINS}
      onDragEnd={({ operation, canceled }) => {
        if (canceled || !operation.source || !operation.target) return;
        runFieldDrop(operation.source.data, operation.target.data);
      }}
    >
      {children}
    </DragDropProvider>
  );
}
