import type { DatabaseKind } from "@/lib/db";

export type AwsAuthMode = "keys" | "profile" | "env";

export const AWS_AUTO_REGION = "auto";

export const AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "sa-east-1",
  "eu-central-1",
  "eu-central-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "me-south-1",
  "me-central-1",
  "il-central-1",
  "af-south-1",
  "ap-east-1",
  "ap-south-1",
  "ap-south-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "cn-north-1",
  "cn-northwest-1",
  "us-gov-west-1",
  "us-gov-east-1",
];

export function isAwsKind(kind: DatabaseKind): boolean {
  return kind === "dynamodb" || kind === "athena";
}

export function awsParam(search: string, key: string): string {
  return new URLSearchParams(search).get(key) ?? "";
}

export function withAwsParam(
  search: string,
  key: string,
  value: string | null,
  keepEmpty = false,
): string {
  const params = new URLSearchParams(search);
  if (value === null || (value.trim() === "" && !keepEmpty)) params.delete(key);
  else params.set(key, value.trim());
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function awsAuthMode(user: string, search: string): AwsAuthMode {
  if (user.trim()) return "keys";
  if (new URLSearchParams(search).has("profile")) return "profile";
  return "env";
}

export function splitAwsSecret(password: string): { secret: string; token: string } {
  const index = password.indexOf(":");
  if (index < 0) return { secret: password, token: "" };
  return { secret: password.slice(0, index), token: password.slice(index + 1) };
}

export function joinAwsSecret(secret: string, token: string): string {
  return token.trim() ? `${secret}:${token.trim()}` : secret;
}
