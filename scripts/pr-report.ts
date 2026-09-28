import { readFile } from "node:fs/promises";

export const REPORT_MARKER = "<!-- l8db-check-report:v1 -->";

export interface CheckReport {
  format: 1;
  passed: boolean;
  checks: Array<{
    id: string;
    kind: string;
    status: "passed" | "failed" | "error";
    message: string;
    totalCost?: number | null;
    seqScans?: number | null;
    indexSuggestions?: Array<{
      schema: string;
      table: string;
      column: string;
      estimatedTableRows: number;
      estimatedResultRows: number;
      sql: string;
    }>;
  }>;
}

export interface PublishOptions {
  provider: "github" | "gitlab";
  repository: string;
  number: number;
  token: string;
  apiBase?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cell(value: string): string {
  return escapeHtml(value.replace(/([\\`*_{}[\]()#+.!-])/g, "\\$1"))
    .replace(/\|/g, "&#124;")
    .replace(/\r?\n/g, " ");
}

export function parseReport(value: unknown): CheckReport {
  if (!value || typeof value !== "object") throw new Error("Ungültiger Prüfbericht.");
  const report = value as CheckReport;
  if (
    report.format !== 1 ||
    typeof report.passed !== "boolean" ||
    !Array.isArray(report.checks) ||
    !report.checks.length ||
    report.checks.length > 100
  ) {
    throw new Error("Ungültiger Prüfbericht.");
  }
  for (const check of report.checks) {
    if (
      !check ||
      typeof check.id !== "string" ||
      !["scalar_equals", "plan"].includes(check.kind) ||
      typeof check.message !== "string" ||
      !["passed", "failed", "error"].includes(check.status) ||
      (check.totalCost != null &&
        (typeof check.totalCost !== "number" || !Number.isFinite(check.totalCost))) ||
      (check.seqScans != null && (!Number.isSafeInteger(check.seqScans) || check.seqScans < 0))
    ) {
      throw new Error("Ungültige Prüfung im Bericht.");
    }
    if (
      check.indexSuggestions !== undefined &&
      (!Array.isArray(check.indexSuggestions) ||
        check.indexSuggestions.some(
          (item) =>
            !item ||
            typeof item.schema !== "string" ||
            typeof item.table !== "string" ||
            typeof item.column !== "string" ||
            typeof item.sql !== "string" ||
            !Number.isFinite(item.estimatedTableRows) ||
            !Number.isFinite(item.estimatedResultRows),
        ))
    ) {
      throw new Error("Ungültiger Indexkandidat im Bericht.");
    }
  }
  if (report.passed !== report.checks.every((check) => check.status === "passed")) {
    throw new Error("Bericht und Prüfergebnisse widersprechen sich.");
  }
  return report;
}

export function renderReport(report: CheckReport): string {
  const rows = report.checks.map((check) => {
    const metrics =
      check.kind === "plan"
        ? `Kosten: ${check.totalCost ?? "?"}; Seq Scans: ${check.seqScans ?? "?"}; Indexkandidaten: ${check.indexSuggestions?.length ?? 0}`
        : check.message;
    const status = check.status === "passed" ? "✅" : check.status === "failed" ? "❌" : "⚠️";
    return `| ${status} | ${cell(check.id)} | ${cell(metrics)} |`;
  });
  const advice = report.checks
    .flatMap((check) => (check.indexSuggestions ?? []).map((item) => ({ id: check.id, ...item })))
    .slice(0, 20);
  const recommendations = advice.length
    ? `\n### Indexkandidaten\n\n${advice.map((item) => `- **${cell(item.id)}:** ${cell(`${item.schema}.${item.table}.${item.column}`)}; geschätzt ${item.estimatedResultRows.toLocaleString("de-DE")} von ${item.estimatedTableRows.toLocaleString("de-DE")} Zeilen. Vorschlag zur manuellen Prüfung: <code>${escapeHtml(item.sql).replace(/\r?\n/g, " ")}</code>`).join("\n")}\n`
    : "";
  const body = `${REPORT_MARKER}\n## l8db Prüfbericht ${report.passed ? "✅" : "❌"}\n\n| Ergebnis | Prüfung | Befund |\n| --- | --- | --- |\n${rows.join("\n")}\n${recommendations}\nIndexvorschläge sind Hinweise aus Schätzungen und vorhandenen Metadaten. l8db führt die DDL nicht aus.\n`;
  if (body.length > 60_000) throw new Error("Prüfbericht ist für einen PR-Kommentar zu groß.");
  return body;
}

function apiBase(options: PublishOptions): URL {
  const raw =
    options.apiBase ??
    (options.provider === "github" ? "https://api.github.com" : "https://gitlab.com/api/v4");
  const base = new URL(raw);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.protocol !== "https:" && !(local && base.protocol === "http:")) {
    throw new Error("Die API-Adresse muss HTTPS verwenden.");
  }
  if (base.username || base.password || base.search || base.hash)
    throw new Error("Ungültige API-Adresse.");
  return base;
}

function paths(options: PublishOptions): { list: string; update: (id: number) => string } {
  if (options.provider === "github") {
    const parts = options.repository.split("/");
    if (parts.length !== 2 || parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error("GitHub-Repository als owner/repo angeben.");
    }
    const [owner, repo] = parts.map(encodeURIComponent);
    return {
      list: `/repos/${owner}/${repo}/issues/${options.number}/comments`,
      update: (id) => `/repos/${owner}/${repo}/issues/comments/${id}`,
    };
  }
  if (!options.repository.trim()) throw new Error("GitLab-Projekt fehlt.");
  const project = encodeURIComponent(options.repository);
  const path = `/projects/${project}/merge_requests/${options.number}/notes`;
  return { list: path, update: (id) => `${path}/${id}` };
}

export async function publishReport(
  report: CheckReport,
  options: PublishOptions,
  fetcher: typeof fetch = fetch,
): Promise<"created" | "updated"> {
  if (!Number.isSafeInteger(options.number) || options.number < 1)
    throw new Error("PR-/MR-Nummer muss positiv sein.");
  if (!options.token) throw new Error("API-Token fehlt.");
  const base = apiBase(options);
  const path = paths(options);
  const body = renderReport(report);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "l8db-pr-report",
    ...(options.provider === "github"
      ? { Authorization: `Bearer ${options.token}` }
      : { "PRIVATE-TOKEN": options.token }),
  };
  const request = async (method: string, pathname: string, data?: unknown): Promise<Response> => {
    const url = new URL(`${base.pathname.replace(/\/$/, "")}${pathname}`, base.origin);
    const response = await fetcher(url, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new Error(
        `${options.provider} API: HTTP ${response.status} bei ${method} ${pathname}.`,
      );
    return response;
  };
  const self = (await (await request("GET", "/user")).json()) as { id?: number; login?: string };
  if (options.provider === "github" ? !self.login : !Number.isSafeInteger(self.id)) {
    throw new Error("API-Benutzer konnte nicht bestimmt werden.");
  }
  let existing: number | null = null;
  for (let page = 1; page <= 20; page++) {
    const response = await request("GET", `${path.list}?per_page=100&page=${page}`);
    const notes = (await response.json()) as Array<{
      id: number;
      body: string;
      user?: { login: string };
      author?: { id: number };
    }>;
    if (!Array.isArray(notes)) throw new Error("Unerwartete Kommentarantwort.");
    const own = notes.find(
      (note) =>
        note.body?.includes(REPORT_MARKER) &&
        (options.provider === "github"
          ? note.user?.login === self.login
          : note.author?.id === self.id),
    );
    if (own) {
      existing = own.id;
      break;
    }
    if (notes.length < 100) break;
    if (page === 20)
      throw new Error(
        "Kommentargrenze erreicht; bestehender Bericht konnte nicht sicher gesucht werden.",
      );
  }
  if (existing !== null) {
    await request(options.provider === "github" ? "PATCH" : "PUT", path.update(existing), { body });
    return "updated";
  }
  await request("POST", path.list, { body });
  return "created";
}

function parseArgs(args: string[]): {
  options: Omit<PublishOptions, "token">;
  reportPath: string;
  tokenEnv: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value || values.has(flag))
      throw new Error(
        "Aufruf: bun run pr:report -- --provider github|gitlab --repository owner/repo --number N --report report.json --token-env TOKEN_NAME [--api-base URL]",
      );
    values.set(flag, value);
  }
  const allowed = new Set([
    "--provider",
    "--repository",
    "--number",
    "--report",
    "--token-env",
    "--api-base",
  ]);
  if ([...values.keys()].some((key) => !allowed.has(key))) throw new Error("Unbekanntes Argument.");
  const provider = values.get("--provider");
  const repository = values.get("--repository");
  const reportPath = values.get("--report");
  const tokenEnv = values.get("--token-env");
  const number = Number(values.get("--number"));
  if (
    (provider !== "github" && provider !== "gitlab") ||
    !repository ||
    !reportPath ||
    !tokenEnv ||
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
    throw new Error(
      "Provider, Repository, PR-/MR-Nummer, Bericht und Token-Variable sind erforderlich.",
    );
  }
  if (!/^[A-Z_][A-Z0-9_]*$/.test(tokenEnv)) throw new Error("Ungültiger Name der Token-Variable.");
  return {
    options: { provider, repository, number, apiBase: values.get("--api-base") },
    reportPath,
    tokenEnv,
  };
}

if (import.meta.main) {
  try {
    const { options, reportPath, tokenEnv } = parseArgs(process.argv.slice(2));
    const token = process.env[tokenEnv];
    if (!token) throw new Error(`Token-Variable ${tokenEnv} ist leer.`);
    const report = parseReport(JSON.parse(await readFile(reportPath, "utf8")));
    const result = await publishReport(report, { ...options, token });
    console.log(`PR-Bericht ${result === "created" ? "erstellt" : "aktualisiert"}.`);
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
