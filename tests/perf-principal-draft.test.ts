import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { MAX_GRANT_ROWS } from "../src/features/users/principal-view/object-privileges";
import {
  changeCount,
  changeOf,
  draftOf,
  emptyDetail,
} from "../src/features/users/principal-view/principal-draft";
import type { ObjectGrant, PrincipalDetail } from "../src/lib/db";

test("a principal with 5,000 object grants and 2,000 roles diffs within one frame budget", async () => {
  const objectGrants = 5_000;
  const roles = 2_000;
  const detail: PrincipalDetail = {
    ...emptyDetail("user", "APP"),
    roles: Array.from({ length: roles }, (_, index) => ({
      name: `ROLE_${index}`,
      admin: index % 7 === 0,
      default: true,
    })),
    system_privileges: Array.from({ length: 250 }, (_, index) => ({
      name: `PRIVILEGE ${index}`,
      admin: false,
    })),
    object_privileges: Array.from(
      { length: objectGrants },
      (_, index): ObjectGrant => ({
        owner: `OWNER_${index % 40}`,
        object: `OBJECT_${Math.floor(index / 4)}`,
        object_type: "TABLE",
        privilege: ["SELECT", "INSERT", "UPDATE", "DELETE"][index % 4],
        column: null,
        grantable: index % 11 === 0,
        grantor: "SYS",
      }),
    ),
  };
  const untouched = draftOf(detail);
  const edited = draftOf(detail);
  edited.objectPrivileges = detail.object_privileges
    .filter((_, index) => index % 10 !== 0)
    .map((item, index) => (index % 25 === 0 ? { ...item, grantable: !item.grantable } : item));
  edited.roles = Object.fromEntries(
    Object.entries(edited.roles).filter((_, index) => index % 5 !== 0),
  );

  let count = 0;
  const timing = await measureScenario(() => {
    count = changeCount(changeOf(detail, edited));
  }, 30);
  const rolesOnly = { ...untouched, roles: edited.roles };
  const rolesTiming = await measureScenario(() => {
    changeOf(detail, rolesOnly);
  }, 30);
  const change = changeOf(detail, edited);
  const payloadBytes = JSON.stringify(change).length;

  expect(changeCount(changeOf(detail, untouched))).toBe(0);
  expect(change.revoke_roles).toHaveLength(roles / 5);
  expect(change.revoke_object_privileges?.length ?? 0).toBeGreaterThanOrEqual(objectGrants / 10);
  expect(count).toBe(changeCount(change));
  expect(timing.p95Ms).toBeLessThan(16);
  expect(rolesTiming.p95Ms).toBeLessThan(4);
  expect(payloadBytes).toBeLessThan(400_000);
  expect(MAX_GRANT_ROWS).toBeLessThanOrEqual(300);
  await reportScenario("principal-draft", {
    ...timing,
    objectGrants,
    roles,
    changes: count,
    rolesOnlyP95Ms: rolesTiming.p95Ms,
    payloadBytes,
    renderedRowLimit: MAX_GRANT_ROWS,
    databaseRequests: 0,
    limits: { p95Ms: 16, rolesOnlyP95Ms: 4, payloadBytes: 400_000, renderedRowLimit: 300 },
  });
});
