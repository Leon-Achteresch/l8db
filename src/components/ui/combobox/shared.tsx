"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import * as React from "react";

export const Combobox = ComboboxPrimitive.Root;

export function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null);
}
