import type { ZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZeroGInference } from "../src/shared/zg-compute";

const PROVIDER = "0x0000000000000000000000000000000000000001";
const request = { model: "vision-large", messages: [] };

function brokerWith(getServiceMetadata: () => Promise<{ endpoint: string }>) {
  return {
    inference: {
      getServiceMetadata: vi.fn(getServiceMetadata),
      getRequestHeaders: async () => ({}),
      processResponse: async () => true,
      getChatSignatureDownloadLink: async () => "http://receipt",
    },
  } as unknown as ZGComputeNetworkBroker;
}

afterEach(() => vi.unstubAllGlobals());

describe("ZeroGInference", () => {
  it("retries the service lookup after it failed instead of caching the rejection", async () => {
    let calls = 0;
    const broker = brokerWith(async () => {
      if (++calls === 1) throw new Error("rpc down");
      return { endpoint: "http://provider" };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/chat/completions")
          ? new Response(JSON.stringify({ id: "c1", choices: [{ message: { content: "FORWARD" } }] }))
          : new Response(JSON.stringify({ text: "t", signature: "0x01" })),
      ),
    );
    const inference = new ZeroGInference(broker);

    await expect(inference.complete(PROVIDER, request)).rejects.toThrow("rpc down");
    await expect(inference.complete(PROVIDER, request)).resolves.toMatchObject({ chatID: "c1", rawResponse: "FORWARD" });
    expect(calls).toBe(2);
  });

  it("keeps the Decision, without a receipt, when the receipt fetch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/chat/completions")
          ? new Response(JSON.stringify({ id: "c1", choices: [{ message: { content: "FORWARD" } }] }))
          : new Response("nope", { status: 500 }),
      ),
    );
    const inference = new ZeroGInference(brokerWith(async () => ({ endpoint: "http://provider" })));

    const reply = await inference.complete(PROVIDER, request);
    expect(reply).toEqual({ chatID: "c1", rawResponse: "FORWARD" });
    expect("receipt" in reply).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still throws when processResponse says the signature is invalid", async () => {
    const broker = brokerWith(async () => ({ endpoint: "http://provider" }));
    (broker.inference as unknown as { processResponse: () => Promise<boolean> }).processResponse = async () => false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "c1", choices: [] }))),
    );
    await expect(new ZeroGInference(broker).complete(PROVIDER, request)).rejects.toThrow(/did not verify/);
  });

  it("times out an unreachable provider so the Episode can safe-stop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      ),
    );
    const inference = new ZeroGInference(brokerWith(async () => ({ endpoint: "http://provider" })), 20);
    await expect(inference.complete(PROVIDER, request)).rejects.toThrow();
  });
});
