import NumberFlow, { type Format } from "@number-flow/react";

const DEFAULT_FORMAT: Format = { maximumFractionDigits: 2 };

export function AnimatedNumber({
  value,
  format = DEFAULT_FORMAT,
  prefix,
  suffix,
  className,
}: {
  value: number;
  format?: Format;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  if (!Number.isFinite(value)) return <span className={className}>—</span>;
  return (
    <NumberFlow
      value={value}
      locales="de-DE"
      format={format}
      prefix={prefix}
      suffix={suffix}
      className={className}
    />
  );
}
