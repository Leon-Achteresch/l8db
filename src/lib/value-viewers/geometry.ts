import { decodeBinaryValue, hexToBytes } from "./binary";

export type Position = number[];

export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };

export type GeometryFormat = "wkb" | "ewkb" | "mysql" | "mssql" | "wkt" | "geojson";

export type ParsedGeometry = {
  geometry: Geometry;
  srid: number | null;
  format: GeometryFormat;
  hasZ: boolean;
  hasM: boolean;
};

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const TYPE_NAMES = [
  "",
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
  "GeometryCollection",
] as const;

const GEOMETRY_TYPE =
  /^(?:geometry|geography|st_geometry|sdo_geometry|(?:multi)?(?:point|linestring|polygon)|geometrycollection|geomcollection)\b/;

export function isGeometryDataType(dataType?: string | null): boolean {
  if (!dataType) return false;
  const lower = dataType.toLowerCase().trim();
  return (
    GEOMETRY_TYPE.test(lower) || lower.startsWith("geometry(") || lower.startsWith("geography(")
  );
}

class WkbReader {
  offset = 0;
  private view: DataView;

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining() {
    return this.bytes.length - this.offset;
  }

  need(count: number) {
    if (this.remaining < count) throw new Error("WKB ist unvollständig.");
  }

  u8() {
    this.need(1);
    return this.bytes[this.offset++];
  }

  u32(little: boolean) {
    this.need(4);
    const value = this.view.getUint32(this.offset, little);
    this.offset += 4;
    return value;
  }

  i32(little: boolean) {
    this.need(4);
    const value = this.view.getInt32(this.offset, little);
    this.offset += 4;
    return value;
  }

  f64(little: boolean) {
    this.need(8);
    const value = this.view.getFloat64(this.offset, little);
    this.offset += 8;
    return value;
  }
}

type WkbHeader = { srid: number | null; hasZ: boolean; hasM: boolean; extended: boolean };

function readWkb(reader: WkbReader, header: WkbHeader, depth = 0): Geometry {
  if (depth > 32) throw new Error("WKB ist zu tief verschachtelt.");
  const order = reader.u8();
  if (order > 1) throw new Error("Ungültige Byte-Reihenfolge im WKB.");
  const little = order === 1;
  const raw = reader.u32(little);
  let hasZ = (raw & 0x80000000) !== 0;
  let hasM = (raw & 0x40000000) !== 0;
  if (raw & 0x20000000) {
    header.srid = reader.u32(little);
    header.extended = true;
  }
  if (hasZ || hasM) header.extended = true;
  let code = raw & 0x0fffffff;
  if (code > 1000) {
    const dims = Math.floor(code / 1000);
    code %= 1000;
    hasZ = hasZ || dims === 1 || dims === 3;
    hasM = hasM || dims === 2 || dims === 3;
  }
  header.hasZ ||= hasZ;
  header.hasM ||= hasM;
  const size = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);
  const point = (): Position => {
    const out: Position = [];
    for (let i = 0; i < size; i++) out.push(reader.f64(little));
    return out;
  };
  const count = (itemBytes: number) => {
    const n = reader.u32(little);
    if (n * itemBytes > reader.remaining) throw new Error("WKB ist unvollständig.");
    return n;
  };
  const points = () => {
    const n = count(size * 8);
    const out: Position[] = [];
    for (let i = 0; i < n; i++) out.push(point());
    return out;
  };
  const rings = () => {
    const n = count(4);
    const out: Position[][] = [];
    for (let i = 0; i < n; i++) out.push(points());
    return out;
  };
  const children = <T extends Geometry["type"]>(expected: T) => {
    const n = count(5);
    const out: Geometry[] = [];
    for (let i = 0; i < n; i++) {
      const child = readWkb(reader, header, depth + 1);
      if (expected !== "GeometryCollection" && child.type !== expected)
        throw new Error("Unerwarteter Teilgeometrie-Typ im WKB.");
      out.push(child);
    }
    return out;
  };
  switch (code) {
    case 1: {
      const p = point();
      return { type: "Point", coordinates: p.every(Number.isNaN) ? [] : p };
    }
    case 2:
      return { type: "LineString", coordinates: points() };
    case 3:
      return { type: "Polygon", coordinates: rings() };
    case 4:
      return {
        type: "MultiPoint",
        coordinates: children("Point").map((g) => (g as { coordinates: Position }).coordinates),
      };
    case 5:
      return {
        type: "MultiLineString",
        coordinates: children("LineString").map(
          (g) => (g as { coordinates: Position[] }).coordinates,
        ),
      };
    case 6:
      return {
        type: "MultiPolygon",
        coordinates: children("Polygon").map(
          (g) => (g as { coordinates: Position[][] }).coordinates,
        ),
      };
    case 7:
      return { type: "GeometryCollection", geometries: children("GeometryCollection") };
    default:
      throw new Error(`WKB-Geometrietyp ${code} wird nicht unterstützt.`);
  }
}

