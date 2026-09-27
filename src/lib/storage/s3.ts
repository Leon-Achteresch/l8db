export interface XmlNode {
  name: string;
  text: string;
  children: XmlNode[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity] ?? match;
  });
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseS3Xml(xml: string): XmlNode | null {
  const root: XmlNode = { name: "", text: "", children: [] };
  const stack: XmlNode[] = [root];
  const token = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)[^>]*?(\/?)>|<[?!][\s\S]*?>|([^<]+)/g;
  for (const match of xml.matchAll(token)) {
    const [, cdata, closing, rawName, selfClosing, text] = match;
    const current = stack[stack.length - 1];
    if (cdata !== undefined) current.text += cdata;
    else if (text !== undefined) current.text += decode(text);
    else if (rawName) {
      const name = rawName.split(":").pop() ?? rawName;
      if (closing) {
        if (stack.length > 1) stack.pop();
      } else {
        const node: XmlNode = { name, text: "", children: [] };
        current.children.push(node);
        if (!selfClosing) stack.push(node);
      }
    }
  }
  const top = root.children[0];
  if (!top) return null;
  const trim = (node: XmlNode) => {
    if (node.children.length) node.text = node.text.trim();
    node.children.forEach(trim);
  };
  trim(top);
  return top;
}

export function child(node: XmlNode | null | undefined, name: string): XmlNode | undefined {
  return node?.children.find((entry) => entry.name === name);
}

export function children(node: XmlNode | null | undefined, name: string): XmlNode[] {
  return node?.children.filter((entry) => entry.name === name) ?? [];
}

export function textOf(node: XmlNode | null | undefined, name: string): string {
  return child(node, name)?.text.trim() ?? "";
}

export interface S3Tag {
  key: string;
  value: string;
}

export function parseTags(xml: string | null): S3Tag[] {
  const root = xml ? parseS3Xml(xml) : null;
  return children(child(root, "TagSet"), "Tag").map((tag) => ({
    key: textOf(tag, "Key"),
    value: textOf(tag, "Value"),
  }));
}

export function tagsXml(tags: S3Tag[]): string {
  const body = tags
    .filter((tag) => tag.key.trim())
    .map(
      (tag) =>
        `<Tag><Key>${escapeXml(tag.key.trim())}</Key><Value>${escapeXml(tag.value)}</Value></Tag>`,
    )
    .join("");
  return `<Tagging><TagSet>${body}</TagSet></Tagging>`;
}

export type VersioningStatus = "Enabled" | "Suspended" | "Off";

export function parseVersioning(xml: string | null): VersioningStatus {
  const status = textOf(xml ? parseS3Xml(xml) : null, "Status");
  return status === "Enabled" || status === "Suspended" ? status : "Off";
}

export function versioningXml(status: "Enabled" | "Suspended"): string {
  return `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>${status}</Status></VersioningConfiguration>`;
}

export interface LifecycleRule {
  id: string;
  enabled: boolean;
  prefix: string;
  expirationDays: number | null;
  noncurrentDays: number | null;
  abortMultipartDays: number | null;
  expiredDeleteMarker: boolean;
  transitionDays: number | null;
  transitionClass: string;
  extra: string;
}

