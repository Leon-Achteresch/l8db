import { type ExportedConnection, stripConnectionSecrets } from "@/lib/connection-export";
import { oracleKeyValueToUrl } from "@/lib/connection-url";
import { createConnectionId } from "@/lib/connections";

export function isToadExport(text: string): boolean {
  return /^\s*(<\?xml[^>]*>\s*)?<ToadOracle[\s>]/i.test(text);
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!match) return "";
  const inner = match[1] ?? "";
  const cdata = inner.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (cdata ? (cdata[1] ?? "") : inner)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

export function parseToadExport(text: string): Array<ExportedConnection | string> {
  const blocks = text.match(/<Connection(?:\s[^>]*)?>[\s\S]*?<\/Connection>/gi) ?? [];
  return blocks.map((block) => {
    const user = tag(block, "User");
    const host = tag(block, "Host");
    const port = tag(block, "Port");
    const service = tag(block, "Sid") || tag(block, "InstanceName");
    const source =
      host && service ? `${host}${port ? `:${port}` : ""}/${service}` : tag(block, "Server");
    if (!user) return `Toad-Eintrag ohne Benutzer (${source || "?"}).`;
    if (!source) return `Toad-Eintrag „${user}“ ohne Server/Data Source.`;
    try {
      return {
        id: createConnectionId(),
        name: `${user}@${source}`,
        kind: "oracle",
        connectionString: stripConnectionSecrets(
          oracleKeyValueToUrl(`User Id=${user};Data Source=${source}`),
        ),
        sslMode: "prefer",
        ssh: null,
        tags: [],
        favorite: /^true$/i.test(tag(block, "Favorite")),
        color: null,
        schemas: null,
      };
    } catch (caught) {
      return `${user}@${source}: ${caught instanceof Error ? caught.message : String(caught)}`;
    }
  });
}
