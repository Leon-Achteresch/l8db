import { CheckIcon, MinusIcon, PencilIcon, PlusIcon } from "lucide-react";
import type { DataDiffCategory } from "@/lib/data-compare";

export const CATEGORY_LABEL: Record<DataDiffCategory, string> = {
  only_left: "Nur links",
  only_right: "Nur rechts",
  changed: "Geändert",
  equal: "Gleich",
};

export const CATEGORY_ICON: Record<DataDiffCategory, typeof CheckIcon> = {
  only_left: MinusIcon,
  only_right: PlusIcon,
  changed: PencilIcon,
  equal: CheckIcon,
};