function days(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const KNOWN_RULE_PARTS = new Set([
  "ID",
  "Status",
  "Filter",
  "Prefix",
  "Expiration",
  "NoncurrentVersionExpiration",
  "AbortIncompleteMultipartUpload",
  "Transition",
]);

function serialize(node: XmlNode): string {
  if (!node.children.length) return `<${node.name}>${escapeXml(node.text)}</${node.name}>`;
  return `<${node.name}>${node.children.map(serialize).join("")}</${node.name}>`;
}

export function parseLifecycle(xml: string | null): LifecycleRule[] {
  const root = xml ? parseS3Xml(xml) : null;
  return children(root, "Rule").map((rule) => {
    const filter = child(rule, "Filter");
    const expiration = child(rule, "Expiration");
    const transition = child(rule, "Transition");
    return {
      id: textOf(rule, "ID"),
      enabled: textOf(rule, "Status") === "Enabled",
      prefix:
        textOf(filter, "Prefix") ||
        textOf(child(filter, "And"), "Prefix") ||
        textOf(rule, "Prefix"),
      expirationDays: days(textOf(expiration, "Days")),
      expiredDeleteMarker: textOf(expiration, "ExpiredObjectDeleteMarker") === "true",
      noncurrentDays: days(textOf(child(rule, "NoncurrentVersionExpiration"), "NoncurrentDays")),
      abortMultipartDays: days(
        textOf(child(rule, "AbortIncompleteMultipartUpload"), "DaysAfterInitiation"),
      ),
      transitionDays: days(textOf(transition, "Days")),
      transitionClass: textOf(transition, "StorageClass"),
      extra: rule.children
        .filter((part) => !KNOWN_RULE_PARTS.has(part.name))
        .map(serialize)
        .join(""),
    };
  });
}

export function lifecycleXml(rules: LifecycleRule[]): string {
  const body = rules
    .map((rule, index) => {
      const parts = [
        `<ID>${escapeXml(rule.id.trim() || `rule-${index + 1}`)}</ID>`,
        `<Status>${rule.enabled ? "Enabled" : "Disabled"}</Status>`,
        `<Filter><Prefix>${escapeXml(rule.prefix)}</Prefix></Filter>`,
      ];
      if (rule.expirationDays)
        parts.push(`<Expiration><Days>${rule.expirationDays}</Days></Expiration>`);
      else if (rule.expiredDeleteMarker)
        parts.push(
          "<Expiration><ExpiredObjectDeleteMarker>true</ExpiredObjectDeleteMarker></Expiration>",
        );
      if (rule.transitionDays && rule.transitionClass.trim())
        parts.push(
          `<Transition><Days>${rule.transitionDays}</Days><StorageClass>${escapeXml(rule.transitionClass.trim())}</StorageClass></Transition>`,
        );
      if (rule.noncurrentDays)
        parts.push(
          `<NoncurrentVersionExpiration><NoncurrentDays>${rule.noncurrentDays}</NoncurrentDays></NoncurrentVersionExpiration>`,
        );
      if (rule.abortMultipartDays)
        parts.push(
          `<AbortIncompleteMultipartUpload><DaysAfterInitiation>${rule.abortMultipartDays}</DaysAfterInitiation></AbortIncompleteMultipartUpload>`,
        );
      return `<Rule>${parts.join("")}${rule.extra}</Rule>`;
    })
    .join("");
  return `<LifecycleConfiguration>${body}</LifecycleConfiguration>`;
}

export function emptyLifecycleRule(index: number): LifecycleRule {
  return {
    id: `rule-${index + 1}`,
    enabled: true,
    prefix: "",
    expirationDays: 30,
    noncurrentDays: null,
    abortMultipartDays: 7,
    expiredDeleteMarker: false,
    transitionDays: null,
    transitionClass: "",
    extra: "",
  };
}

export interface Retention {
  mode: "GOVERNANCE" | "COMPLIANCE" | "";
  until: string;
}

export function parseRetention(xml: string | null): Retention {
  const root = xml ? parseS3Xml(xml) : null;
  const mode = textOf(root, "Mode");
  return {
    mode: mode === "GOVERNANCE" || mode === "COMPLIANCE" ? mode : "",
    until: textOf(root, "RetainUntilDate"),
  };
}

export function retentionXml(mode: "GOVERNANCE" | "COMPLIANCE", until: Date): string {
  return `<Retention><Mode>${mode}</Mode><RetainUntilDate>${until.toISOString().replace(/\.\d{3}Z$/, "Z")}</RetainUntilDate></Retention>`;
}

export function parseLegalHold(xml: string | null): boolean {
  return textOf(xml ? parseS3Xml(xml) : null, "Status") === "ON";
}

export function legalHoldXml(on: boolean): string {
  return `<LegalHold><Status>${on ? "ON" : "OFF"}</Status></LegalHold>`;
}

export interface ObjectLockConfig {
  enabled: boolean;
  mode: "GOVERNANCE" | "COMPLIANCE" | "";
  days: number | null;
  years: number | null;
}

export function parseObjectLock(xml: string | null): ObjectLockConfig {
  const root = xml ? parseS3Xml(xml) : null;
  const retention = child(child(root, "Rule"), "DefaultRetention");
  const mode = textOf(retention, "Mode");
  return {
    enabled: textOf(root, "ObjectLockEnabled") === "Enabled",
    mode: mode === "GOVERNANCE" || mode === "COMPLIANCE" ? mode : "",
    days: days(textOf(retention, "Days")),
    years: days(textOf(retention, "Years")),
  };
}

export function objectLockXml(config: ObjectLockConfig): string {
  const period = config.years
    ? `<Years>${config.years}</Years>`
    : config.days
      ? `<Days>${config.days}</Days>`
      : "";
  const rule =
    config.mode && period
      ? `<Rule><DefaultRetention><Mode>${config.mode}</Mode>${period}</DefaultRetention></Rule>`
      : "";
  return `<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled>${rule}</ObjectLockConfiguration>`;
}

export interface EncryptionConfig {
  algorithm: "" | "AES256" | "aws:kms";
  kmsKeyId: string;
}

export function parseEncryption(xml: string | null): EncryptionConfig {
  const root = xml ? parseS3Xml(xml) : null;
  const apply = child(child(root, "Rule"), "ApplyServerSideEncryptionByDefault");
  const algorithm = textOf(apply, "SSEAlgorithm");
  return {
    algorithm: algorithm === "AES256" || algorithm === "aws:kms" ? algorithm : "",
    kmsKeyId: textOf(apply, "KMSMasterKeyID"),
  };
}

export function encryptionXml(config: EncryptionConfig): string {
  const key =
    config.algorithm === "aws:kms" && config.kmsKeyId.trim()
      ? `<KMSMasterKeyID>${escapeXml(config.kmsKeyId.trim())}</KMSMasterKeyID>`
      : "";
  return `<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>${config.algorithm}</SSEAlgorithm>${key}</ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>`;
}

export type PolicyPreset = "private" | "public-read" | "public-read-write" | "public-list";

export function policyPreset(bucket: string, preset: PolicyPreset, prefix = ""): string | null {
  if (preset === "private") return null;
  const resource = `arn:aws:s3:::${bucket}/${prefix}*`;
  const statements: object[] = [];
  if (preset === "public-list" || preset === "public-read-write")
    statements.push({
      Effect: "Allow",
      Principal: { AWS: ["*"] },
      Action: ["s3:ListBucket", "s3:GetBucketLocation"],
      Resource: [`arn:aws:s3:::${bucket}`],
    });
  statements.push({
    Effect: "Allow",
    Principal: { AWS: ["*"] },
    Action:
      preset === "public-read-write"
        ? ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        : ["s3:GetObject"],
    Resource: [resource],
  });
  return JSON.stringify({ Version: "2012-10-17", Statement: statements }, null, 2);
}

export function basename(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

export function parentPrefix(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  const index = trimmed.lastIndexOf("/");
  return index < 0 ? "" : trimmed.slice(0, index + 1);
}

export function breadcrumbs(prefix: string): { label: string; prefix: string }[] {
  const parts = prefix.split("/").filter(Boolean);
  return parts.map((label, index) => ({
    label,
    prefix: `${parts.slice(0, index + 1).join("/")}/`,
  }));
}

export type PreviewKind = "image" | "text" | "json" | "csv" | "pdf" | "binary";

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "log",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "yaml",
  "yml",
  "toml",
  "ini",
  "sql",
  "sh",
  "py",
  "rs",
  "go",
  "java",
  "env",
  "conf",
  "svg",
]);

export function previewKind(key: string, contentType: string | null | undefined): PreviewKind {
  const type = (contentType ?? "").toLowerCase();
  const ext = basename(key).toLowerCase().split(".").pop() ?? "";
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"].includes(ext)) return "image";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (type.includes("json") || ["json", "jsonl", "ndjson", "geojson"].includes(ext)) return "json";
  if (type === "text/csv" || type === "text/tab-separated-values" || ext === "csv" || ext === "tsv")
    return "csv";
  if (
    type.startsWith("text/") ||
    type.includes("xml") ||
    type.includes("yaml") ||
    TEXT_EXTENSIONS.has(ext)
  )
    return "text";
  return "binary";
}

export function selectFormat(key: string): string | null {
  const lower = key.toLowerCase().replace(/\.(gz|bz2)$/, "");
  const ext = lower.split(".").pop() ?? "";
  return ["csv", "tsv", "json", "jsonl", "ndjson", "parquet"].includes(ext) ? ext : null;
}

export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
