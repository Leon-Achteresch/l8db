import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { Ascii } from "./ascii";
import { Bars } from "./bars";
import { Comet } from "./comet";
import { Dither } from "./dither";
import { DotMatrix } from "./dot-matrix";
import { Dots } from "./dots";
import { Helix } from "./helix";
import { Metaballs } from "./metaballs";
import { Morph } from "./morph";
import { Newton } from "./newton";
import { Percent } from "./percent";
import { Scramble } from "./scramble";
import { ASCII_SETS, type LoaderProps } from "./shared";
import { Spinner } from "./spinner";
export function Loader({
  variant = "spinner",
  size = 32,
  speed = 1,
  label = "Loading",
  className,
}: LoaderProps) {
  const reduce = useReducedMotion() ?? false;
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex items-center justify-center text-foreground", className)}
    >
      {variant === "spinner" && <Spinner size={size} speed={speed} reduce={reduce} />}
      {variant === "dots" && <Dots size={size} speed={speed} reduce={reduce} />}
      {variant === "bars" && <Bars size={size} speed={speed} reduce={reduce} />}
      {variant === "dot-matrix" && <DotMatrix size={size} speed={speed} reduce={reduce} />}
      {variant === "dither" && <Dither size={size} speed={speed} reduce={reduce} />}
      {ASCII_SETS[variant] && (
        <Ascii frames={ASCII_SETS[variant]} size={size} speed={speed} reduce={reduce} />
      )}
      {variant === "morph" && <Morph size={size} speed={speed} reduce={reduce} />}
      {variant === "comet" && <Comet size={size} speed={speed} reduce={reduce} />}
      {variant === "scramble" && <Scramble size={size} speed={speed} reduce={reduce} />}
      {variant === "metaballs" && <Metaballs size={size} speed={speed} reduce={reduce} />}
      {variant === "newton" && <Newton size={size} speed={speed} reduce={reduce} />}
      {variant === "helix" && <Helix size={size} speed={speed} reduce={reduce} />}
      {variant === "percent" && <Percent size={size} speed={speed} reduce={reduce} />}
      <span className="sr-only">{label}</span>
    </span>
  );
}
