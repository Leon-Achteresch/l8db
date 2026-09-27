import { describe, expect, mock, test } from "bun:test";

function provider(id: string, hosts: string[]) {
  return {
    id,
    name: id,
    group: "Objektspeicher",
    kind: "s3",
    default_port: null,
    file_based: false,
    url_schemes: ["s3"],
    placeholder: "",
    hint: "",
    hosts,
    driver: { type: "builtin" },
    capabilities: { object_storage: true },
    driver_status: { available: true, detail: "", install: [] },
  };
}

const PROVIDERS = [
  provider("minio", []),
  provider("s3", [".amazonaws.com"]),
  provider("r2", [".r2.cloudflarestorage.com"]),
  provider("b2", [".backblazeb2.com"]),
  provider("s3-compatible", []),
];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => (command === "list_providers" ? PROVIDERS : null),
}));

const { loadProviders } = await import("../src/lib/providers");
await loadProviders();
const { detectProvider, kindFromUrl } = await import("../src/lib/connection-url");

const withEndpoint = (endpoint: string) =>
  `s3://key:secret@us-east-1/?endpoint=${encodeURIComponent(endpoint)}`;

describe("S3-Provider-Erkennung", () => {
  test("uses the endpoint host instead of the region", () => {
    expect(kindFromUrl("s3://eu-central-1?profile=default")).toBe("s3");
    expect(detectProvider("s3://eu-central-1?profile=default")).toBe("s3");
    expect(detectProvider(withEndpoint("http://127.0.0.1:9000"))).toBe("minio");
    expect(detectProvider(withEndpoint("https://minio.internal"))).toBe("minio");
    expect(detectProvider(withEndpoint("https://abc.r2.cloudflarestorage.com"))).toBe("r2");
    expect(detectProvider(withEndpoint("https://s3.us-west-004.backblazeb2.com"))).toBe("b2");
    expect(detectProvider(withEndpoint("https://rgw.example.com"))).toBe("s3-compatible");
  });
});
