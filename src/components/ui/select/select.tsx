"use client";

import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";
import { SelectClosedValueContext } from "./shared";

export function Select({
  open: openProp,
  defaultOpen,
  onOpenChange,
  value: valueProp,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [openState, setOpenState] = React.useState(defaultOpen ?? false);
  const [valueState, setValueState] = React.useState(defaultValue);
  const open = openProp ?? openState;
  const value = valueProp ?? valueState ?? "";

  return (
    <SelectClosedValueContext.Provider value={open ? null : value}>
      <SelectPrimitive.Root
        data-slot="select"
        open={open}
        onOpenChange={(next) => {
          setOpenState(next);
          onOpenChange?.(next);
        }}
        value={valueProp}
        defaultValue={defaultValue}
        onValueChange={(next) => {
          setValueState(next);
          onValueChange?.(next);
        }}
        {...props}
      />
    </SelectClosedValueContext.Provider>
  );
}
