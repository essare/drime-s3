import { describe, expect, test } from "bun:test";
import {
  findWorkspaceIdByName,
  parseWorkspaceCreate,
  parseWorkspaceList,
} from "../../../src/drime/workspace";

describe("parseWorkspaceList", () => {
  test("bare array", () => {
    expect(
      parseWorkspaceList([
        { id: 1, name: "drime-s3" },
        { id: 2, name: "other" },
      ]),
    ).toEqual([
      { id: 1, name: "drime-s3" },
      { id: 2, name: "other" },
    ]);
  });

  test("{ data: [...] }", () => {
    expect(
      parseWorkspaceList({
        data: [{ id: 9, name: "drime-s3" }],
      }),
    ).toEqual([{ id: 9, name: "drime-s3" }]);
  });

  test("filters invalid rows", () => {
    expect(
      parseWorkspaceList([
        { id: "x", name: "a" },
        { id: 3, name: "ok" },
      ]),
    ).toEqual([{ id: 3, name: "ok" }]);
  });
});

describe("parseWorkspaceCreate", () => {
  test("top-level id", () => {
    expect(parseWorkspaceCreate({ id: 7, name: "drime-s3" })).toBe(7);
  });

  test("nested workspace", () => {
    expect(
      parseWorkspaceCreate({
        workspace: { id: 42, name: "drime-s3" },
      }),
    ).toBe(42);
  });
});

describe("findWorkspaceIdByName", () => {
  test("match", () => {
    expect(
      findWorkspaceIdByName(
        [
          { id: 1, name: "a" },
          { id: 2, name: "drime-s3" },
        ],
        "drime-s3",
      ),
    ).toBe(2);
  });
});
