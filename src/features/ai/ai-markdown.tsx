import { Markdown } from "@/components/markdown";
import { parseAiMarkdownTables } from "@/lib/ai/markdown-tables";

export function AiMarkdown({ source }: { source: string }) {
  return parseAiMarkdownTables(source).map((block) =>
    block.type === "markdown" ? (
      <Markdown key={block.id} source={block.text} className="text-xs text-foreground" />
    ) : (
      <div key={block.id} className="max-w-full overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/30">
            <tr>
              {block.columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  style={{ textAlign: column.align }}
                  className="border-b px-3 py-2 font-medium"
                >
                  <Markdown source={column.label} className="text-xs text-foreground" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.id} className="border-b last:border-b-0">
                {block.columns.map((column, index) => (
                  <td
                    key={column.id}
                    style={{ textAlign: column.align }}
                    className="px-3 py-2 align-top"
                  >
                    <Markdown source={row.cells[index]} className="text-xs text-foreground" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  );
}