export function parseWkb(bytes: Uint8Array): ParsedGeometry {
  const reader = new WkbReader(bytes);
  const header: WkbHeader = { srid: null, hasZ: false, hasM: false, extended: false };
  const geometry = readWkb(reader, header);
  if (reader.remaining !== 0) throw new Error("WKB enthält überzählige Bytes.");
  return {
    geometry,
    srid: header.srid,
    format: header.extended ? "ewkb" : "wkb",
    hasZ: header.hasZ,
    hasM: header.hasM,
  };
}

export function parseMysqlGeometry(bytes: Uint8Array): ParsedGeometry {
  if (bytes.length < 9) throw new Error("MySQL-Geometrie ist zu kurz.");
  const srid = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  const parsed = parseWkb(bytes.subarray(4));
  return { ...parsed, srid, format: "mysql" };
}

export function parseMssqlGeometry(bytes: Uint8Array, geography = false): ParsedGeometry {
  const reader = new WkbReader(bytes);
  const srid = reader.i32(true);
  const version = reader.u8();
  if (version !== 1 && version !== 2) throw new Error("Unbekannte SQL-Server-Geometrieversion.");
  const flags = reader.u8();
  const hasZ = (flags & 1) !== 0;
  const hasM = (flags & 2) !== 0;
  const coordinate = (a: number, b: number): Position => (geography ? [b, a] : [a, b]);
  let xy: Position[] = [];
  const readPoints = (n: number) => {
    if (n * 16 > reader.remaining) throw new Error("SQL-Server-Geometrie ist unvollständig.");
    xy = [];
    for (let i = 0; i < n; i++) {
      const a = reader.f64(true);
      const b = reader.f64(true);
      xy.push(coordinate(a, b));
    }
    if (hasZ) for (const p of xy) p.push(reader.f64(true));
    if (hasM) for (const p of xy) p.push(reader.f64(true));
  };
  const finish = (geometry: Geometry): ParsedGeometry => {
    if (reader.remaining !== 0) throw new Error("SQL-Server-Geometrie enthält überzählige Bytes.");
    return { geometry, srid, format: "mssql", hasZ, hasM };
  };
  if (flags & 0x08) {
    readPoints(1);
    return finish({ type: "Point", coordinates: xy[0] });
  }
  if (flags & 0x10) {
    readPoints(2);
    return finish({ type: "LineString", coordinates: xy });
  }
  readPoints(reader.u32(true));
  const figureCount = reader.u32(true);
  const figures: { attribute: number; offset: number }[] = [];
  for (let i = 0; i < figureCount; i++) {
    figures.push({ attribute: reader.u8(), offset: reader.i32(true) });
  }
  const shapeCount = reader.u32(true);
  const shapes: { parent: number; figure: number; type: number }[] = [];
  for (let i = 0; i < shapeCount; i++) {
    shapes.push({ parent: reader.i32(true), figure: reader.i32(true), type: reader.u8() });
  }
  if (version === 2 && reader.remaining > 0) {
    const segments = reader.u32(true);
    reader.need(segments);
    reader.offset += segments;
  }
  const figurePoints = (index: number) =>
    xy.slice(figures[index].offset, figures[index + 1]?.offset ?? xy.length);
  const figureRange = (index: number): [number, number] => {
    const start = shapes[index].figure;
    if (start < 0) return [0, 0];
    for (let k = index + 1; k < shapes.length; k++) {
      if (shapes[k].figure >= 0) return [start, shapes[k].figure];
    }
    return [start, figures.length];
  };
  const leafFigures = (index: number) => {
    const [start, end] = figureRange(index);
    const out: Position[][] = [];
    for (let f = start; f < end; f++) out.push(figurePoints(f));
    return out;
  };
  const build = (index: number, depth: number): Geometry => {
    if (depth > 32) throw new Error("SQL-Server-Geometrie ist zu tief verschachtelt.");
    const shape = shapes[index];
    const kids = () =>
      shapes.flatMap((s, i) => (s.parent === index && i !== index ? [build(i, depth + 1)] : []));
    switch (shape.type) {
      case 1: {
        const [first] = leafFigures(index);
        return { type: "Point", coordinates: first?.[0] ?? [] };
      }
      case 2:
        return { type: "LineString", coordinates: leafFigures(index)[0] ?? [] };
      case 3:
        return { type: "Polygon", coordinates: leafFigures(index) };
      case 4:
        return {
          type: "MultiPoint",
          coordinates: kids().flatMap((g) =>
            g.type === "Point" && g.coordinates.length ? [g.coordinates] : [],
          ),
        };
      case 5:
        return {
          type: "MultiLineString",
          coordinates: kids().flatMap((g) => (g.type === "LineString" ? [g.coordinates] : [])),
        };
      case 6:
        return {
          type: "MultiPolygon",
          coordinates: kids().flatMap((g) => (g.type === "Polygon" ? [g.coordinates] : [])),
        };
      case 7:
        return { type: "GeometryCollection", geometries: kids() };
      default:
        throw new Error(`SQL-Server-Geometrietyp ${shape.type} wird nicht unterstützt.`);
    }
  };
  if (!shapes.length) throw new Error("SQL-Server-Geometrie enthält keine Formen.");
  return finish(build(0, 0));
}

