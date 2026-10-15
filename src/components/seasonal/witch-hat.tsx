import { cn } from "@/lib/utils";

export function WitchHat({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 28"
      aria-hidden
      data-seasonal="witch-hat"
      className={cn("pointer-events-none absolute z-20 overflow-visible", className)}
    >
      <g className="fill-[#262335] stroke-transparent dark:stroke-white/45" strokeWidth={0.8}>
        <ellipse cx="16" cy="23.6" rx="15" ry="3.4" />
        <path d="M8.5 22.6C10.5 16 12.5 9.5 15.5 5.5C17.5 2.8 20.5 1.6 24 2.6C21 3.6 19.6 5.6 19.6 8.6C19.6 13 21.6 18.4 23.5 22.6Z" />
      </g>
      <path
        d="M9.7 18.4C13.5 19.4 18.5 19.4 22.1 18.3L23.1 21.3C18.6 22.5 13.4 22.5 8.8 21.4Z"
        className="fill-[#fb923c]"
      />
    </svg>
  );
}
