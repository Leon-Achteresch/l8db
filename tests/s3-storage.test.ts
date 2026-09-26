import { describe, expect, test } from "bun:test";
import {
  basename,
  breadcrumbs,
  emptyLifecycleRule,
  encryptionXml,
  legalHoldXml,
  lifecycleXml,
  objectLockXml,
  parentPrefix,
  parseCsv,
  parseEncryption,
  parseLegalHold,
  parseLifecycle,
  parseObjectLock,
  parseRetention,
  parseS3Xml,
  parseTags,
  parseVersioning,
  policyPreset,
  previewKind,
  retentionXml,
  selectFormat,
  tagsXml,
  textOf,
  versioningXml,
} from "@/lib/storage/s3";

describe("s3 xml helpers", () => {
  test("parses namespaced xml with entities and cdata", () => {
    const root = parseS3Xml(
      '<?xml version="1.0"?><R xmlns="x"><Key>a &amp; b &#34;q&#34;</Key><C><![CDATA[<raw>]]></C><E/></R>',
    );
    expect(root?.name).toBe("R");
    expect(textOf(root, "Key")).toBe('a & b "q"');
    expect(textOf(root, "C")).toBe("<raw>");
    expect(root?.children.map((c) => c.name)).toEqual(["Key", "C", "E"]);
  });

  test("round-trips tags", () => {
    const xml = tagsXml([
      { key: "env", value: "lab <1>" },
      { key: " ", value: "ignored" },
    ]);
    expect(parseTags(xml)).toEqual([{ key: "env", value: "lab <1>" }]);
    expect(parseTags(null)).toEqual([]);
  });

  test("reads versioning status", () => {
    expect(parseVersioning(versioningXml("Enabled"))).toBe("Enabled");
    expect(parseVersioning('<VersioningConfiguration xmlns="x"/>')).toBe("Off");
    expect(parseVersioning(null)).toBe("Off");
  });

  test("round-trips lifecycle rules and keeps unknown parts", () => {
    const rule = { ...emptyLifecycleRule(0), prefix: "tmp/", noncurrentDays: 3 };
    const parsed = parseLifecycle(lifecycleXml([rule]));
    expect(parsed[0]).toMatchObject({
      id: "rule-1",
      enabled: true,
      prefix: "tmp/",
      expirationDays: 30,
      noncurrentDays: 3,
      abortMultipartDays: 7,
    });
    const foreign = parseLifecycle(
      "<LifecycleConfiguration><Rule><ID>x</ID><Status>Disabled</Status><Filter><And><Prefix>p/</Prefix></And></Filter><NoncurrentVersionTransition><StorageClass>GLACIER</StorageClass></NoncurrentVersionTransition></Rule></LifecycleConfiguration>",
    );
    expect(foreign[0].prefix).toBe("p/");
    expect(foreign[0].enabled).toBe(false);
    expect(lifecycleXml(foreign)).toContain("<NoncurrentVersionTransition>");
  });

  test("builds retention, legal hold, object lock and encryption", () => {
    const retention = retentionXml("GOVERNANCE", new Date("2030-01-02T03:04:05.678Z"));
    expect(retention).toContain("<RetainUntilDate>2030-01-02T03:04:05Z</RetainUntilDate>");
    expect(parseRetention(retention)).toEqual({
      mode: "GOVERNANCE",
      until: "2030-01-02T03:04:05Z",
    });
    expect(parseLegalHold(legalHoldXml(true))).toBe(true);
    expect(parseLegalHold(legalHoldXml(false))).toBe(false);
    const lock = { enabled: true, mode: "COMPLIANCE" as const, days: 5, years: null };
    expect(parseObjectLock(objectLockXml(lock))).toEqual(lock);
    expect(objectLockXml({ enabled: true, mode: "", days: null, years: null })).not.toContain(
      "<Rule>",
    );
    expect(parseEncryption(encryptionXml({ algorithm: "aws:kms", kmsKeyId: "k1" }))).toEqual({
      algorithm: "aws:kms",
      kmsKeyId: "k1",
    });
  });

  test("builds policy presets", () => {
    expect(policyPreset("b", "private")).toBeNull();
    const read = JSON.parse(policyPreset("b", "public-read", "pub/") ?? "{}");
    expect(read.Statement).toHaveLength(1);
    expect(read.Statement[0].Resource).toEqual(["arn:aws:s3:::b/pub/*"]);
    const rw = JSON.parse(policyPreset("b", "public-read-write") ?? "{}");
    expect(rw.Statement[0].Action).toContain("s3:ListBucket");
    expect(rw.Statement[1].Action).toContain("s3:PutObject");
  });
});

describe("s3 key helpers", () => {
  test("splits keys", () => {
    expect(basename("a/b/c.txt")).toBe("c.txt");
    expect(basename("a/b/")).toBe("b");
    expect(parentPrefix("a/b/c.txt")).toBe("a/b/");
    expect(parentPrefix("a/")).toBe("");
    expect(breadcrumbs("a/b/")).toEqual([
      { label: "a", prefix: "a/" },
      { label: "b", prefix: "a/b/" },
    ]);
  });

  test("classifies previews and select formats", () => {
    expect(previewKind("x.png", null)).toBe("image");
    expect(previewKind("x", "application/json")).toBe("json");
    expect(previewKind("x.csv", "application/octet-stream")).toBe("csv");
    expect(previewKind("x.svg", "image/svg+xml")).toBe("text");
    expect(previewKind("x.bin", "application/octet-stream")).toBe("binary");
    expect(selectFormat("a/b.csv.gz")).toBe("csv");
    expect(selectFormat("a.parquet")).toBe("parquet");
    expect(selectFormat("a.png")).toBeNull();
  });

  test("parses csv with quotes", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\r\n3,4')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["3", "4"],
    ]);
  });
});
