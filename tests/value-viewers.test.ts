import { describe, expect, test } from "bun:test";

import {
  base64ToBytes,
  bytesToBase64,
  bytesToHexLiteral,
  decodeBinaryValue,
  formatByteSize,
  hexDump,
  hexToBytes,
  isBinaryDataType,
} from "../src/lib/value-viewers/binary";
import { analyzeValue, cellValueBadge } from "../src/lib/value-viewers/detect";
import {
  geometryBounds,
  looksLikeEwkbHexPrefix,
  parseGeometryValue,
  parseMssqlGeometry,
  parseWkt,
  toEwkt,
  toWkt,
} from "../src/lib/value-viewers/geometry";
import {
  sniffImageBytes,
  sniffImageHexPrefix,
  sniffImageText,
} from "../src/lib/value-viewers/image";
import {
  compactVectorPreview,
  float32Vector,
  parseVectorValue,
  vectorHistogram,
  vectorStats,
} from "../src/lib/value-viewers/vector";
import { formatXml, looksLikeXml } from "../src/lib/value-viewers/xml";

const PG_POINT = "0101000020E6100000000000000000F03F0000000000000040";
const PG_POLYGON_HOLE =
  "\\x0103000020e61000000200000005000000000000000000000000000000000000000000000000001040000000000000000000000000000010400000000000001040000000000000000000000000000010400000000000000000000000000000000004000000000000000000f03f000000000000f03f0000000000000040000000000000f03f00000000000000400000000000000040000000000000f03f000000000000f03f";
const PG_MULTIPOINT_Z =
  "0104000080020000000101000080000000000000f03f000000000000004000000000000008400101000080000000000000104000000000000014400000000000001840";
const PG_COLLECTION =
  "0107000000020000000101000000000000000000f03f000000000000004001020000000200000000000000000000000000000000000000000000000000f03f000000000000f03f";

function concat(...parts: (number[] | Uint8Array)[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((p) => Array.from(p)));
}

function u32le(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function i32le(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, true);
  return b;
}

function f64le(...values: number[]) {
  const b = new Uint8Array(values.length * 8);
  const view = new DataView(b.buffer);
  values.forEach((v, i) => {
    view.setFloat64(i * 8, v, true);
  });
  return b;
}

describe("binary", () => {
  test("decodes hex literals, BinData and data URLs", () => {
    expect(decodeBinaryValue("\\x000fa5ff")?.bytes).toEqual(Uint8Array.from([0, 15, 165, 255]));
    expect(decodeBinaryValue({ $binary: { base64: "AQID", subType: "00" } })?.bytes).toEqual(
      Uint8Array.from([1, 2, 3]),
    );
    expect(decodeBinaryValue("data:application/octet-stream;base64,AQID")?.bytes).toEqual(
      Uint8Array.from([1, 2, 3]),
    );
    expect(decodeBinaryValue("\\xzz")).toBeNull();
    expect(decodeBinaryValue("AQID")).toBeNull();
    expect(decodeBinaryValue("AQID", "blob")?.bytes).toEqual(Uint8Array.from([1, 2, 3]));
    expect(decodeBinaryValue("0x0102", "varbinary")?.bytes).toEqual(Uint8Array.from([1, 2]));
  });

  test("recognizes binary column types without numeric Oracle types", () => {
    expect(isBinaryDataType("bytea")).toBe(true);
    expect(isBinaryDataType("LONGBLOB")).toBe(true);
    expect(isBinaryDataType("varbinary(max)")).toBe(true);
    expect(isBinaryDataType("RAW(16)")).toBe(true);
    expect(isBinaryDataType("BINARY_DOUBLE")).toBe(false);
    expect(isBinaryDataType("varchar")).toBe(false);
  });

  test("round-trips hex and base64", () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) & 255);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(hexToBytes(bytesToHexLiteral(bytes))).toEqual(bytes);
    expect(bytesToHexLiteral(Uint8Array.from([0xde, 0xad]))).toBe("\\xdead");
  });

  test("formats a hex dump with offset, hex and ASCII columns", () => {
    const lines = hexDump(new TextEncoder().encode("Hallo Welt!\n\u0000abcdefgh"));
    expect(lines).toHaveLength(2);
    expect(lines[0].offset).toBe("00000000");
    expect(lines[0].hex).toBe("48 61 6c 6c 6f 20 57 65  6c 74 21 0a 00 61 62 63");
    expect(lines[0].ascii).toBe("Hallo Welt!..abc");
    expect(lines[1].offset).toBe("00000010");
    expect(lines[1].ascii).toBe("defgh");
    expect(lines[1].hex.length).toBe(lines[0].hex.length);
  });

  test("formats byte sizes", () => {
    expect(formatByteSize(12)).toBe("12 B");
    expect(formatByteSize(1536)).toBe("1,5 KB");
    expect(formatByteSize(5 * 1024 * 1024)).toBe("5 MB");
  });
});

