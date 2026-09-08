import { expect, test } from "bun:test";
import { isToadExport, parseToadExport } from "../src/lib/toad-import";

const xml = `<ToadOracle>
  <ConnectionHierarchy><DbPlatform name="Oracle"><Connections>
    <Connection type="Oracle">
      <User>
        <![CDATA[SCOTT]]>
      </User>
      <Server>SLTEST</Server>
      <Favorite>True</Favorite>
      <Host/><Sid/><Port/>
    </Connection>
    <Connection type="Oracle">
      <User><![CDATA[DEV]]></User>
      <Server>172.22.4.196:1521/DEVDB</Server>
      <Host>172.22.4.196</Host>
      <Sid>DEVDB</Sid>
      <Port>1521</Port>
      <Favorite>False</Favorite>
    </Connection>
    <Connection type="Oracle"><User/><Server>X</Server></Connection>
  </Connections></DbPlatform></ConnectionHierarchy>
</ToadOracle>`;

test("detects toad export and maps tns alias and direct host", () => {
  expect(isToadExport(xml)).toBe(true);
  expect(isToadExport('{"format":"l8db-connections"}')).toBe(false);
  const [alias, direct, broken] = parseToadExport(xml);
  expect(alias).toMatchObject({
    name: "SCOTT@SLTEST",
    kind: "oracle",
    favorite: true,
    connectionString: "oracle://SCOTT@SLTEST/?connect_string=SLTEST",
  });
  expect(direct).toMatchObject({
    name: "DEV@172.22.4.196:1521/DEVDB",
    connectionString: "oracle://DEV@172.22.4.196:1521/DEVDB",
  });
  expect(typeof broken).toBe("string");
});
