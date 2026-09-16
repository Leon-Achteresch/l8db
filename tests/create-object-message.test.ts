import { describe, expect, it } from "bun:test";
import { createObjectMessage } from "../src/lib/sql-statements";

describe("createObjectMessage", () => {
  it("erkennt CREATE OR REPLACE PACKAGE BODY", () => {
    expect(createObjectMessage("create or replace package body app.pkg is begin null; end;")).toBe(
      "PACKAGE BODY app.pkg erstellt",
    );
  });

  it("erkennt editionable views und Quoted Identifier", () => {
    expect(
      createObjectMessage('CREATE OR REPLACE FORCE EDITIONABLE VIEW "APP"."V1" AS SELECT 1'),
    ).toBe('VIEW "APP"."V1" erstellt');
  });

  it("ignoriert Kommentare vor dem Statement", () => {
    expect(createObjectMessage("-- neu\nCREATE VIEW v AS SELECT 1")).toBe("VIEW v erstellt");
  });

  it("liefert null für andere Statements", () => {
    expect(createObjectMessage("select 1 from dual")).toBeNull();
    expect(createObjectMessage("create table t (id int)")).toBeNull();
  });
});
