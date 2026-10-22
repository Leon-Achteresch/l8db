type Validator = {
  type?: string;
  value?: unknown;
  tableName?: string;
  keys?: unknown;
  values?: { fieldType?: unknown };
};
type Field = { fieldType?: Validator; optional?: boolean };

export function validatorTemplate(validator: unknown, depth = 0): unknown {
  const node = (validator ?? {}) as Validator;
  if (depth > 8) return null;
  switch (node.type) {
    case "object": {
      const fields = (node.value ?? {}) as Record<string, Field>;
      return Object.fromEntries(
        Object.entries(fields)
          .filter(([, field]) => !field.optional)
          .map(([name, field]) => [name, validatorTemplate(field.fieldType, depth + 1)]),
      );
    }
    case "string":
    case "id":
      return "";
    case "bytes":
      return { $bytes: "" };
    case "number":
    case "float64":
      return 0;
    case "bigint":
    case "int64":
      return { $integer: "AAAAAAAAAAA=" };
    case "boolean":
      return false;
    case "array":
      return [];
    case "record":
      return {};
    case "literal":
      return node.value ?? null;
    case "union":
      return Array.isArray(node.value) ? validatorTemplate(node.value[0], depth + 1) : null;
    default:
      return null;
  }
}

export function argsTemplate(validator: unknown): string {
  const value = validatorTemplate(validator);
  return JSON.stringify(value && typeof value === "object" ? value : {}, null, 2);
}

export function describeValidator(validator: unknown, depth = 0): string {
  const node = (validator ?? {}) as Validator;
  if (depth > 8) return "…";
  switch (node.type) {
    case "object": {
      const fields = Object.entries((node.value ?? {}) as Record<string, Field>);
      if (fields.length === 0) return "{}";
      const pad = "  ".repeat(depth + 1);
      const body = fields
        .map(
          ([name, field]) =>
            `${pad}${name}${field.optional ? "?" : ""}: ${describeValidator(field.fieldType, depth + 1)}`,
        )
        .join(",\n");
      return `{\n${body}\n${"  ".repeat(depth)}}`;
    }
    case "id":
      return `Id<"${node.tableName ?? "?"}">`;
    case "array":
      return `Array<${describeValidator(node.value, depth)}>`;
    case "record":
      return `Record<${describeValidator(node.keys, depth)}, ${describeValidator(node.values?.fieldType, depth)}>`;
    case "literal":
      return JSON.stringify(node.value);
    case "union":
      return Array.isArray(node.value)
        ? node.value.map((item) => describeValidator(item, depth)).join(" | ")
        : "union";
    case undefined:
      return "any";
    default:
      return node.type;
  }
}
