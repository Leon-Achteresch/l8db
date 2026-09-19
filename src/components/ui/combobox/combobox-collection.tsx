"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react";

export function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return <ComboboxPrimitive.Collection data-slot="combobox-collection" {...props} />;
}
