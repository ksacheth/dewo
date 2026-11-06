import { describe, expect, it } from "vitest";
import { buildRequest, formatHistory, seedCommitment } from "../src/formats";
import { SALT, SEED, policy } from "./fakes";

describe("buildRequest", () => {
  const request = buildRequest(policy, new Uint8Array([1, 2, 3]), ["FORWARD", "TURN_LEFT"]);

  it("fills the template and attaches the frame as a PNG data URL", () => {
    const [text, image] = request.messages[0].content;
    expect(text.text).toBe(
      "View: the attached image. Recent moves: FORWARD, TURN_LEFT. Reply FORWARD, TURN_LEFT, TURN_RIGHT or STOP.",
    );
    expect(image.image_url.url).toBe("data:image/png;base64,AQID");
  });

  it("carries the Policy's model and temperature", () => {
    expect(request).toMatchObject({ model: "vision-large", temperature: 0 });
  });

  it("is identical when rebuilt from the same inputs (what the Verifier relies on)", () => {
    expect(buildRequest(policy, new Uint8Array([1, 2, 3]), ["FORWARD", "TURN_LEFT"])).toEqual(request);
  });
});

describe("formatHistory", () => {
  it("shows nothing for a Policy with no memory", () => {
    expect(formatHistory(["FORWARD"], 0)).toBe("none");
  });
  it("keeps only the most recent moves, oldest first", () => {
    expect(formatHistory(["TURN_LEFT", "FORWARD", "FORWARD", "STOP"], 2)).toBe("FORWARD, STOP");
  });
});

describe("seedCommitment", () => {
  it("changes if the seed or the salt changes", () => {
    const base = seedCommitment(SEED, SALT);
    expect(seedCommitment(SALT, SEED)).not.toBe(base);
    expect(seedCommitment(SEED, SALT)).toBe(base);
  });
});