describe("image", () => {
  test("sniffs magic bytes", () => {
    expect(sniffImageBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])?.mime).toBe(
      "image/png",
    );
    expect(sniffImageBytes([0xff, 0xd8, 0xff, 0xe0])?.mime).toBe("image/jpeg");
    expect(sniffImageBytes(new TextEncoder().encode("GIF89a"))?.mime).toBe("image/gif");
    expect(
      sniffImageBytes(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))?.mime,
    ).toBe("image/webp");
    expect(
      sniffImageBytes(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))?.mime,
    ).toBe("image/svg+xml");
    expect(sniffImageBytes([1, 2, 3, 4])).toBeNull();
  });

  test("sniffs hex prefixes and data URLs cheaply", () => {
    expect(sniffImageHexPrefix("\\x89504e470d0a1a0a0000")?.label).toBe("PNG");
    expect(sniffImageHexPrefix("\\x0102")).toBeNull();
    expect(sniffImageText("data:image/png;base64,AAAA")?.label).toBe("PNG");
    expect(sniffImageText('<?xml version="1.0"?><svg></svg>')?.label).toBe("SVG");
  });
});

describe("geometry", () => {
  test("parses PostGIS EWKB hex with SRID", () => {
    const parsed = parseGeometryValue(PG_POINT);
    expect(parsed.format).toBe("ewkb");
    expect(parsed.srid).toBe(4326);
    expect(parsed.geometry).toEqual({ type: "Point", coordinates: [1, 2] });
    expect(toEwkt(parsed)).toBe("SRID=4326;POINT (1 2)");
  });

  test("parses polygons with holes, Z multipoints and collections", () => {
    const polygon = parseGeometryValue(PG_POLYGON_HOLE, "geometry");
    expect(polygon.geometry.type).toBe("Polygon");
    expect(toWkt(polygon.geometry)).toBe(
      "POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0), (1 1, 2 1, 2 2, 1 1))",
    );
    const multi = parseGeometryValue(PG_MULTIPOINT_Z);
    expect(multi.hasZ).toBe(true);
    expect(toWkt(multi.geometry, multi)).toBe("MULTIPOINT Z (1 2 3, 4 5 6)");
    const collection = parseGeometryValue(PG_COLLECTION);
    expect(collection.format).toBe("wkb");
    expect(toWkt(collection.geometry)).toBe(
      "GEOMETRYCOLLECTION (POINT (1 2), LINESTRING (0 0, 1 1))",
    );
    expect(geometryBounds([polygon.geometry, collection.geometry])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 4,
      maxY: 4,
    });
  });

  test("parses MySQL internal geometry (SRID prefix + WKB)", () => {
    const wkb = hexToBytes("0101000000000000000000F03F0000000000000040");
    const bytes = concat(u32le(4326), wkb ?? []);
    const parsed = parseGeometryValue(bytesToHexLiteral(bytes), "geometry");
    expect(parsed.format).toBe("mysql");
    expect(parsed.srid).toBe(4326);
    expect(parsed.geometry).toEqual({ type: "Point", coordinates: [1, 2] });
    const zero = parseGeometryValue(bytesToHexLiteral(concat(u32le(0), wkb ?? [])));
    expect(zero.format).toBe("mysql");
    expect(zero.srid).toBe(0);
  });

  test("parses SQL Server geometry and geography serialization", () => {
    const point = concat(i32le(4326), [1, 0x0c], f64le(1, 2));
    expect(parseMssqlGeometry(point).geometry).toEqual({ type: "Point", coordinates: [1, 2] });
    expect(parseMssqlGeometry(point, true).geometry).toEqual({
      type: "Point",
      coordinates: [2, 1],
    });
    const segment = concat(i32le(0), [1, 0x14], f64le(0, 0, 3, 4));
    expect(parseMssqlGeometry(segment).geometry.type).toBe("LineString");
    const polygon = concat(
      i32le(0),
      [1, 0x04],
      u32le(4),
      f64le(0, 0, 1, 0, 1, 1, 0, 0),
      u32le(1),
      [2],
      i32le(0),
      u32le(1),
      i32le(-1),
      i32le(0),
      [3],
    );
    const parsed = parseGeometryValue(bytesToHexLiteral(polygon), "geometry");
    expect(parsed.format).toBe("mssql");
    expect(toWkt(parsed.geometry)).toBe("POLYGON ((0 0, 1 0, 1 1, 0 0))");
    const multi = concat(
      i32le(0),
      [1, 0x04],
      u32le(2),
      f64le(1, 2, 3, 4),
      u32le(2),
      [1],
      i32le(0),
      [1],
      i32le(1),
      u32le(3),
      i32le(-1),
      i32le(0),
      [4],
      i32le(0),
      i32le(0),
      [1],
      i32le(0),
      i32le(1),
      [1],
    );
    expect(toWkt(parseMssqlGeometry(multi).geometry)).toBe("MULTIPOINT (1 2, 3 4)");
  });

  test("parses WKT variants and GeoJSON", () => {
    expect(parseWkt("SRID=4326;POINT(1 2)").srid).toBe(4326);
    expect(toWkt(parseWkt("MULTIPOINT (1 2, 3 4)").geometry)).toBe("MULTIPOINT (1 2, 3 4)");
    expect(toWkt(parseWkt("MULTIPOINT ((1 2), (3 4))").geometry)).toBe("MULTIPOINT (1 2, 3 4)");
    expect(parseWkt("POINT Z (1 2 3)").hasZ).toBe(true);
    expect(parseWkt("POINTM (1 2 3)").hasM).toBe(true);
    expect(parseWkt("POLYGON EMPTY").geometry).toEqual({ type: "Polygon", coordinates: [] });
    expect(() => parseWkt("POINT (1 2) trailing")).toThrow();
    const geojson = parseGeometryValue({
      crs: { type: "name", properties: { name: "EPSG:4326" } },
      type: "Point",
      coordinates: [1, 2],
    });
    expect(geojson.srid).toBe(4326);
    expect(geojson.format).toBe("geojson");
    expect(() => parseGeometryValue('{"type":"Point","coordinates":"x"}')).toThrow();
  });

  test("detects EWKB hex prefixes without matching arbitrary hashes", () => {
    expect(looksLikeEwkbHexPrefix(PG_POINT)).toBe(true);
    expect(
      looksLikeEwkbHexPrefix("01ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
    ).toBe(false);
  });
});

