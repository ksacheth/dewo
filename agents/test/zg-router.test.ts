import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRequest, type Hex } from "../src/formats";
import { runEpisode } from "../src/worker/episode";
import { RouterInference, type MainnetBroker } from "../src/shared/zg-router";
import { CorridorSession, policy } from "./fakes";

const PROVIDER: Hex = "0xf4FB8d2bD856e672b5f9848b0eD235A20079B250";
const OTHER = "0x0000000000000000000000000000000000000002";
const API_KEY = "sk-test-secret";
const routerPolicy = { ...policy, model: "0gm-1.0-35b-a3b", providerAddress: PROVIDER, requestOptions: { chat_template_kwargs: { enable_thinking: false } } };
const request = buildRequest(routerPolicy, new Uint8Array([1, 2, 3]), []);

interface Calls {
  processResponse: [string, string | undefined][];
  fetches: { url: string; init?: RequestInit }[];
}

function brokerWith(valid: boolean | null | (() => Promise<boolean | null>) = true): MainnetBroker {
  return {
    inference: {
      processResponse: vi.fn(async () => (typeof valid === "function" ? valid() : valid)),
      getServiceMetadata: vi.fn(async (_provider: string, model?: string) => ({ endpoint: "http://provider/v1/proxy", model: model ?? "m" })),
    },
  };
}

function completion(over: { provider?: string | null; headers?: Record<string, string>; id?: string } = {}): Response {
  const body = {
    id: over.id ?? "chatcmpl-abc",
    choices: [{ message: { content: "TURN_RIGHT" } }],
    ...(over.provider === null ? {} : { x_0g_trace: { provider: over.provider ?? PROVIDER.toLowerCase() } }),
  };
  return new Response(JSON.stringify(body), { headers: over.headers ?? { "ZG-Res-Key": "chat-1", "X-Provider": PROVIDER } });
}

