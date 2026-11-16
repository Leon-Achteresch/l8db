import type { LifecycleRule } from "@/lib/storage/s3";

export const ARCHIVE_CLASSES = new Set(["GLACIER", "DEEP_ARCHIVE"]);

export const STORAGE_CLASS_LABELS: Record<string, string> = {
  STANDARD: "Standard",
  REDUCED_REDUNDANCY: "Reduzierte Redundanz",
  STANDARD_IA: "Selten genutzt (Standard-IA)",
  ONEZONE_IA: "Selten genutzt, eine Zone (One Zone-IA)",
  INTELLIGENT_TIERING: "Automatisch (Intelligent-Tiering)",
  GLACIER_IR: "Archiv, sofort lesbar (Glacier IR)",
  GLACIER: "Archiv (Glacier)",
  DEEP_ARCHIVE: "Tiefenarchiv (Deep Archive)",
};

export function storageClassLabel(value: string | null | undefined): string {
  if (!value) return "–";
  return STORAGE_CLASS_LABELS[value] ?? value;
}

function wildcard(principal: unknown): boolean {
  if (principal === "*") return true;
  if (!principal || typeof principal !== "object") return false;
  return Object.values(principal).some((entry) =>
    Array.isArray(entry) ? entry.includes("*") : entry === "*",
  );
}

export function isPublicPolicy(text: string): boolean {
  let policy: unknown;
  try {
    policy = JSON.parse(text);
  } catch {
    return false;
  }
  const statements = (policy as { Statement?: unknown })?.Statement;
  const list = Array.isArray(statements) ? statements : statements ? [statements] : [];
  return list.some(
    (statement) =>
      statement &&
      typeof statement === "object" &&
      (statement as { Effect?: unknown }).Effect === "Allow" &&
      wildcard((statement as { Principal?: unknown }).Principal),
  );
}

export function lifecycleDeletions(rules: LifecycleRule[]): string[] {
  return rules
    .filter((rule) => rule.enabled && (rule.expirationDays || rule.noncurrentDays))
    .map((rule) => {
      const scope = rule.prefix ? `„${rule.prefix}“` : "Ganzer Bucket";
      const parts = [
        rule.expirationDays ? `Objekte nach ${rule.expirationDays} Tagen` : "",
        rule.noncurrentDays ? `alte Versionen nach ${rule.noncurrentDays} Tagen` : "",
      ].filter(Boolean);
      return `${scope}: ${parts.join(", ")}`;
    });
}
