import { expect, test } from "bun:test";
import { mergeTeamConnections } from "@/lib/team/merge";
import {
  hostPatterns,
  policyJson,
  policyScript,
  TEAM_EXAMPLE,
  TEAM_EXAMPLE_JSON,
  TEAM_SITE_PLACEHOLDER,
  validHostPattern,
  validSiteUrl,
} from "@/lib/team/setup";

test("the downloadable example passes the team rules without warnings", () => {
  const parsed = JSON.parse(TEAM_EXAMPLE_JSON);
  expect(parsed).toEqual(TEAM_EXAMPLE);
  const merge = mergeTeamConnections([], "m365", parsed.connections, ["*.firma.intern"]);
  expect(merge.warnings).toEqual([]);
  expect(merge.added).toBe(3);
  expect(merge.connections.map((connection) => connection.name)).toEqual([
    "ERP Produktion",
    "Reporting",
    "Lager (Test)",
  ]);
});

test("site addresses and host patterns follow the policy rules", () => {
  expect(validSiteUrl("https://firma.sharepoint.com/sites/l8db")).toBe(true);
  expect(validSiteUrl(" https://firma.sharepoint.com/sites/it-l8db/ ")).toBe(true);
  expect(validSiteUrl("https://firma.sharepoint.com:443/sites/l8db")).toBe(true);
  expect(validSiteUrl("http://firma.sharepoint.com/sites/l8db")).toBe(false);
  expect(validSiteUrl("https://firma.sharepoint.com/teams/l8db")).toBe(false);
  expect(validSiteUrl("https://firma.sharepoint.com/sites/l8db?x=1")).toBe(false);
  expect(validSiteUrl("https://firma.sharepoint.com/sites/l8db?")).toBe(false);
  expect(validSiteUrl("https://firma.sharepoint.com/sites//")).toBe(false);
  expect(validSiteUrl("https://firma.sharepoint.com/sites/..")).toBe(false);
  expect(validSiteUrl("https://firma.sharepoint.com/sites/o'l8db")).toBe(false);
  expect(hostPatterns(" *.firma.intern; db01,db02:1433 ")).toEqual([
    "*.firma.intern",
    "db01",
    "db02:1433",
  ]);
  expect(validHostPattern("*.firma.intern")).toBe(true);
  expect(validHostPattern("db01;rm")).toBe(false);
  expect(validHostPattern("*")).toBe(false);
});

test("policy files keep existing values, carry only valid entries and never invent a site", () => {
  const script = policyScript("https://firma.sharepoint.com/sites/l8db", [
    "*.firma.intern",
    "db_02",
    "db01",
  ]);
  expect(script).toContain('$key = "HKLM:\\SOFTWARE\\Policies\\l8db"');
  expect(script).toContain("if (-not (Test-Path $key)) { New-Item $key -Force | Out-Null }");
  expect(script).not.toContain("New-Item -Force $key");
  expect(script).toContain("MicrosoftSiteUrl 'https://firma.sharepoint.com/sites/l8db'");
  expect(script).toContain("AllowedHosts '*.firma.intern;db01'");
  for (const site of ["", TEAM_SITE_PLACEHOLDER.replace("https", "http"), "https://x/sites/o'l8db"])
    expect(policyScript(site, [])).not.toContain("MicrosoftSiteUrl");
  expect(policyScript("", ["db_02"])).not.toContain("AllowedHosts");
  expect(
    JSON.parse(policyJson("https://firma.sharepoint.com/sites/l8db", ["db01", "x y"])),
  ).toEqual({
    microsoft: { siteUrl: "https://firma.sharepoint.com/sites/l8db" },
    allowedHosts: ["db01"],
  });
  expect(JSON.parse(policyJson("kaputt", []))).toEqual({ microsoft: {} });
});
