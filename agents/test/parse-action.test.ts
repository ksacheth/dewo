import { describe, expect, it } from "vitest";
import { parseAction } from "../src/formats";

describe("parseAction", () => {
  it.each([
    ["FORWARD", "FORWARD"],
    ["turn_left", "TURN_LEFT"],
    ["  Turn_Right.\n", "TURN_RIGHT"],
    ["I will go FORWARD now", "FORWARD"],
    ["TURN_LEFT then FORWARD", "FORWARD"],
    ["TARGET: left\nBLOCKED: no, FORWARD is clear but\nMOVE: TURN_LEFT", "TURN_LEFT"],
    ["stop", "STOP"],
  ])("reads %j as %s", (raw, expected) => {
    expect(parseAction(raw)).toBe(expected);
  });

  it.each([
    "",
    "I think going left is wise",
    "TURN LEFT",
    "FORWARDS",
    "LEFT",
  ])("falls back to STOP for %j", (raw) => {
    expect(parseAction(raw)).toBe("STOP");
  });
});
