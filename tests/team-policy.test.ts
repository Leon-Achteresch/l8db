import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const admx = readFileSync("packaging/windows-policy/l8db.admx", "utf8");

test("the ADMX template writes exactly the registry values l8db reads", () => {
  const values = new Set([...admx.matchAll(/valueName="([^"]+)"/g)].map((match) => match[1]));
  expect([...values].sort()).toEqual(
    [
      "AllowedHosts",
      "HubUrl",
      "Microsoft",
      "MicrosoftClientId",
      "MicrosoftScope",
      "MicrosoftSiteUrl",
      "MicrosoftTenant",
    ].sort(),
  );
  expect(admx).toContain('key="Software\\Policies\\l8db"');
});

test("every language file defines every string and presentation the ADMX references", () => {
  const strings = [...admx.matchAll(/\$\(string\.([^)]+)\)/g)].map((match) => match[1]);
  const presentations = [...admx.matchAll(/\$\(presentation\.([^)]+)\)/g)].map((match) => match[1]);
  for (const language of ["de-DE", "en-US"]) {
    const adml = readFileSync(`packaging/windows-policy/${language}/l8db.adml`, "utf8");
    for (const id of strings) expect(adml).toContain(`<string id="${id}">`);
    for (const id of presentations) expect(adml).toContain(`<presentation id="${id}">`);
  }
});
