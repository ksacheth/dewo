import { describe, expect, it } from "vitest";
import { DRONE_SEED_PREFIX, actionsFor, parseAction, seedForTask, taskOf, type Hex } from "../src/formats";

const DRONE: Hex = `0x64726f6e${"00".repeat(28)}`;
const RANDOM: Hex = `0x${"ab".repeat(32)}`;

describe("task of a Course Seed", () => {
  it("is drone exactly when the seed starts with the ASCII bytes \"dron\", as in the sim", () => {
    expect(DRONE_SEED_PREFIX).toBe("0x64726f6e");
    expect(taskOf(DRONE)).toBe("drone");
    expect(taskOf(`0x64726F6E${"11".repeat(28)}`)).toBe("drone");
    expect(taskOf(RANDOM)).toBe("rover");
    expect(taskOf("0x64726f")).toBe("rover");
  });

  it("tags a random seed for the task the Requester asked for, keeping it a bytes32", () => {
    const drone = seedForTask(RANDOM, "drone");
    expect(taskOf(drone)).toBe("drone");
    expect(drone).toHaveLength(66);
    expect(drone.slice(10)).toBe(RANDOM.slice(10));
    expect(seedForTask(RANDOM, "rover")).toBe(RANDOM);
    const unlucky: Hex = `0x64726f6e${"cd".repeat(28)}`; // a random rover seed that happens to carry the tag
    expect(taskOf(seedForTask(unlucky, "rover"))).toBe("rover");
  });
});

describe("parseAction per task", () => {
  it("reads altitude moves only on a drone Mission", () => {
    expect(actionsFor("drone")).toEqual(["FORWARD", "TURN_LEFT", "TURN_RIGHT", "ASCEND", "DESCEND", "STOP"]);
    expect(parseAction("ascend", "drone")).toBe("ASCEND");
    expect(parseAction("I'll go FORWARD then DESCEND", "drone")).toBe("DESCEND");
    expect(parseAction("ASCEND", "rover")).toBe("STOP");
    expect(parseAction("ASCEND then FORWARD", "rover")).toBe("FORWARD");
    expect(parseAction("FORWARD")).toBe("FORWARD"); // the rover is the default
  });
});
