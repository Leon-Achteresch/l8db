import {
  type DecodedBinary,
  decodeBinaryValue,
  formatByteSize,
  hexBlobByteLength,
  isBinaryDataType,
  isHexBlobText,
} from "./binary";
import {
  isGeoJsonGeometryObject,
  isGeometryDataType,
  looksLikeEwkbHexPrefix,
  looksLikeHexWkb,
  looksLikeWkt,
  type ParsedGeometry,
  tryParseGeometry,
} from "./geometry";
import { type ImageFormat, sniffImageBytes, sniffImageHexPrefix, sniffImageText } from "./image";
import {
  compactVectorPreview,
  isVectorDataType,
  looksLikeVectorText,
  type ParsedVector,
  parseVectorValue,
} from "./vector";
import { isXmlDataType, looksLikeXml } from "./xml";

export type ValueViewerKind = "text" | "binary" | "image" | "geometry" | "xml" | "vector";

export type ValueAnalysis = {
  kinds: ValueViewerKind[];
  initial: ValueViewerKind;
  binary: DecodedBinary | null;
  image: ImageFormat | null;
  geometry: ParsedGeometry | null;
  vector: ParsedVector | null;
  xml: string | null;
};

export const VIEWER_LABELS: Record<ValueViewerKind, string> = {
  text: "Text",
  binary: "Binär",
  image: "Bild",
  geometry: "Karte",
  xml: "XML",
  vector: "Vektor",
};

export function analyzeValue(value: unknown, dataType?: string | null): ValueAnalysis {
  const empty: ValueAnalysis = {
    kinds: ["text"],
    initial: "text",
    binary: null,
    image: null,
    geometry: null,
    vector: null,
    xml: null,
  };
  if (value === null || value === undefined) return empty;
  const binary = decodeBinaryValue(value, dataType);
  const text = typeof value === "string" ? value : null;
  const image = binary
    ? (sniffImageBytes(binary.bytes) ??
      (binary.mime?.startsWith("image/") && text ? sniffImageText(text) : null))
    : text
      ? sniffImageText(text)
      : null;
  const geometryHint =
    isGeometryDataType(dataType) ||
    isGeoJsonGeometryObject(value) ||
    (text !== null && (looksLikeWkt(text) || looksLikeHexWkb(text))) ||
    (binary !== null && binary.source === "hex" && !image);
  const geometry = geometryHint ? tryParseGeometry(value, dataType) : null;
  const vectorTyped = isVectorDataType(dataType);
  const vectorHint =
    vectorTyped ||
    Array.isArray(value) ||
    (text !== null && looksLikeVectorText(text)) ||
    (binary !== null && !image && !geometry);
  const vector = vectorHint ? parseVectorValue(value, dataType) : null;
  const usableVector =
    vector && (vectorTyped || vector.source !== "float32" || !isBinaryDataType(dataType))
      ? vector
      : null;
  const xml =
    text !== null && !image && (isXmlDataType(dataType) || looksLikeXml(text)) ? text : null;
  const kinds: ValueViewerKind[] = [];
  if (image) kinds.push("image");
  if (geometry) kinds.push("geometry");
  if (usableVector && usableVector.dims > 0) kinds.push("vector");
  if (xml) kinds.push("xml");
  if (binary) kinds.push("binary");
  kinds.push("text");
  const initial = image
    ? "image"
    : geometry
      ? "geometry"
      : usableVector &&
          (vectorTyped ||
            usableVector.source === "text" ||
            (usableVector.source === "array" && usableVector.dims >= 16))
        ? "vector"
        : xml
          ? "xml"
          : binary
            ? "binary"
            : "text";
  return { kinds, initial, binary, image, geometry, vector: usableVector, xml };
}

export type CellBadge = {
  kind: "binary" | "image" | "geometry" | "vector" | "xml";
  label: string;
  title: string;
  text?: string;
};

export function cellValueBadge(value: unknown, dataType?: string | null): CellBadge | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if (isGeoJsonGeometryObject(value))
      return { kind: "geometry", label: "GEO", title: "Geometrie (GeoJSON)" };
    if ("$binary" in value) return { kind: "binary", label: "BIN", title: "Binärdaten (BinData)" };
    return null;
  }
  if (typeof value !== "string") return null;
  if (isHexBlobText(value)) {
    const size = formatByteSize(hexBlobByteLength(value));
    if (isGeometryDataType(dataType))
      return { kind: "geometry", label: "GEO", title: `Geometrie · ${size}` };
    const image = sniffImageHexPrefix(value);
    if (image) return { kind: "image", label: image.label, title: `Bild ${image.label} · ${size}` };
    return { kind: "binary", label: "BIN", title: `Binärdaten · ${size}` };
  }
  if (isGeometryDataType(dataType) || looksLikeEwkbHexPrefix(value))
    return { kind: "geometry", label: "GEO", title: "Geometrie" };
  if (isVectorDataType(dataType) || (value.length > 40 && looksLikeVectorText(value))) {
    if (!looksLikeVectorText(value)) return { kind: "vector", label: "VEC", title: "Vektor" };
    const text = compactVectorPreview(value);
    return { kind: "vector", label: "VEC", title: text, text };
  }
  if (isXmlDataType(dataType)) return { kind: "xml", label: "XML", title: "XML" };
  if (value.startsWith("data:image/"))
    return { kind: "image", label: "IMG", title: "Bild (Data-URL)" };
  return null;
}
