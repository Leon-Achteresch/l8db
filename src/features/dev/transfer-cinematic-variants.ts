import { brawlVariant } from "./transfer-brawl-sim";
import { classicVariant } from "./transfer-cinematic-classic";
import type { CinematicVariant } from "./transfer-cinematic-variant";
import { riftVariant } from "./transfer-rift-draw";

export const CINEMATIC_VARIANTS: CinematicVariant[] = [classicVariant, brawlVariant, riftVariant];
