import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide";
import { MorphIcon } from "morphicons/react";
import type { Dispatch, SetStateAction } from "react";

import {
  type ResultSort,
  sortDirectionFor,
  sortRankFor,
  toggleResultSort,
} from "@/lib/result-grid";
import { cn } from "@/lib/utils";

interface ResultSortHeaderProps {
  col: string;
  sorts: ResultSort[];
  setSorts: Dispatch<SetStateAction<ResultSort[]>>;
}

export function ResultSortHeader({ col, sorts, setSorts }: ResultSortHeaderProps) {
  const direction = sortDirectionFor(sorts, col);
  const rank = sortRankFor(sorts, col);
  return (
    <th
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      className="border-b border-r bg-muted/90 p-0 text-left"
    >
      <button
        type="button"
        title={`Lokal sortieren nach ${col} (Umschalt-Klick für mehrere Spalten)`}
        onClick={(event) =>
          setSorts((prev) => toggleResultSort(prev, col, event.shiftKey || event.altKey))
        }
        className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-xs font-semibold text-foreground hover:bg-muted"
      >
        <span className="truncate">{col}</span>
        <MorphIcon
          icon={direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown}
          className={cn("size-3 shrink-0", !direction && "opacity-25")}
        />
        {rank !== null && sorts.length > 1 && (
          <span className="font-mono text-[10px] text-muted-foreground">{rank}</span>
        )}
      </button>
    </th>
  );
}
