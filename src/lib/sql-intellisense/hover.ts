import type { FunctionInfo } from "@/lib/db";
import type { PlsqlMember } from "@/lib/plsql";
import { eq } from "./resolve";
import type { SqlObjectRegistry, SymbolTarget } from "./types";

function truncate(value: unknown, max = 40): string {
  const text = String(value ?? "NULL")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function rowsMarkdownTable(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0 || rows.length === 0) return "";
  const header = `| ${columns.map((c) => truncate(c)).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((c) => truncate(row[c])).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

export interface HoverExtras {
  members?: PlsqlMember[];
  rows?: { columns: string[]; rows: Record<string, unknown>[] };
  routine?: FunctionInfo;
}

export function hoverMarkdown(
  registry: SqlObjectRegistry,
  target: SymbolTarget,
  extras: HoverExtras = {},
): string {
  if (target.kind === "local") {
    return `**${target.memberKind} ${target.name}** · Zeile ${target.line}`;
  }
  if (target.kind === "package") {
    if (target.member) {
      const member = extras.members?.find((m) => m.name === target.member);
      return member
        ? `**${member.kind} ${target.schema}.${target.name}.${member.name}**`
        : `**${target.schema}.${target.name}.${target.member}** · Package-Member`;
    }
    const members = (extras.members ?? []).map((m) => `- ${m.kind} \`${m.name}\``);
    return [`**PACKAGE ${target.schema}.${target.name}**`, ...members].join("\n");
  }
  if (target.kind !== "table") {
    const info = extras.routine;
    const signature = `${target.schema}.${target.name}(${info?.identity_args ?? ""})`;
    const returns =
      target.kind === "function" && info?.return_type ? ` RETURNS ${info.return_type}` : "";
    const head = `\`\`\`sql\n${target.kind.toUpperCase()} ${signature}${returns}\n\`\`\``;
    return info?.language ? `${head}\n${info.language}` : head;
  }
  if (target.kind !== "table") return "";
  const columns = registry.columns.filter(
    (c) => eq(c.schema, target.schema) && eq(c.table, target.name),
  );
  if (target.column) {
    const column = columns.find((c) => eq(c.name, target.column ?? ""));
    return `**${target.schema}.${target.name}.${target.column}** · ${column?.data_type ?? "Spalte"}`;
  }
  const lines = [`**${target.schema}.${target.name}** · ${target.entityType}`];
  for (const column of columns.slice(0, 40)) lines.push(`- \`${column.name}\` ${column.data_type}`);
  if (columns.length > 40) lines.push(`- … ${columns.length - 40} weitere`);
  if (extras.rows) {
    const table = rowsMarkdownTable(extras.rows.columns, extras.rows.rows);
    if (table) lines.push("", table);
  }
  return lines.join("\n");
}

export function quoteIdent(name: string): string {
  const plain = /^[a-z_][a-z0-9_$#]*$/.test(name) || /^[A-Z_][A-Z0-9_$#]*$/.test(name);
  return plain ? name : `"${name.replace(/"/g, '""')}"`;
}
