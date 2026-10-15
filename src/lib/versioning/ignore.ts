export const IGNORE_PATH = "database/ignore.json";

export interface IgnoreConfiguration {
  format: 1;
  patterns: string[];
}

const TYPES = ["table", "view", "materialized_view", "routine", "procedure", "package", "sequence"];

export function parseIgnore(text: string | null): IgnoreConfiguration {
  if (!text) return { format: 1, patterns: [] };
  const value = JSON.parse(text) as IgnoreConfiguration;
  return validateIgnore(value);
}

export function validateIgnore(value: IgnoreConfiguration): IgnoreConfiguration {
  if (value?.format !== 1 || !Array.isArray(value.patterns) || value.patterns.length > 500)
    throw new Error("Ungültige Ausschlussliste.");
  for (const pattern of value.patterns) {
    const [type, name] = pattern.includes(":") ? pattern.split(":", 2) : [null, pattern];
    if (
      typeof pattern !== "string" ||
      pattern.length > 200 ||
      !name?.trim() ||
      /\s/.test(name) ||
      (type !== null && !TYPES.includes(type))
    )
      throw new Error(
        `Ausschlussmuster „${pattern}“ ist ungültig. Erlaubt sind NAME_* oder typ:NAME_*, etwa view:V_EXP_*.`,
      );
  }
  return value;
}

export function ignoreMatcher(configuration: IgnoreConfiguration) {
  const rules = configuration.patterns.map((pattern) => {
    const [type, name] = pattern.includes(":") ? pattern.split(":", 2) : [null, pattern];
    const source = name
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")
      .replaceAll("?", ".");
    return { type, regex: new RegExp(`^${source}$`, "i") };
  });
  return (type: string, name: string) => {
    const bare = name.replace(/\(.*$/s, "");
    return rules.some(
      (rule) => (rule.type === null || rule.type === type) && rule.regex.test(bare),
    );
  };
}
