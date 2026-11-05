export type Ctx = CanvasRenderingContext2D;

export const LINE = "#2b2633";
export const UI = '"Inter", "SF Pro Text", system-ui, sans-serif';
export const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

export function hash(value: number) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function lerp(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

export function line(ctx: Ctx, width = 2.2, color = LINE) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

export function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function outline(ctx: Ctx, fill: string, width = 2) {
  ctx.fillStyle = fill;
  ctx.fill();
  line(ctx, width);
}

export function label(ctx: Ctx, text: string, x: number, y: number, size: number, color = LINE) {
  ctx.font = `700 ${size}px ${UI}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
