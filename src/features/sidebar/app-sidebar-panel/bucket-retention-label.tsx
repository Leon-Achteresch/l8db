import { NewBadge } from "@/components/new-badge";
import type { BucketRetention } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const units = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
] as const;
const formats = units.map(
  ([unit]) => new Intl.NumberFormat("de", { style: "unit", unit, unitDisplay: "long" }),
);

function duration(seconds: number): string {
  if (seconds === 0) return "Unbegrenzt";
  return units
    .flatMap(([, size], index) => {
      const amount = Math.floor(seconds / size);
      seconds %= size;
      return amount ? [formats[index].format(amount)] : [];
    })
    .join(", ");
}

export function BucketRetentionLabel({ retention }: { retention?: BucketRetention }) {
  const seconds = retention?.seconds;
  const known =
    typeof retention?.org_id === "string" &&
    retention.org_id.length > 0 &&
    typeof retention.bucket_id === "string" &&
    retention.bucket_id.length > 0 &&
    typeof seconds === "number" &&
    Number.isSafeInteger(seconds) &&
    seconds >= 0;
  const feature = useNewFeatureVisibility<HTMLParagraphElement>(
    known ? "sidebar.scope.bucket-retention" : undefined,
  );
  return (
    <p
      ref={feature.ref}
      className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[11px] leading-4 text-muted-foreground"
      data-slot="bucket-retention"
      title={
        known && seconds > 0
          ? "Vom Server gemeldete Bucket-Regel. Daten können zeitversetzt gelöscht werden."
          : undefined
      }
    >
      <span>Aufbewahrung</span>
      <span className="tabular-nums text-foreground">
        {known ? duration(seconds) : "Unbekannt"}
      </span>
      {known && feature.isNew && <NewBadge />}
    </p>
  );
}
