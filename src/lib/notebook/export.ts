import { csvValueText, serializeRows } from "@/lib/export";
import { type MdInline, parseMarkdown, safeHref } from "@/lib/markdown";
import type { NotebookDoc, NotebookOutput } from "./model";

export const EXPORT_ROWS = 200;

function outputSummary(output: NotebookOutput): string {
  const total = output.totalRows ?? output.rows.length;
  const parts = [
    output.columns.length ? `${total} Zeilen` : `${output.rowsAffected ?? 0} Zeilen betroffen`,
    `${output.executionMs} ms`,
  ];
  if (output.columns.length && total > EXPORT_ROWS) parts.push(`erste ${EXPORT_ROWS} gezeigt`);
  return parts.join(" · ");
}

export function notebookToMarkdown(
  doc: NotebookDoc,
  outputs: Record<string, NotebookOutput>,
): string {
  const parts: string[] = [];
  for (const cell of doc.cells) {
    if (cell.type === "markdown") parts.push(cell.source.trim());
    else if (cell.type === "variables")
      parts.push(
        serializeRows(
          ["Variable", "Typ", "Wert"],
          cell.variables.map((v) => ({ Variable: v.name, Typ: v.type, Wert: v.value })),
          "markdown",
        ),
      );
    else {
      parts.push(`\`\`\`sql\n${cell.source.trim()}\n\`\`\``);
      const output = outputs[cell.id];
      if (output?.error) parts.push(`> Fehler: ${output.error.replace(/\n/g, " ")}`);
      else if (output) {
        if (output.columns.length)
          parts.push(serializeRows(output.columns, output.rows.slice(0, EXPORT_ROWS), "markdown"));
        parts.push(`_${outputSummary(output)}_`);
      }
    }
  }
  return `${parts.filter(Boolean).join("\n\n")}\n`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineHtml(nodes: MdInline[]): string {
  return nodes
    .map((node) => {
      if (node.t === "text") return escapeHtml(node.v);
      if (node.t === "strong") return `<strong>${inlineHtml(node.children)}</strong>`;
      if (node.t === "em") return `<em>${inlineHtml(node.children)}</em>`;
      if (node.t === "code") return `<code>${escapeHtml(node.v)}</code>`;
      const href = safeHref(node.href);
      return href
        ? `<a href="${escapeHtml(href)}">${inlineHtml(node.children)}</a>`
        : inlineHtml(node.children);
    })
    .join("");
}

export function markdownToHtml(source: string): string {
  return parseMarkdown(source)
    .map((block) => {
      if (block.t === "h")
        return `<h${block.level}>${inlineHtml(block.children)}</h${block.level}>`;
      if (block.t === "ul")
        return `<ul>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join("")}</ul>`;
      if (block.t === "hr") return "<hr>";
      if (block.t === "pre") return `<pre>${escapeHtml(block.v)}</pre>`;
      return `<p>${inlineHtml(block.children)}</p>`;
    })
    .join("\n");
}

function tableHtml(columns: string[], rows: Record<string, unknown>[]): string {
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${columns.map((c) => `<td>${escapeHtml(csvValueText(row[c]) ?? "NULL")}</td>`).join("")}</tr>`,
    )
    .join("\n");
  return `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

const STYLE =
  "body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1f2937}pre{background:#f3f4f6;padding:.75rem;border-radius:8px;overflow:auto}table{border-collapse:collapse;font-size:12px;margin:.5rem 0}th,td{border:1px solid #e5e7eb;padding:4px 8px;text-align:left}th{background:#f9fafb}.meta{color:#6b7280;font-size:12px}.error{color:#b91c1c}";

export function notebookToHtml(doc: NotebookDoc, outputs: Record<string, NotebookOutput>): string {
  const parts: string[] = [];
  for (const cell of doc.cells) {
    if (cell.type === "markdown") parts.push(markdownToHtml(cell.source));
    else if (cell.type === "variables")
      parts.push(
        tableHtml(
          ["Variable", "Typ", "Wert"],
          cell.variables.map((v) => ({ Variable: v.name, Typ: v.type, Wert: v.value })),
        ),
      );
    else {
      parts.push(`<pre><code>${escapeHtml(cell.source.trim())}</code></pre>`);
      const output = outputs[cell.id];
      if (output?.error) parts.push(`<p class="error">${escapeHtml(output.error)}</p>`);
      else if (output) {
        if (output.columns.length)
          parts.push(tableHtml(output.columns, output.rows.slice(0, EXPORT_ROWS)));
        parts.push(`<p class="meta">${escapeHtml(outputSummary(output))}</p>`);
      }
    }
  }
  return `<!doctype html>\n<html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title><style>${STYLE}</style></head><body>\n${parts.join("\n")}\n</body></html>\n`;
}