type Token = { kind: "word" | "number" | "punct"; text: string };

function tokenizeWkt(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:([A-Za-z]+)|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([(),])|(\S))/y;
  pattern.lastIndex = 0;
  while (pattern.lastIndex < text.length) {
    const match = pattern.exec(text);
    if (!match) break;
    if (match[1]) tokens.push({ kind: "word", text: match[1].toUpperCase() });
    else if (match[2]) tokens.push({ kind: "number", text: match[2] });
    else if (match[3]) tokens.push({ kind: "punct", text: match[3] });
    else if (match[4]) throw new Error(`Unerwartetes Zeichen „${match[4]}“ im WKT.`);
  }
  return tokens;
}

export function parseWkt(input: string): ParsedGeometry {
  let text = input.trim();
  let srid: number | null = null;
  const sridMatch = /^SRID=(\d+);/i.exec(text);
  if (sridMatch) {
    srid = Number(sridMatch[1]);
    text = text.slice(sridMatch[0].length);
  }
  const tokens = tokenizeWkt(text);
  let index = 0;
  let hasZ = false;
  let hasM = false;
  const peek = () => tokens[index];
  const next = () => {
    const token = tokens[index++];
    if (!token) throw new Error("WKT ist unvollständig.");
    return token;
  };
  const expect = (punct: string) => {
    const token = next();
    if (token.text !== punct) throw new Error(`„${punct}“ im WKT erwartet.`);
  };
  const isPunct = (punct: string) => peek()?.kind === "punct" && peek()?.text === punct;
  const position = (): Position => {
    const out: Position = [];
    while (peek()?.kind === "number") out.push(Number(next().text));
    if (out.length < 2) throw new Error("Koordinate im WKT erwartet.");
    return out;
  };
  const list = <T>(item: () => T): T[] => {
    expect("(");
    const out = [item()];
    while (isPunct(",")) {
      index++;
      out.push(item());
    }
    expect(")");
    return out;
  };
  const empty = () => {
    if (peek()?.kind === "word" && peek()?.text === "EMPTY") {
      index++;
      return true;
    }
    return false;
  };
  const multiPoint = () => {
    if (isPunct("(")) {
      index++;
      const p = position();
      expect(")");
      return p;
    }
    return position();
  };
  const geometry = (depth: number): Geometry => {
    if (depth > 32) throw new Error("WKT ist zu tief verschachtelt.");
    const word = next();
    if (word.kind !== "word") throw new Error("Geometrietyp im WKT erwartet.");
    let name = word.text;
    for (const suffix of ["ZM", "Z", "M"]) {
      if (name.length > suffix.length && name.endsWith(suffix)) {
        const base = name.slice(0, -suffix.length);
        if (TYPE_NAMES.some((t) => t.toUpperCase() === base)) {
          name = base;
          hasZ ||= suffix.includes("Z");
          hasM ||= suffix.includes("M");
          break;
        }
      }
    }
    if (peek()?.kind === "word" && ["Z", "M", "ZM"].includes(peek()?.text ?? "")) {
      const dim = next().text;
      hasZ ||= dim.includes("Z");
      hasM ||= dim.includes("M");
    }
    const isEmpty = empty();
    switch (name) {
      case "POINT":
        return { type: "Point", coordinates: isEmpty ? [] : list(position)[0] };
      case "LINESTRING":
        return { type: "LineString", coordinates: isEmpty ? [] : list(position) };
      case "POLYGON":
        return { type: "Polygon", coordinates: isEmpty ? [] : list(() => list(position)) };
      case "MULTIPOINT":
        return { type: "MultiPoint", coordinates: isEmpty ? [] : list(multiPoint) };
      case "MULTILINESTRING":
        return {
          type: "MultiLineString",
          coordinates: isEmpty ? [] : list(() => list(position)),
        };
      case "MULTIPOLYGON":
        return {
          type: "MultiPolygon",
          coordinates: isEmpty ? [] : list(() => list(() => list(position))),
        };
      case "GEOMETRYCOLLECTION":
      case "GEOMCOLLECTION":
        return {
          type: "GeometryCollection",
          geometries: isEmpty ? [] : list(() => geometry(depth + 1)),
        };
      default:
        throw new Error(`WKT-Geometrietyp ${word.text} wird nicht unterstützt.`);
    }
  };
  const result = geometry(0);
  if (index !== tokens.length) throw new Error("WKT enthält überzählige Zeichen.");
  return { geometry: result, srid, format: "wkt", hasZ, hasM };
}

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    (value.length === 0 ||
      (value.length >= 2 && value.every((n) => typeof n === "number" && Number.isFinite(n))))
  );
}

