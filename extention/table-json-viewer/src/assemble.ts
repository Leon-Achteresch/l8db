import type { Json, TableSnapshot } from "@l8db/extension-api";

export type ColumnMapping = {
  level: string;
  position: string;
  name: string;
  value: string;
  content: string | null;
  group: string | null;
  container: string | null;
};

const ALIASES: Record<keyof ColumnMapping, string[]> = {
  level: ["EBENE", "LEVEL", "DEPTH"],
  position: ["POS_NR", "POSITIONSNUMMER", "POSITION", "POS", "POSITION_NO"],
  name: ["WERT_NAME", "NAME", "KEY", "TAG"],
  value: ["WERT_INHALT", "WERT", "VALUE"],
  content: ["WERT_CLOB", "INHALT", "CONTENT", "CLOB"],
  group: ["REF_KOPF", "DOCUMENT_ID", "HEAD_ID"],
  container: ["SUBTAG"],
};

const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function detectMapping(columns: string[]): ColumnMapping | null {
  const mapping = Object.fromEntries(
    Object.entries(ALIASES).map(([role, aliases]) => [
      role,
      aliases
        .map((alias) => columns.find((column) => normalize(column) === normalize(alias)))
        .find(Boolean) ?? null,
    ]),
  ) as ColumnMapping;
  return mapping.level && mapping.position && mapping.name && mapping.value ? mapping : null;
}

export function validMapping(value: unknown, columns: string[]): value is ColumnMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const mapping = value as Record<string, unknown>;
  return Object.keys(ALIASES).every((role) =>
    ["content", "group", "container"].includes(role) && mapping[role] === null
      ? true
      : typeof mapping[role] === "string" && columns.includes(mapping[role]),
  );
}

type Node = {
  name: string;
  level: number;
  position: number;
  value: string | null;
  container: boolean;
  children: Node[];
};

function integer(value: string | null, role: string, row: number, max = Number.MAX_SAFE_INTEGER) {
  if (value === null || !/^\d+$/.test(value.trim()))
    throw new Error(`Zeile ${row}: ${role} muss eine nicht negative ganze Zahl sein.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > max)
    throw new Error(`Zeile ${row}: ${role} ist zu groß.`);
  return result;
}

function objectFromNodes(nodes: Node[]): Json {
  const grouped = new Map<string, Json[]>();
  for (const node of nodes) {
    const object = node.children.length > 0 || node.container;
    if (object && node.value !== null && node.value !== "")
      throw new Error(
        `„${node.name}“ hat sowohl einen Wert als auch Unterknoten. Bitte die Spaltenzuordnung prüfen.`,
      );
    const value: Json = object ? objectFromNodes(node.children) : node.value;
    const siblings = grouped.get(node.name) ?? [];
    siblings.push(value);
    grouped.set(node.name, siblings);
  }
  return Object.fromEntries(
    [...grouped].map(([name, values]) => [name, values.length === 1 ? values[0] : values]),
  );
}

export function assembleTableJson(
  snapshot: TableSnapshot,
  mapping: ColumnMapping,
): {
  value: Json;
  documents: number;
} {
  if (!validMapping(mapping, snapshot.columns)) throw new Error("Ungültige Spaltenzuordnung.");
  const groups = new Map<string | null, Node[]>();
  snapshot.rows.forEach((row, index) => {
    const name = row[mapping.name];
    if (name === null || name === undefined || name.trim() === "")
      throw new Error(`Zeile ${index + 1}: Der JSON-Name fehlt.`);
    const group = mapping.group ? row[mapping.group] : null;
    const nodes = groups.get(group) ?? [];
    nodes.push({
      name,
      level: integer(row[mapping.level], "Ebene", index + 1, 128),
      position: integer(row[mapping.position], "Position", index + 1),
      value: row[mapping.value] ?? (mapping.content ? row[mapping.content] : null) ?? null,
      container: mapping.container ? Number(row[mapping.container] ?? 0) > 0 : false,
      children: [],
    });
    groups.set(group, nodes);
  });
  const documents: Json[] = [];
  for (const nodes of groups.values()) {
    nodes.sort((left, right) => left.position - right.position);
    const roots: Node[] = [];
    const stack: Node[] = [];
    const baseLevel = nodes.reduce((min, node) => Math.min(min, node.level), 128);
    for (const node of nodes) {
      while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent ? node.level !== parent.level + 1 : node.level !== baseLevel)
        throw new Error(`„${node.name}“: Übergeordneter Knoten für Ebene ${node.level} fehlt.`);
      (parent ? parent.children : roots).push(node);
      stack.push(node);
    }
    documents.push(objectFromNodes(roots));
  }
  return {
    value: documents.length === 0 ? {} : documents.length === 1 ? documents[0] : documents,
    documents: documents.length,
  };
}
