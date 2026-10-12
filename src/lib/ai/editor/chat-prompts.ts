import { redactSecrets } from "./redact";

const fence = (sql: string) => `\`\`\`sql\n${redactSecrets(sql.trim())}\n\`\`\``;

export const EXPLAIN_PROMPT =
  "Erkläre diese SQL-Abfrage in einfachen Worten: Was liefert sie, welche Tabellen nutzt sie und worauf sollte man achten? Antworte kurz und führe sie nicht aus.";

export function explainPlanPrompt(sql: string, plan: string): string {
  return `Erkläre diesen Ausführungsplan in einfachen Worten. Wo geht die meiste Zeit verloren und was würde helfen? Antworte kurz.\n\nAbfrage:\n${fence(sql)}\n\nPlan (verdichtet):\n\`\`\`\n${redactSecrets(plan)}\n\`\`\``;
}

export function resultDraft(summary: string, sql?: string): string {
  return `${sql?.trim() ? `Abfrage:\n${fence(sql)}\n\n` : ""}Ergebnis (verdichtet):\n\`\`\`\n${redactSecrets(summary)}\n\`\`\`\n\n`;
}
