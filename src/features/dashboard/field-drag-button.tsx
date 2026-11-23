import { type ComponentProps, forwardRef, useCallback } from "react";
import { type FieldDragData, useFieldDraggable, useFieldDrop } from "./field-dnd";

type Props = ComponentProps<"button"> & {
  dragId: string;
  drag: FieldDragData;
  dragDisabled?: boolean;
  dropAccepts?: (data: FieldDragData) => boolean;
  onFieldDrop?: (data: FieldDragData) => void;
};

const NEVER = () => false;
const NOOP = () => undefined;

export const FieldDragButton = forwardRef<HTMLButtonElement, Props>(function FieldDragButton(
  { dragId, drag, dragDisabled, dropAccepts, onFieldDrop, ...props },
  forwarded,
) {
  const draggable = useFieldDraggable(dragId, drag, dragDisabled);
  const droppable = useFieldDrop(
    `drop:${dragId}`,
    dropAccepts ?? NEVER,
    onFieldDrop ?? NOOP,
    !onFieldDrop,
  );
  const dragRef = draggable.ref;
  const dropRef = droppable.ref;
  const ref = useCallback(
    (element: HTMLButtonElement | null) => {
      dragRef(element);
      dropRef(element);
      if (typeof forwarded === "function") forwarded(element);
      else if (forwarded) forwarded.current = element;
    },
    [dragRef, dropRef, forwarded],
  );
  return (
    <button
      type="button"
      {...props}
      ref={ref}
      data-dragging={draggable.isDragSource || undefined}
      data-drop-target={droppable.isDropTarget || undefined}
    />
  );
});
