import {
  BinaryIcon,
  BracesIcon,
  CalendarIcon,
  CheckIcon,
  HashIcon,
  KeyRoundIcon,
  TypeIcon,
} from "lucide-react";
import type { DetailedColumnInfo } from "@/lib/db";

export function getTypeConfig(dataType: string, isPrimaryKey: boolean) {
  const lower = dataType.toLowerCase();
  if (isPrimaryKey) {
    return {
      icon: KeyRoundIcon,
      color: "text-amber-500 bg-amber-500/10 border-amber-500/20",
      label: "Primary Key",
      badgeColor: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    };
  }
  if (
    lower === "long" ||
    lower.includes("int") ||
    lower.includes("numeric") ||
    lower.includes("double") ||
    lower.includes("real") ||
    lower.includes("decimal") ||
    lower.includes("serial") ||
    lower.includes("float")
  ) {
    return {
      icon: HashIcon,
      color: "text-blue-500 bg-blue-500/10 border-blue-500/20",
      label: "Numerisch",
      badgeColor: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    };
  }
  if (
    lower === "string" ||
    lower.includes("char") ||
    lower.includes("text") ||
    lower.includes("varchar") ||
    lower.includes("uuid") ||
    lower.includes("xml")
  ) {
    return {
      icon: TypeIcon,
      color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
      label: "Text",
      badgeColor: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    };
  }
  if (lower.includes("time") || lower.includes("date") || lower.includes("interval")) {
    return {
      icon: CalendarIcon,
      color: "text-purple-500 bg-purple-500/10 border-purple-500/20",
      label: "Datum/Zeit",
      badgeColor: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    };
  }
  if (lower.includes("bool")) {
    return {
      icon: CheckIcon,
      color: "text-teal-500 bg-teal-500/10 border-teal-500/20",
      label: "Boolean",
      badgeColor: "bg-teal-500/10 text-teal-500 border-teal-500/20",
    };
  }
  if (lower.includes("json") || lower === "object" || lower === "array") {
    return {
      icon: BracesIcon,
      color: "text-pink-500 bg-rose-500/10 border-rose-500/20",
      label: "JSON",
      badgeColor: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    };
  }
  return {
    icon: BinaryIcon,
    color: "text-slate-500 bg-slate-500/10 border-slate-500/20",
    label: "Andere",
    badgeColor: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  };
}

export function matchesColumnFilter(
  column: DetailedColumnInfo,
  search: string,
  selectedFilter: string,
): boolean {
  const matchesSearch =
    column.name.toLowerCase().includes(search.toLowerCase()) ||
    column.data_type.toLowerCase().includes(search.toLowerCase());

  if (!matchesSearch) return false;

  if (selectedFilter === "all") return true;
  if (selectedFilter === "pk") return column.is_primary_key;
  if (selectedFilter === "not-null") return !column.is_nullable;
  if (selectedFilter === "has-default") return column.column_default !== null;

  const lower = column.data_type.toLowerCase();
  if (selectedFilter === "numeric") {
    return (
      lower === "long" ||
      lower.includes("int") ||
      lower.includes("numeric") ||
      lower.includes("double") ||
      lower.includes("real") ||
      lower.includes("decimal") ||
      lower.includes("serial") ||
      lower.includes("float")
    );
  }
  if (selectedFilter === "text") {
    return (
      lower === "string" ||
      lower.includes("char") ||
      lower.includes("text") ||
      lower.includes("varchar") ||
      lower.includes("uuid") ||
      lower.includes("xml")
    );
  }
  if (selectedFilter === "date") {
    return lower.includes("time") || lower.includes("date") || lower.includes("interval");
  }
  if (selectedFilter === "boolean") {
    return lower.includes("bool");
  }
  if (selectedFilter === "json") {
    return lower.includes("json") || lower === "object" || lower === "array";
  }

  return true;
}
