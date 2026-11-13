export const REPOSITORY_URL = "https://github.com/Leon-Achteresch/l8db";

export function issueUrl(issue: number): string {
  return `${REPOSITORY_URL}/issues/${issue}`;
}

export function issueDraftUrl(title: string, body: string, labels?: string): string {
  const params = new URLSearchParams({ title, body });
  if (labels) params.set("labels", labels);
  return `${REPOSITORY_URL}/issues/new?${params}`;
}

export async function openExternal(url: string): Promise<boolean> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return true;
  } catch {
    return false;
  }
}