function positions(value: unknown, depth: number): boolean {
  if (!Array.isArray(value)) return false;
  if (depth === 0) return isPosition(value);
  return value.every((item) => positions(item, depth - 1));
}

const DEPTHS: Record<string, number> = {
  Point: 0,
  LineString: 1,
  MultiPoint: 1,
  Polygon: 2,
  MultiLineString: 2,
  MultiPolygon: 3,
};

function geoJsonGeometry(value: unknown, depth = 0): Geometry {
  if (depth > 32 || !value || typeof value !== "object")
    throw new Error("Ungültiges GeoJSON-Objekt.");
  const obj = value as Record<string, unknown>;
  if (obj.type === "Feature") return geoJsonGeometry(obj.geometry, depth + 1);
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return {
      type: "GeometryCollection",
      geometries: obj.features.map((f) => geoJsonGeometry(f, depth + 1)),
    };
  }
  if (obj.type === "GeometryCollection" && Array.isArray(obj.geometries)) {
    return {
      type: "GeometryCollection",
      geometries: obj.geometries.map((g) => geoJsonGeometry(g, depth + 1)),
    };
  }
  const expected = typeof obj.type === "string" ? DEPTHS[obj.type] : undefined;
  if (expected === undefined || !positions(obj.coordinates, expected))
    throw new Error("Ungültige GeoJSON-Geometrie.");
  return { type: obj.type, coordinates: obj.coordinates } as Geometry;
}

function geoJsonSrid(value: Record<string, unknown>): number | null {
  const crs = value.crs as { properties?: { name?: unknown } } | undefined;
  const name = crs?.properties?.name;
  if (typeof name !== "string") return null;
  const match = /(?:EPSG::?|CRS)(\d+)$/i.exec(name);
  return match ? Number(match[1]) : null;
}

function maxDimension(geometry: Geometry): number {
  let max = 2;
  forEachPosition(geometry, (p) => {
    if (p.length > max) max = p.length;
  });
  return max;
}

export function parseGeoJson(value: unknown): ParsedGeometry {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const geometry = geoJsonGeometry(parsed);
  const srid = geoJsonSrid(parsed as Record<string, unknown>);
  return { geometry, srid, format: "geojson", hasZ: maxDimension(geometry) > 2, hasM: false };
}

export function isGeoJsonGeometryObject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") return false;
  if (type === "GeometryCollection")
    return Array.isArray((value as { geometries?: unknown }).geometries);
  if (type === "Feature" || type === "FeatureCollection") return true;
  return type in DEPTHS && Array.isArray((value as { coordinates?: unknown }).coordinates);
}

const WKT_PREFIX =
  /^\s*(?:SRID=\d+;\s*)?(?:POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION|GEOMCOLLECTION)\b/i;

export function looksLikeWkt(value: string): boolean {
  return WKT_PREFIX.test(value);
}

export function looksLikeHexWkb(value: string): boolean {
  return (
    value.length >= 18 &&
    value.length % 2 === 0 &&
    (value.startsWith("00") || value.startsWith("01")) &&
    /^[0-9a-fA-F]+$/.test(value)
  );
}

const EWKB_HEX_PREFIX = /^(?:010[1-7]0000[02468ace]0|00[02468ace]000000[1-7])/i;

