export const TEAM_EXAMPLE_FILE = "l8db-verbindungen.json";
export const TEAM_SITE_PLACEHOLDER = "https://firma.sharepoint.com/sites/l8db";

export const TEAM_EXAMPLE = {
  connections: [
    {
      id: "erp-produktion",
      name: "ERP Produktion",
      kind: "mssql",
      connectionString: "mssql://erp.firma.intern:1433/erp?encrypt=true",
      environment: "production",
      readOnly: true,
      tags: [{ name: "ERP", color: "#3b82f6" }],
    },
    {
      id: "reporting",
      name: "Reporting",
      kind: "postgres",
      connectionString: "postgres://bi_leser@reporting.firma.intern:5432/bi",
      sslMode: "verify-full",
      environment: "staging",
      schemas: ["public", "bi"],
    },
    {
      id: "lager-test",
      name: "Lager (Test)",
      kind: "mysql",
      connectionString: "mysql://lager-test.firma.intern:3306/lager",
      environment: "test",
      color: "#22c55e",
    },
  ],
};

export const TEAM_EXAMPLE_JSON = `${JSON.stringify(TEAM_EXAMPLE, null, 2)}\n`;

export function validSiteUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const path = url.pathname.replace(/\/+$/, "");
    return (
      url.protocol === "https:" &&
      !url.href.includes("?") &&
      path.startsWith("/sites/") &&
      path.length > "/sites/".length &&
      /^[A-Za-z0-9/._-]+$/.test(path)
    );
  } catch {
    return false;
  }
}

export function hostPatterns(value: string): string[] {
  return value.split(/[\s;,]+/).filter(Boolean);
}

export function validHostPattern(pattern: string): boolean {
  return /^(\*\.)?[A-Za-z0-9.:-]+$/.test(pattern);
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function policyScript(siteUrl: string, hosts: string[]): string {
  const allowed = hosts.filter(validHostPattern);
  return [
    '$key = "HKLM:\\SOFTWARE\\Policies\\l8db"',
    "if (-not (Test-Path $key)) { New-Item $key -Force | Out-Null }",
    "Set-ItemProperty $key Microsoft 1 -Type DWord",
    ...(validSiteUrl(siteUrl)
      ? [`Set-ItemProperty $key MicrosoftSiteUrl ${quote(siteUrl.trim())}`]
      : []),
    ...(allowed.length ? [`Set-ItemProperty $key AllowedHosts ${quote(allowed.join(";"))}`] : []),
    "",
  ].join("\r\n");
}

export function policyJson(siteUrl: string, hosts: string[]): string {
  const allowed = hosts.filter(validHostPattern);
  const policy = {
    microsoft: validSiteUrl(siteUrl) ? { siteUrl: siteUrl.trim() } : {},
    ...(allowed.length ? { allowedHosts: allowed } : {}),
  };
  return `${JSON.stringify(policy, null, 2)}\n`;
}
