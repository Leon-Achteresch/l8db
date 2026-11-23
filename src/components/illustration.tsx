import { cn } from "@/lib/utils";

export type IllustrationName =
  | "empty"
  | "connect"
  | "not-found"
  | "error"
  | "success"
  | "welcome"
  | "search"
  | "query";

export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  return (
    <img
      src={`/illustrations/${name}.webp`}
      alt=""
      aria-hidden
      width={704}
      height={704}
      loading="lazy"
      decoding="async"
      draggable={false}
      data-illustration={name}
      className={cn(
        "illustration pointer-events-none aspect-square shrink-0 object-contain select-none",
        className,
      )}
    />
  );
}
