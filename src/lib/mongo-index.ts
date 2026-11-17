export interface MongoIndexSpec {
  field: string;
  direction: "1" | "-1" | "text";
  unique: boolean;
  ttl: string;
  name: string;
}

export const EMPTY_MONGO_INDEX: MongoIndexSpec = {
  field: "",
  direction: "1",
  unique: false,
  ttl: "",
  name: "",
};

export function mongoIndexCommand(collection: string, spec: MongoIndexSpec): string {
  const field = spec.field.trim() || "field";
  const direction = spec.direction === "text" ? "text" : Number(spec.direction);
  const ttl = Number.parseInt(spec.ttl, 10);
  const index = {
    key: { [field]: direction },
    name: spec.name.trim() || `${field}_${direction}`,
    ...(spec.unique ? { unique: true } : {}),
    ...(Number.isFinite(ttl) && ttl >= 0 ? { expireAfterSeconds: ttl } : {}),
  };
  return JSON.stringify({ createIndexes: collection, indexes: [index] }, null, 2);
}
