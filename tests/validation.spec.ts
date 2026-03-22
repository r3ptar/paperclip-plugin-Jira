import { describe, expect, it } from "vitest";
import { isValidJiraId, isValidJiraKey } from "../src/jira/validate-id.js";

describe("isValidJiraId", () => {
  it.each(["10001", "1", "999999"])("accepts valid ID: %s", (id) => {
    expect(isValidJiraId(id)).toBe(true);
  });

  it.each([
    ["empty string", ""],
    ["alphabetic", "abc"],
    ["decimal", "10.001"],
    ["path traversal", "10001/../etc"],
    ["whitespace", " 123 "],
    ["negative", "-5"],
    ["mixed alphanumeric", "12abc"],
    ["special chars", "100!01"],
  ])("rejects invalid ID (%s): %s", (_label, id) => {
    expect(isValidJiraId(id)).toBe(false);
  });
});

describe("isValidJiraKey", () => {
  it.each(["PROJ-1", "MY_PROJECT-123", "AB-99999"])(
    "accepts valid key: %s",
    (key) => {
      expect(isValidJiraKey(key)).toBe(true);
    },
  );

  it.each([
    ["empty string", ""],
    ["lowercase project", "proj-1"],
    ["starts with number", "1PROJ-1"],
    ["no dash", "PROJ1"],
    ["no number after dash", "PROJ-"],
    ["path traversal", "PROJ-1/../etc"],
    ["spaces", "PROJ - 1"],
    ["only numbers", "123-456"],
    ["dash but lowercase", "Proj-1"],
    ["special characters", "PR@J-1"],
  ])("rejects invalid key (%s): %s", (_label, key) => {
    expect(isValidJiraKey(key)).toBe(false);
  });
});
