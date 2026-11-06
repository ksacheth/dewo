// The exact 0G request a Policy produces for one Decision. Shared with the Verifier,
// which rebuilds it from the Replay frame and compares it to what 0G signed (spike #2).
import type { Action } from "./episode-log";
import type { Policy } from "./policy";

export const FRAME_PLACEHOLDER = "{{frame}}";
export const HISTORY_PLACEHOLDER = "{{history}}";
/** What {{frame}} becomes in the prompt text; the frame itself is attached as an image. */
export const FRAME_TEXT = "the attached image";

/** The body fields buildRequest always sets itself; a Policy's requestOptions cannot override them. */
export const RESERVED_REQUEST_FIELDS = ["model", "temperature", "messages"] as const;

export interface ChatRequest {
  model: string;
  temperature: number;
  messages: [
    {
      role: "user";
      content: [{ type: "text"; text: string }, { type: "image_url"; image_url: { url: string } }];
    },
  ];
  /** The Policy's requestOptions, e.g. chat_template_kwargs (ADR 0004). */
  [option: string]: unknown;
}

/** The last `memoryWindow` Actions, oldest first, or "none". */
export function formatHistory(actions: readonly Action[], memoryWindow: number): string {
  const recent = memoryWindow > 0 ? actions.slice(-memoryWindow) : [];
  return recent.length > 0 ? recent.join(", ") : "none";
}

export function buildRequest(policy: Policy, framePng: Uint8Array, history: readonly Action[]): ChatRequest {
  const text = policy.promptTemplate
    .replaceAll(FRAME_PLACEHOLDER, FRAME_TEXT)
    .replaceAll(HISTORY_PLACEHOLDER, formatHistory(history, policy.memoryWindow));
  const url = `data:image/png;base64,${Buffer.from(framePng).toString("base64")}`;
  return {
    ...policy.requestOptions,
    model: policy.model,
    temperature: policy.temperature,
    messages: [{ role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url } }] }],
  };
}
