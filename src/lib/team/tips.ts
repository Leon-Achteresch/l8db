export const MAX_TEAM_TIPS = 20;
const TIP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FEATURE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface TeamTip {
  id: string;
  title: string;
  body: string;
  featureId?: string;
  until?: string;
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? [...text].slice(0, max).join("") : null;
}

export function teamTipEnd(until: string): number {
  const date = DATE_ONLY.exec(until);
  if (date) {
    const [year, month, day] = [Number(date[1]), Number(date[2]) - 1, Number(date[3])];
    const start = new Date(year, month, day);
    if (start.getFullYear() !== year || start.getMonth() !== month || start.getDate() !== day)
      return Number.NaN;
    return new Date(year, month, day + 1).getTime();
  }
  return /^\d{4}-\d{2}-\d{2}T/.test(until) ? Date.parse(until) : Number.NaN;
}

export function parseTeamTips(value: unknown): TeamTip[] {
  if (!Array.isArray(value)) return [];
  const tips: TeamTip[] = [];
  const ids = new Set<string>();
  for (const raw of value.slice(0, MAX_TEAM_TIPS * 4)) {
    if (tips.length >= MAX_TEAM_TIPS) break;
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = clip(item.id, 64);
    const title = clip(item.title, 80);
    const body = clip(item.body, 600);
    if (!id || !TIP_ID.test(id) || ids.has(id) || !title || !body) continue;
    const tip: TeamTip = { id, title, body };
    const featureId = clip(item.featureId, 80);
    if (featureId && FEATURE_ID.test(featureId)) tip.featureId = featureId;
    const until = clip(item.until, 40);
    if (until !== null) {
      if (!Number.isFinite(teamTipEnd(until))) continue;
      tip.until = until;
    }
    ids.add(id);
    tips.push(tip);
  }
  return tips;
}

export function activeTeamTips(value: unknown, now = Date.now()): TeamTip[] {
  return parseTeamTips(value).filter((tip) => !tip.until || teamTipEnd(tip.until) > now);
}
