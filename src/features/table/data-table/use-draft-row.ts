import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type DuplicatePrefill, describeInsertError } from "@/lib/row-duplicate";
import type { DataTableProps } from "../data-table-types";

export function useDraftRow(onInsertRow: DataTableProps["onInsertRow"]) {
  const [draft, setDraft] = useState<DuplicatePrefill | null>(null);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [isInserting, setIsInserting] = useState(false);
  const insertInFlight = useRef(false);
  const draftRef = useRef<HTMLTableSectionElement>(null);
  const [draftHeight, setDraftHeight] = useState(0);
  const hasDraft = draft !== null;

  useEffect(() => {
    const element = draftRef.current;
    if (!hasDraft || !element) {
      setDraftHeight(0);
      return;
    }
    const measure = () => setDraftHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasDraft]);

  const saveDraft = async () => {
    if (!draft || !onInsertRow || insertInFlight.current) return;
    const values = Object.fromEntries(
      Object.entries(draft).flatMap(([column, field]) =>
        field.mode === "default" ? [] : [[column, field.mode === "null" ? null : field.value]],
      ),
    );
    insertInFlight.current = true;
    setIsInserting(true);
    setInsertError(null);
    try {
      await onInsertRow(values);
      setDraft(null);
      toast.success("Zeile als neue Zeile eingefügt.");
    } catch (error) {
      setInsertError(describeInsertError(error));
    } finally {
      insertInFlight.current = false;
      setIsInserting(false);
    }
  };

  return {
    draft,
    setDraft,
    insertError,
    setInsertError,
    isInserting,
    draftRef,
    draftHeight,
    hasDraft,
    saveDraft,
  };
}
