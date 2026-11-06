import type { Action, Policy } from "@dewo/agents/formats";

/**
 * Rebuild the request body a Worker following `policy` must have sent for this frame and history.
 * The shape is a stand-in until M4 exports its request builder from `@dewo/agents/formats`; it must match that builder exactly.
 */
export function buildRequest(policy: Policy, frame: string, history: Action[]): unknown {
  const window = policy.memoryWindow > 0 ? history.slice(-policy.memoryWindow) : [];
  const prompt = policy.promptTemplate.replace("{{history}}", window.join(", ")).replace("{{frame}}", "[image]");
  return {
    model: policy.model,
    temperature: policy.temperature,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: frame } }] }],
  };
}
