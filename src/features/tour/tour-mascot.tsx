import { useId } from "react";
import { cn } from "@/lib/utils";

export type MascotMood = "idle" | "talking" | "thinking" | "waving" | "happy";

interface Props {
  mood?: MascotMood;
  walking?: boolean;
  look?: { x: number; y: number };
  size?: number;
  className?: string;
}

const hue = (lightness: number, chroma: number) => `oklch(${lightness} ${chroma} var(--db-hue))`;

export function TourMascot({
  mood = "idle",
  walking = false,
  look = { x: 0, y: 0 },
  size = 60,
  className,
}: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const pointing = Math.hypot(look.x, look.y) > 0.5 && mood !== "waving";
  const angle = (Math.atan2(-look.x, look.y) * 180) / Math.PI;
  const rightArm = pointing && look.x >= 0 ? `rotate(${angle}deg)` : undefined;
  const leftArm = pointing && look.x < 0 ? `rotate(${angle}deg)` : undefined;
  const eyeX = look.x * 2.2;
  const eyeY = mood === "thinking" ? -1.8 : look.y * 1.5;

  return (
    <svg
      viewBox="0 0 64 72"
      width={size}
      height={(size * 72) / 64}
      aria-hidden
      data-mood={mood}
      data-walking={walking || undefined}
      className={cn("tour-mascot overflow-visible", className)}
    >
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: hue(0.82, 0.11) }} />
          <stop offset="1" style={{ stopColor: hue(0.5, 0.16) }} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.26" />
          <stop offset="0.22" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.32" />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: hue(0.95, 0.05) }} />
          <stop offset="1" style={{ stopColor: hue(0.78, 0.1) }} />
        </linearGradient>
        <linearGradient id={`${id}v`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: hue(0.26, 0.04) }} />
          <stop offset="1" style={{ stopColor: hue(0.16, 0.03) }} />
        </linearGradient>
        <radialGradient id={`${id}g`}>
          <stop offset="0" stopColor="#B8F03C" stopOpacity="0.9" />
          <stop offset="1" stopColor="#B8F03C" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}e`}>
          <stop offset="0" stopColor="#E9F6FF" stopOpacity="0.55" />
          <stop offset="1" stopColor="#E9F6FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="tour-mascot-shadow" cx="32" cy="69.2" rx="15" ry="2.4" fill="#000" />
      <rect
        className="tour-mascot-foot-l"
        x="21"
        y="56.5"
        width="8"
        height="11"
        rx="4"
        style={{ fill: hue(0.3, 0.06) }}
      />
      <rect
        className="tour-mascot-foot-r"
        x="35"
        y="56.5"
        width="8"
        height="11"
        rx="4"
        style={{ fill: hue(0.3, 0.06) }}
      />
      <g className="tour-mascot-body">
        <g className="tour-mascot-arm-l" style={{ transform: leftArm }}>
          <rect x="5.5" y="32" width="7" height="14" rx="3.5" style={{ fill: hue(0.58, 0.15) }} />
        </g>
        <g className="tour-mascot-arm-r" style={{ transform: rightArm }}>
          <rect x="51.5" y="32" width="7" height="14" rx="3.5" style={{ fill: hue(0.58, 0.15) }} />
        </g>
        <path
          d="M32 10.5V4.8"
          strokeWidth="1.6"
          strokeLinecap="round"
          style={{ stroke: hue(0.42, 0.08) }}
        />
        <circle className="tour-mascot-glow" cx="32" cy="4.4" r="5.2" fill={`url(#${id}g)`} />
        <circle cx="32" cy="4.4" r="2.3" fill="#B8F03C" />
        <circle cx="31.3" cy="3.7" r="0.7" fill="#fff" opacity="0.8" />
        <path d="M10 17V52a22 7.5 0 0 0 44 0V17Z" fill={`url(#${id}b)`} />
        <path d="M10 17V52a22 7.5 0 0 0 44 0V17Z" fill={`url(#${id}s)`} />
        <path
          d="M10 44a22 7.5 0 0 0 44 0"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.14"
          strokeWidth="1"
        />
        <ellipse cx="32" cy="17" rx="22" ry="7.5" fill={`url(#${id}l)`} />
        <ellipse
          cx="32"
          cy="17"
          rx="21.6"
          ry="7.1"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.55"
          strokeWidth="0.7"
        />
        <ellipse cx="26" cy="15.4" rx="9" ry="2.1" fill="#fff" opacity="0.5" />
        <rect x="15.5" y="23.5" width="33" height="19" rx="9.5" fill={`url(#${id}v)`} />
        <rect x="17" y="24.6" width="30" height="6.5" rx="3.25" fill="#fff" opacity="0.07" />
        <g className="tour-mascot-eyes" style={{ transform: `translate(${eyeX}px, ${eyeY}px)` }}>
          <ellipse cx="32" cy="31.5" rx="12" ry="6" fill={`url(#${id}e)`} />
          <g className="tour-mascot-blink">
            <rect x="23.6" y="27.6" width="4.8" height="7.6" rx="2.4" fill="#F4F9FF" />
            <rect x="35.6" y="27.6" width="4.8" height="7.6" rx="2.4" fill="#F4F9FF" />
          </g>
          <g className="tour-mascot-happy" fill="none" stroke="#F4F9FF" strokeWidth="1.8">
            <path d="M23.4 32.4q2.6-3.4 5.2 0" strokeLinecap="round" />
            <path d="M35.4 32.4q2.6-3.4 5.2 0" strokeLinecap="round" />
          </g>
        </g>
        <path
          className="tour-mascot-mouth"
          d="M29.4 38.1q2.6 2.1 5.2 0"
          fill="none"
          stroke="#F4F9FF"
          strokeOpacity="0.9"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <ellipse
          cx="13.6"
          cy="40.5"
          rx="2.6"
          ry="1.5"
          style={{ fill: "oklch(0.76 0.13 15)" }}
          opacity="0.45"
        />
        <ellipse
          cx="50.4"
          cy="40.5"
          rx="2.6"
          ry="1.5"
          style={{ fill: "oklch(0.76 0.13 15)" }}
          opacity="0.45"
        />
      </g>
    </svg>
  );
}
