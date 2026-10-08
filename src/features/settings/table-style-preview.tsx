import { CheckIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { renderTypeIcon } from "@/features/table/data-table/render-type-icon";
import { CATEGORY_BAR_CLASSES, CATEGORY_PILL_CLASSES } from "@/lib/category-colors";
import { categoryColorIndex } from "@/lib/grid-cell-format";
import type { TableStyle } from "@/lib/table-style";
import { cn } from "@/lib/utils";

const COLUMNS = [
  { name: "id", type: "id", icon: "Key", numeric: true },
  { name: "customer", type: "text", icon: "Type", numeric: false },
  { name: "status", type: "text", icon: "Type", numeric: false },
  { name: "total", type: "num", icon: "Hash", numeric: true },
  { name: "gift", type: "bool", icon: "Binary", numeric: false },
  { name: "created_at", type: "date", icon: "Calendar", numeric: false },
] as const;

const ROWS = [
  ["1041", "Anna Schmidt", "paid", "248,90", true, "2026-10-06 14:02", "vor 2 Tagen", "14:02"],
  ["1042", "Ben Fischer", "shipped", "89,10", false, "2026-10-05 09:41", "vor 3 Tagen", "09:41"],
  ["1043", "Clara Weber", "pending", "1.204,00", false, "2026-10-04 18:20", "vor 4 Tagen", "18:20"],
  ["1044", "David Koch", "paid", "56,45", true, "2026-10-01 11:15", "vor 7 Tagen", "11:15"],
  ["1045", "Elif Wagner", "refunded", "312,70", false, "2026-09-28 08:03", "vor 10 Tagen", "08:03"],
  ["1046", "Finn Becker", "shipped", "74,99", false, "2026-09-25 16:44", "vor 13 Tagen", "16:44"],
  ["1047", "Greta Hoffmann", "paid", "640,00", true, "2026-09-22 12:30", "vor 16 Tagen", "12:30"],
  ["1048", "Hannes Müller", "pending", "18,20", false, "2026-09-20 07:55", "vor 18 Tagen", "07:55"],
  ["1049", "Ida Schmidt", "shipped", "932,40", false, "2026-09-18 19:12", "vor 20 Tagen", "19:12"],
  ["1050", "Jonas Koch", "paid", "127,00", true, "2026-09-15 10:08", "vor 23 Tagen", "10:08"],
  ["1051", "Klara Weber", "shipped", "45,60", false, "2026-09-12 13:37", "vor 26 Tagen", "13:37"],
  ["1052", "Luca Wagner", "pending", "289,00", false, "2026-09-10 17:05", "vor 28 Tagen", "17:05"],
  ["1053", "Mia Becker", "paid", "72,30", true, "2026-09-09 08:49", "vor 29 Tagen", "08:49"],
] as const;

const WIDTHS: Record<TableStyle, string> = {
  classic: "40px 110px 84px 80px 70px 120px",
  compact: "34px 66px 46px 46px 34px 70px",
  semantic: "34px 64px 50px 46px 32px 64px",
  profile: "34px 64px 50px 48px 34px 70px",
};

const PROFILE_BARS = [
  [3, 5, 4, 6, 5, 7, 6],
  [2, 6, 3, 7, 4, 5, 2],
].map((bars) => bars.map((height, slot) => ({ slot, height })));

const TABLE_STYLE_PREVIEW_WIDTH = 330;
const TABLE_STYLE_PREVIEW_HEIGHT = 198;

export function TableStylePreview({ style }: { style: TableStyle }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setScale(frame.clientWidth / TABLE_STYLE_PREVIEW_WIDTH || 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const classic = style === "classic";
  const rowHeight = classic ? "h-[17px]" : style === "semantic" ? "h-[15px]" : "h-[13px]";
  return (
    <div
      ref={frameRef}
      aria-hidden
      className="pointer-events-none relative aspect-[5/3] w-full overflow-hidden bg-background select-none"
    >
      <div
        className="absolute top-0 left-0 flex origin-top-left flex-col overflow-hidden font-mono text-[7.5px] leading-none text-foreground/85"
        style={{
          width: TABLE_STYLE_PREVIEW_WIDTH,
          height: TABLE_STYLE_PREVIEW_HEIGHT,
          transform: `scale(${scale})`,
        }}
      >
        <div className="flex h-3.5 shrink-0 items-center gap-1 border-b border-border/70 bg-card px-1.5">
          <span className="size-1 rounded-full bg-rose-400/80" />
          <span className="size-1 rounded-full bg-amber-400/80" />
          <span className="size-1 rounded-full bg-emerald-400/80" />
          <span className="ml-1 font-sans text-[7px] text-muted-foreground">public.orders</span>
        </div>
        <div
          className="grid min-h-0 flex-1"
          style={{ gridTemplateColumns: `14px ${WIDTHS[style]}` }}
        >
          <div
            className={cn(
              "border-r border-b border-border/70 bg-muted",
              style === "profile" ? "h-[30px]" : classic ? "h-[17px]" : "h-[14px]",
            )}
          />
          {COLUMNS.map((column, index) => (
            <div
              key={column.name}
              className={cn(
                "flex min-w-0 flex-col justify-center gap-[3px] overflow-hidden border-r border-b border-border/70 bg-muted px-1",
                style === "profile" ? "h-[30px]" : classic ? "h-[17px]" : "h-[14px]",
              )}
            >
              <div
                className={cn(
                  "flex min-w-0 items-center gap-[3px]",
                  !classic && column.numeric && "justify-end",
                )}
              >
                {classic ? null : (
                  <span className="shrink-0 text-muted-foreground/60">
                    {renderTypeIcon(column.icon, "size-[6px]")}
                  </span>
                )}
                <span className="truncate font-semibold text-foreground/80">{column.name}</span>
                {classic ? (
                  <span className="ml-auto shrink-0 rounded-[2px] bg-foreground/8 px-[2px] text-[6px] text-muted-foreground">
                    {column.type}
                  </span>
                ) : null}
              </div>
              {style === "profile" ? (
                column.name === "status" ? (
                  <div className="flex h-[3px] w-full gap-px overflow-hidden rounded-full">
                    {["paid", "shipped", "pending", "refunded"].map((value, part) => (
                      <span
                        key={value}
                        className={cn(
                          "h-full opacity-80",
                          CATEGORY_BAR_CLASSES[categoryColorIndex(value)],
                        )}
                        style={{ width: `${[42, 29, 15, 14][part]}%` }}
                      />
                    ))}
                  </div>
                ) : column.name === "gift" ? (
                  <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted-foreground/20">
                    <span className="block h-full w-[43%] bg-emerald-500/80" />
                  </div>
                ) : column.numeric || column.type === "date" ? (
                  <div className="flex h-[7px] items-end gap-px">
                    {PROFILE_BARS[index % 2].map(({ slot, height }) => (
                      <span
                        key={slot}
                        className={cn(
                          "flex-1 rounded-[1px]",
                          column.type === "date" ? "bg-violet-500/70" : "bg-sky-500/70",
                        )}
                        style={{ height: `${(height / 7) * 100}%` }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="h-[3px] w-full overflow-hidden rounded-full bg-muted-foreground/20">
                    <span className="block h-full w-full bg-sky-500/60" />
                  </div>
                )
              ) : null}
            </div>
          ))}
          {ROWS.map((row) => [
            <div
              key={`${row[0]}-index`}
              className={cn(
                "flex items-center justify-center border-r border-b border-border/40 text-[6.5px] text-muted-foreground/60",
                rowHeight,
              )}
            >
              {Number(row[0]) - 1040}
            </div>,
            ...COLUMNS.map((column, index) => {
              const raw = row[index];
              let content: ReactNode = String(raw);
              if (column.name === "created_at") content = classic ? row[5] : row[5].slice(5, 16);
              if (style === "semantic") {
                if (column.name === "status")
                  content = (
                    <span
                      className={cn(
                        "inline-flex items-center gap-[2px] rounded-full px-[3px] py-[1.5px] font-sans text-[6.5px] font-medium",
                        CATEGORY_PILL_CLASSES[categoryColorIndex(String(raw))],
                      )}
                    >
                      <span className="size-[3px] rounded-full bg-current" />
                      {String(raw)}
                    </span>
                  );
                if (column.name === "gift")
                  content = raw ? (
                    <CheckIcon className="size-2 text-emerald-500" />
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  );
                if (column.name === "created_at")
                  content = <span className="font-sans">{row[6]}</span>;
                if (column.name === "id")
                  content = (
                    <span className="text-amber-600 dark:text-amber-400">{String(raw)}</span>
                  );
              }
              return (
                <div
                  key={`${row[0]}-${column.name}`}
                  className={cn(
                    "flex min-w-0 items-center overflow-hidden border-r border-b border-border/40 px-1 whitespace-nowrap",
                    rowHeight,
                    !classic && column.numeric && "justify-end tabular-nums",
                    style === "semantic" && !column.numeric && "font-sans",
                    column.name === "gift" && style === "semantic" && "justify-center",
                  )}
                >
                  <span className="truncate">{content}</span>
                </div>
              );
            }),
          ])}
        </div>
      </div>
    </div>
  );
}
