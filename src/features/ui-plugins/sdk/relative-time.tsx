import { asDate, formatDate, relativeTime } from "../../../../packages/ui-plugin-api/src/helpers";

export function RelativeTime({ value }: { value: unknown }) {
  const date = asDate(value);
  if (!date) return <span className="text-muted-foreground">–</span>;
  return (
    <time
      dateTime={date.toISOString()}
      title={formatDate(date, { time: true })}
      className="truncate font-sans"
    >
      {relativeTime(date)}
    </time>
  );
}
