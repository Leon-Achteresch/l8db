export type CinematicJump = { label: string; at: number };

export type CinematicRun = {
  time(): number;
  phase(): string;
  finished(): boolean;
  step(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
};

export type CinematicVariant = {
  id: string;
  label: string;
  description: string;
  jumps: CinematicJump[];
  create(sourceName: string, targetName: string, seed: number): CinematicRun;
};

export const STAGE = { width: 960, height: 540 } as const;