function stubFetch(chat: () => Response, receipt: () => Response = () => new Response(JSON.stringify({ text: "t", signature: "0x01", signing_address: "0x9" }))): Calls["fetches"] {
  const fetches: Calls["fetches"] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetches.push({ url, init });
      return url.endsWith("/chat/completions") ? chat() : receipt();
    }),
  );
  return fetches;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RouterInference", () => {
  it("sends the Policy request to the Router pinned to the provider, verifies on mainnet and records the receipt", async () => {
    const fetches = stubFetch(() => completion());
    const broker = brokerWith(true);
    const reply = await new RouterInference(broker, { url: "https://router.test/v1/", apiKey: API_KEY }).complete(PROVIDER, request);

    expect(reply).toEqual({ chatID: "chat-1", rawResponse: "TURN_RIGHT", receipt: { text: "t", signature: "0x01" } });
    expect(broker.inference.processResponse).toHaveBeenCalledWith(PROVIDER, "chat-1");

    const [chat, receipt] = fetches;
    expect(chat!.url).toBe("https://router.test/v1/chat/completions");
    const headers = chat!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers["X-0G-Provider-Trust-Mode"]).toBe("private");
    expect(headers["X-0G-Provider-Address"]).toBe(PROVIDER);
    expect(chat!.init!.signal).toBeInstanceOf(AbortSignal);
    expect(receipt!.url).toBe("http://provider/v1/proxy/signature/chat-1?model=0gm-1.0-35b-a3b");
  });

  it("sends chat_template_kwargs in the body, byte for byte the request the Policy built", async () => {
    const fetches = stubFetch(() => completion());
    await new RouterInference(brokerWith(), { apiKey: API_KEY }).complete(PROVIDER, request);
    const body = JSON.parse(fetches[0]!.init!.body as string);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body).toEqual(request);
    expect(fetches[0]!.url).toBe("https://router-api.0g.ai/v1/chat/completions");
  });

  it("falls back to the body id, without its chatcmpl- prefix, when ZG-Res-Key is missing", async () => {
    stubFetch(() => completion({ headers: {}, id: "chatcmpl-xyz" }));
    const broker = brokerWith();
    const reply = await new RouterInference(broker, { apiKey: API_KEY }).complete(PROVIDER, request);
    expect(reply.chatID).toBe("xyz");
    expect(broker.inference.processResponse).toHaveBeenCalledWith(PROVIDER, "xyz");
  });

  it("throws when another provider served the request (body trace)", async () => {
    stubFetch(() => completion({ provider: OTHER, headers: { "ZG-Res-Key": "chat-1" } }));
    const broker = brokerWith();
    await expect(new RouterInference(broker, { apiKey: API_KEY }).complete(PROVIDER, request)).rejects.toThrow(/not the Policy's provider/);
    expect(broker.inference.processResponse).not.toHaveBeenCalled();
  });

  it("throws when the X-Provider header names another provider", async () => {
    stubFetch(() => completion({ headers: { "ZG-Res-Key": "chat-1", "X-Provider": OTHER } }));
    await expect(new RouterInference(brokerWith(), { apiKey: API_KEY }).complete(PROVIDER, request)).rejects.toThrow(/not the Policy's provider/);
  });

  it("throws when the response does not say which provider served it", async () => {
    stubFetch(() => completion({ provider: null, headers: { "ZG-Res-Key": "chat-1" } }));
    await expect(new RouterInference(brokerWith(), { apiKey: API_KEY }).complete(PROVIDER, request)).rejects.toThrow(/which provider/);
  });

  it.each([false, null])("throws when processResponse returns %s", async (valid) => {
    stubFetch(() => completion());
    await expect(new RouterInference(brokerWith(valid), { apiKey: API_KEY }).complete(PROVIDER, request)).rejects.toThrow(/did not verify/);
  });

  it("throws when processResponse itself fails", async () => {
    stubFetch(() => completion());
    const broker = brokerWith(async () => {
      throw new Error("rpc down");
    });
    await expect(new RouterInference(broker, { apiKey: API_KEY }).complete(PROVIDER, request)).rejects.toThrow("rpc down");
  });

  it("throws on a failed completion, without leaking the API key", async () => {
    stubFetch(() => new Response("insufficient_balance", { status: 402 }));
    const error = await new RouterInference(brokerWith(), { apiKey: API_KEY }).complete(PROVIDER, request).catch((e: Error) => e);
    expect(String(error)).toMatch(/402 insufficient_balance/);
    expect(String(error)).not.toContain(API_KEY);
  });

  it("keeps the Decision, without a receipt, when the receipt fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(() => completion(), () => new Response("nope", { status: 500 }));
    const reply = await new RouterInference(brokerWith(), { apiKey: API_KEY }).complete(PROVIDER, request);
    expect(reply).toEqual({ chatID: "chat-1", rawResponse: "TURN_RIGHT" });
    expect("receipt" in reply).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("keeps the Decision when the provider's service lookup fails, and retries the lookup next time", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(() => completion());
    const broker = brokerWith();
    let lookups = 0;
    broker.inference.getServiceMetadata = async () => {
      if (++lookups === 1) throw new Error("rpc down");
      return { endpoint: "http://provider/v1/proxy", model: "m" };
    };
    const inference = new RouterInference(broker, { apiKey: API_KEY });
    expect((await inference.complete(PROVIDER, request)).receipt).toBeUndefined();
    expect((await inference.complete(PROVIDER, request)).receipt).toEqual({ text: "t", signature: "0x01" });
    expect(lookups).toBe(2);
  });

  it("times out an unreachable Router so the Episode can safe-stop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      ),
    );
    await expect(new RouterInference(brokerWith(), { apiKey: API_KEY, timeoutMs: 20 }).complete(PROVIDER, request)).rejects.toThrow();
  });

  it("times out a hanging processResponse", async () => {
    stubFetch(() => completion());
    const broker = brokerWith(() => new Promise(() => {}));
    await expect(new RouterInference(broker, { apiKey: API_KEY, timeoutMs: 20 }).complete(PROVIDER, request)).rejects.toThrow(/timed out/);
  });

  it("refuses to start without an API key", () => {
    expect(() => new RouterInference(brokerWith(), { apiKey: "" })).toThrow(/ZG_ROUTER_API_KEY/);
  });

  it("safe-stops the Episode when the provider does not match, and records nothing faked", async () => {
    stubFetch(() => completion({ provider: OTHER }));
    const result = await runEpisode({
      policy: routerPolicy,
      session: new CorridorSession(3),
      inference: new RouterInference(brokerWith(), { apiKey: API_KEY }),
    });
    expect(result).toEqual({ decisions: [], endReason: "SAFE_STOP" });
  });

  it("records a Router Decision with the pinned provider, chat ID, request and receipt", async () => {
    stubFetch(() => completion());
    const result = await runEpisode({
      policy: routerPolicy,
      session: new CorridorSession(3),
      inference: new RouterInference(brokerWith(), { apiKey: API_KEY }),
    });
    expect(result.decisions[0]).toMatchObject({
      chatID: "chat-1",
      providerAddress: PROVIDER,
      rawResponse: "TURN_RIGHT",
      action: "TURN_RIGHT",
      receipt: { text: "t", signature: "0x01" },
    });
    expect((result.decisions[0]!.request as { chat_template_kwargs: unknown }).chat_template_kwargs).toEqual({ enable_thinking: false });
  });
});
