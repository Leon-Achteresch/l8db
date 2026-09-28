import { Button } from "@/components/ui/button";

export function LogPagination({
  label,
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
}: {
  label: string;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (pageCount < 2) return null;
  const pages = Array.from({ length: pageCount }, (_, index) => String(index));

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
      <span>
        {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} von {total}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          aria-label={`Vorherige ${label}-Seite`}
        >
          Zurück
        </Button>
        <select
          value={String(page)}
          onChange={(event) => onPageChange(Number(event.target.value))}
          aria-label={`${label}-Seite`}
          className="h-8 w-24 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {pages.map((value) => (
            <option key={value} value={value}>
              Seite {Number(value) + 1}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
          aria-label={`Nächste ${label}-Seite`}
        >
          Weiter
        </Button>
      </div>
    </div>
  );
}