export function looksLikeEwkbHexPrefix(value: string): boolean {
  return value.length >= 42 && value.length % 2 === 0 && EWKB_HEX_PREFIX.test(value.slice(0, 10));
}

export function parseGeometryBytes(bytes: Uint8Array, dataType?: string | null): ParsedGeometry {
  const lower = dataType?.toLowerCase() ?? "";
  const attempts: (() => ParsedGeometry)[] = [
    () => parseWkb(bytes),
    () => parseMysqlGeometry(bytes),
    () => parseMssqlGeometry(bytes, lower.includes("geography")),
  ];
  let firstError: unknown = null;
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError instanceof Error ? firstError : new Error("Keine gültige Geometrie.");
}

export function parseGeometryValue(value: unknown, dataType?: string | null): ParsedGeometry {
  if (value === null || value === undefined) throw new Error("NULL ist keine Geometrie.");
  if (typeof value === "object") return parseGeoJson(value);
  if (typeof value !== "string") throw new Error("Keine Geometrie.");
  const text = value.trim();
  if (text.startsWith("{")) return parseGeoJson(text);
  if (looksLikeWkt(text)) return parseWkt(text);
  if (looksLikeHexWkb(text)) {
    const bytes = hexToBytes(text);
    if (bytes) return parseGeometryBytes(bytes, dataType);
  }
  const binary = decodeBinaryValue(text, dataType);
  if (binary) return parseGeometryBytes(binary.bytes, dataType);
  throw new Error("Wert konnte nicht als Geometrie gelesen werden.");
}

export function tryParseGeometry(value: unknown, dataType?: string | null): ParsedGeometry | null {
  try {
    return parseGeometryValue(value, dataType);
  } catch {
    return null;
  }
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(15)));
}

function wktPosition(p: Position): string {
  return p.map(formatNumber).join(" ");
}

function wktBody(geometry: Geometry): string {
  switch (geometry.type) {
    case "Point":
      return geometry.coordinates.length ? `(${wktPosition(geometry.coordinates)})` : "EMPTY";
    case "LineString":
    case "MultiPoint":
      return geometry.coordinates.length
        ? `(${geometry.coordinates.map(wktPosition).join(", ")})`
        : "EMPTY";
    case "Polygon":
    case "MultiLineString":
      return geometry.coordinates.length
        ? `(${geometry.coordinates.map((r) => `(${r.map(wktPosition).join(", ")})`).join(", ")})`
        : "EMPTY";
    case "MultiPolygon":
      return geometry.coordinates.length
        ? `(${geometry.coordinates
            .map((poly) => `(${poly.map((r) => `(${r.map(wktPosition).join(", ")})`).join(", ")})`)
            .join(", ")})`
        : "EMPTY";
    case "GeometryCollection":
      return geometry.geometries.length
        ? `(${geometry.geometries.map((g) => toWkt(g)).join(", ")})`
        : "EMPTY";
  }
}

export function toWkt(geometry: Geometry, dims?: { hasZ: boolean; hasM: boolean }): string {
  const suffix = dims
    ? dims.hasZ && dims.hasM
      ? " ZM"
      : dims.hasZ
        ? " Z"
        : dims.hasM
          ? " M"
          : ""
    : "";
  return `${geometry.type.toUpperCase()}${suffix} ${wktBody(geometry)}`;
}

export function toEwkt(parsed: ParsedGeometry): string {
  const wkt = toWkt(parsed.geometry, parsed);
  return parsed.srid ? `SRID=${parsed.srid};${wkt}` : wkt;
}

export function toGeoJson(geometry: Geometry): string {
  return JSON.stringify(geometry, null, 2);
}

export function forEachPosition(geometry: Geometry, visit: (p: Position) => void): void {
  switch (geometry.type) {
    case "Point":
      if (geometry.coordinates.length) visit(geometry.coordinates);
      return;
    case "LineString":
    case "MultiPoint":
      for (const p of geometry.coordinates) visit(p);
      return;
    case "Polygon":
    case "MultiLineString":
      for (const ring of geometry.coordinates) for (const p of ring) visit(p);
      return;
    case "MultiPolygon":
      for (const poly of geometry.coordinates)
        for (const ring of poly) for (const p of ring) visit(p);
      return;
    case "GeometryCollection":
      for (const g of geometry.geometries) forEachPosition(g, visit);
  }
}

export function geometryBounds(geometries: Geometry[]): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const geometry of geometries) {
    forEachPosition(geometry, ([x, y]) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function countPositions(geometry: Geometry): number {
  let n = 0;
  forEachPosition(geometry, () => {
    n++;
  });
  return n;
}