describe("vector", () => {
  test("parses pgvector, halfvec, sparsevec and float32 blobs", () => {
    expect(Array.from(parseVectorValue("[1,2.5,-3]")?.values ?? [])).toEqual([1, 2.5, -3]);
    const sparse = parseVectorValue("{1:0.5,3:2}/5");
    expect(sparse?.sparse).toBe(true);
    expect(sparse?.dims).toBe(5);
    expect(sparse?.nonZero).toBe(2);
    expect(Array.from(sparse?.values ?? [])).toEqual([0.5, 0, 2, 0, 0]);
    expect(parseVectorValue("[1.0000000e+000,-2.5000000e+000]")?.dims).toBe(2);
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat32(0, 1.5, true);
    new DataView(bytes.buffer).setFloat32(4, -2, true);
    expect(Array.from(float32Vector(bytes)?.values ?? [])).toEqual([1.5, -2]);
    expect(parseVectorValue("[a,b]")).toBeNull();
  });

  test("computes stats and histogram", () => {
    const stats = vectorStats(Float64Array.from([3, 4, 0]));
    expect(stats.norm).toBe(5);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(4);
    expect(stats.nonZero).toBe(2);
    expect(vectorHistogram(Float64Array.from([0, 1, 2, 3]), 2)).toEqual([2, 2]);
  });

  test("renders compact grid previews", () => {
    const long = `[${Array.from({ length: 1536 }, (_, i) => (i === 0 ? "0.1234567" : "0.3")).join(",")}]`;
    expect(compactVectorPreview(long)).toBe("[0.123, 0.3, 0.3, …] (1536d)");
    expect(compactVectorPreview("[1,2]")).toBe("[1, 2] (2d)");
    expect(compactVectorPreview("[]")).toBe("[] (0d)");
    expect(compactVectorPreview("{1:0.5,3:2,4:1,5:1}/5")).toBe("{1:0.5, 3:2, 4:1, …} (5d, 4 ≠0)");
  });
});

describe("xml", () => {
  test("pretty-prints XML", () => {
    expect(formatXml('<?xml version="1.0"?><a x="1"><b>text</b><c/><!-- note --></a>')).toBe(
      [
        '<?xml version="1.0"?>',
        '<a x="1">',
        "  <b>text</b>",
        "  <c/>",
        "  <!-- note -->",
        "</a>",
      ].join("\n"),
    );
    expect(looksLikeXml("<root><a/></root>")).toBe(true);
    expect(looksLikeXml("<3 und mehr")).toBe(false);
  });
});

describe("detection", () => {
  test("chooses viewers from type and content", () => {
    expect(analyzeValue("\\x89504e470d0a1a0a0000").initial).toBe("image");
    expect(analyzeValue(PG_POINT).initial).toBe("geometry");
    expect(analyzeValue({ type: "Point", coordinates: [1, 2] }, "geometry").initial).toBe(
      "geometry",
    );
    expect(analyzeValue("[1,2,3]", "vector").initial).toBe("vector");
    expect(analyzeValue("<a><b/></a>", "xml").initial).toBe("xml");
    expect(analyzeValue("\\x00010203").kinds).toContain("binary");
    expect(analyzeValue("hallo").kinds).toEqual(["text"]);
    expect(analyzeValue(null).initial).toBe("text");
  });

  test("builds cheap grid badges", () => {
    expect(cellValueBadge("\\x89504e470d0a1a0a")?.label).toBe("PNG");
    expect(cellValueBadge("\\x0001")?.title).toBe("Binärdaten · 2 B");
    expect(cellValueBadge(PG_POINT)?.kind).toBe("geometry");
    expect(cellValueBadge("[1,2,3]", "vector")?.text).toBe("[1, 2, 3] (3d)");
    expect(cellValueBadge({ type: "Point", coordinates: [1, 2] })?.kind).toBe("geometry");
    expect(cellValueBadge("text")).toBeNull();
    expect(cellValueBadge(42)).toBeNull();
  });
});
