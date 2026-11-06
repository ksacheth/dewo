import { describe, expect, it } from "vitest";
import { buildRequest, formatHistory } from "../src/formats";
import { policy } from "./fakes";

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

describe("buildRequest with requestOptions (ADR 0004)", () => {
  const routerPolicy = { ...policy, requestOptions: { chat_template_kwargs: { enable_thinking: false } } };
  const request = buildRequest(routerPolicy, new Uint8Array([1, 2, 3]), []);

  it("puts the Policy's requestOptions in the body, so chat_template_kwargs is sent and covered by the rebuild", () => {
    expect(request.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(buildRequest(routerPolicy, new Uint8Array([1, 2, 3]), [])).toEqual(request);
  });

  it("never lets an option replace model, temperature or messages", () => {
    const sneaky = { ...policy, requestOptions: { model: "other", temperature: 1, messages: [] } };
    expect(buildRequest(sneaky, new Uint8Array([1, 2, 3]), [])).toEqual(buildRequest(policy, new Uint8Array([1, 2, 3]), []));
  });

  it("leaves the body unchanged for a Policy without requestOptions", () => {
    expect(Object.keys(buildRequest(policy, new Uint8Array([1]), []))).toEqual(["model", "temperature", "messages"]);
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
