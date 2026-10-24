(host, log, limit, items) => {
  const stringify = JSON.stringify;
  const isArray = Array.isArray;
  const freeze = Object.freeze;
  const entries = Object.entries;
  const describe = Object.prototype.toString;
  const idents = new WeakSet();
  const isIdent = WeakSet.prototype.has.bind(idents);
  const mark = WeakSet.prototype.add.bind(idents);
  const text = (v) => stringify(v === undefined ? null : v, (k, x) => (typeof x === "bigint" ? String(x) : x)) ?? "null";
  const call = (op, args) => {
    const error = new Error();
    return host(op, stringify(args)).catch((message) => {
      error.name = op === "sql" || op === "query" || op === "explain" ? "SqlError" : "CatalogError";
      error.message = String(message);
      throw error;
    });
  };
  const on = (o) => {
    if (o === undefined || o === null) return {};
    if (typeof o !== "object") throw new TypeError("expected {connection, database}");
    const out = {};
    if (o.connection !== undefined) out.c = String(o.connection);
    if (o.database !== undefined) out.d = String(o.database);
    return out;
  };
  const value = (v, nested) => {
    if (isIdent(v)) {
      if (nested) throw new TypeError("sql: id() is not allowed inside arrays");
      return { i: v.parts };
    }
    if (v === null || v === undefined) return null;
    switch (typeof v) {
      case "string":
        return { s: v };
      case "number":
        if (!Number.isFinite(v)) throw new RangeError(`sql: ${v} is not a finite number`);
        return { n: v };
      case "bigint":
        return { n: String(v) };
      case "boolean":
        return { b: v };
    }
    if (v instanceof Date) {
      if (Number.isNaN(v.getTime())) throw new RangeError("sql: invalid date");
      return { s: v.toISOString() };
    }
    if (isArray(v) && !nested) return { l: v.map((x) => value(x, true)) };
    throw new TypeError(
      `sql: unsupported value ${isArray(v) ? "nested array" : describe.call(v)}; use strings, numbers, booleans, null, dates, arrays or id()`,
    );
  };
  class Ident {
    constructor(parts) {
      this.parts = freeze([...parts]);
      freeze(this);
    }
  }
  const tag = (o) => {
    const run = (strings, ...values) => {
      if (!isArray(strings) || !isArray(strings.raw)) throw new TypeError("sql is a tagged template: sql`SELECT ...`");
      return call("sql", { ...o, parts: [...strings], values: values.map((v) => value(v, false)) });
    };
    run.with = (next) => tag(on(next));
    return freeze(run);
  };
  const pattern = (p) => (p instanceof RegExp ? { re: p.source, i: p.flags.includes("i") } : p);
  const filter = (f) => {
    if (f === undefined || f === null) return {};
    if (typeof f !== "object") throw new TypeError("filter must be an object");
    const out = {};
    for (const [k, v] of entries(f)) if (k !== "c" && k !== "d") out[k] = pattern(v);
    return out;
  };
  const catalogFor = (o) =>
    freeze({
      with: (next) => catalogFor(on(next)),
      schemas: () => call("schemas", o),
      tables: (f) => call("tables", { ...filter(f), ...o }),
      columns: (f) => call("columns", { ...filter(f), ...o }),
      routines: (f) => call("routines", { ...filter(f), ...o }),
      source: (name, lines) => call("source", { ...o, name: String(name), lines: lines === undefined ? "" : String(lines) }),
      grep: (term, f) => call("grep", { ...filter(f), ...o, term: String(term) }),
      references: (table) => call("references", { ...o, table: String(table) }),
      path: (from, to) => call("path", { ...o, from: String(from), to: String(to) }),
    });
  const show = (x) => {
    if (typeof x === "string") return x;
    try {
      return text(x);
    } catch {
      return String(x);
    }
  };
  const print = (...args) => log(args.map(show).join(" "));
  Object.assign(globalThis, {
    sql: tag({}),
    query: (q, o) => {
      const opts = on(o);
      if (o && o.limit !== undefined) opts.limit = Number(o.limit);
      return call("query", { ...opts, text: String(q) });
    },
    explain: (q, o) => call("explain", { ...on(o), text: String(q) }),
    id: (...parts) => {
      if (!parts.length || parts.some((p) => typeof p !== "string" || !p)) throw new TypeError("id() takes one or more non-empty strings");
      const v = new Ident(parts);
      mark(v);
      return v;
    },
    catalog: catalogFor({}),
    console: freeze({ log: print, info: print, warn: print, error: print, debug: print }),
  });
  return async (fn) => {
    if (typeof fn !== "function") throw new TypeError("code must be an async arrow function: async () => { ... }");
    let v = await fn();
    if (typeof v === "string" && v.length > limit) return stringify({ s: v.slice(0, limit), n: v.length });
    let n = null;
    if (isArray(v) && v.length > items) {
      n = v.length;
      v = v.slice(0, items);
    }
    let t = text(v);
    while (t.length > limit && isArray(v) && v.length > 1) {
      if (n === null) n = v.length;
      v = v.slice(0, v.length >> 1);
      t = text(v);
    }
    if (t.length > limit) return stringify({ s: t.slice(0, limit), n: t.length });
    return `{"n":${n},"v":${t}}`;
  };
};
