import { defaultPreset, Feedback, PointerActivationConstraints } from "@dnd-kit/dom";
import { PointerSensor, useDraggable, useDragOperation, useDroppable } from "@dnd-kit/react";
import { useRef } from "react";
import type { JoinColumnDrag } from "./chart-studio/studio-model";
import type { SourceTable } from "./chart-studio/studio-source-list";

export interface FieldDragData {
  ref?: string;
  join?: JoinColumnDrag;
  source?: SourceTable;
}

export type FieldDragKind = keyof FieldDragData;

export const FIELD_DND_SENSORS = [
  PointerSensor.configure({
    activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 4 })],
    preventActivation: () => false,
  }),
];

export const FIELD_DND_PLUGINS = defaultPreset.plugins.map((plugin) =>
  plugin === Feedback ? Feedback.configure({ feedback: "clone", dropAnimation: null }) : plugin,
);

export interface FieldDropData {
  drop: (data: FieldDragData) => void;
}

function dragData(data: unknown): FieldDragData {
  return (data ?? {}) as FieldDragData;
}

export function runFieldDrop(source: unknown, target: unknown) {
  const drop = (target as Partial<FieldDropData> | null | undefined)?.drop;
  if (typeof drop === "function") drop(dragData(source));
}

export function useFieldDraggable(id: string, data: FieldDragData, disabled = false) {
  return useDraggable({ id, data, disabled });
}

export function useFieldDrop(
  id: string,
  accepts: (data: FieldDragData) => boolean,
  onDrop: (data: FieldDragData) => void,
  disabled = false,
) {
  const latest = useRef({ accepts, onDrop });
  latest.current = { accepts, onDrop };
  return useDroppable({
    id,
    disabled,
    accept: (source) => latest.current.accepts(dragData(source.data)),
    data: { drop: (data: FieldDragData) => latest.current.onDrop(data) } satisfies FieldDropData,
  });
}

export function useFieldDragActive(kind: FieldDragKind): boolean {
  const { source } = useDragOperation();
  return Boolean(source && dragData(source.data)[kind]);
}
