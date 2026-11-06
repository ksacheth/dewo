// 0G Compute Router adapter (ADR 0004): one verifiable chat call per Decision, on 0G mainnet.
// Flow: POST {router}/chat/completions with the per-Worker API key, trust mode `private` and the Policy's
// provider pinned -> the serving provider must be the pinned one (x_0g_trace.provider / X-Provider)
// -> chat ID from the ZG-Res-Key header (fallback: body id without "chatcmpl-")
// -> processResponse on a mainnet broker (reads the chain and the provider, not the Router)
// -> fetch the provider's signed receipt (best effort: a missing receipt is omitted, never fatal).
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import type { ChatReceipt, ChatRequest, Hex } from "../formats";
import type { InferencePort, InferenceReply } from "../worker/ports";

export const ZG_MAINNET = { chainId: 16661n, rpc: "https://evmrpc.0g.ai" } as const;
export const ZG_ROUTER_URL = "https://router-api.0g.ai/v1";
/** ADR 0004: only TeeML providers, so the model itself runs in the enclave. */
export const ROUTER_TRUST_MODE = "private";

/** The slice of a mainnet 0G broker this adapter uses. */
export interface MainnetBroker {
  inference: {
    processResponse(providerAddress: string, chatID?: string, content?: string): Promise<boolean | null>;
    getServiceMetadata(providerAddress: string, model?: string): Promise<{ endpoint: string; model: string }>;
  };
}

export interface RouterOptions {
  /** The Router base URL, default https://router-api.0g.ai/v1. */
  url?: string;
  /** The Worker's own `sk-` key (trust mode Private on pc.0g.ai). Secret: never logged, never put in an error. */
  apiKey: string;
  /** Bounds every Router and provider call, so an unreachable service surfaces as an error (the Episode then safe-stops). */
  timeoutMs?: number;
}

interface Completion {
  id?: string;
  choices?: { message?: { content?: string | null } }[];
  x_0g_trace?: { provider?: string };
}

/**
 * A broker on 0G mainnet for verification only. processResponse and the service lookups read the chain and call the
 * provider's public signature endpoint, so a throwaway wallet with no funds is enough.
 */
export async function connectMainnetBroker(rpcUrl: string = ZG_MAINNET.rpc): Promise<MainnetBroker> {
  const provider = new JsonRpcProvider(rpcUrl);
  const { chainId } = await provider.getNetwork();
  if (chainId !== ZG_MAINNET.chainId) throw new Error(`${rpcUrl} is chain ${chainId}, not 0G mainnet (${ZG_MAINNET.chainId})`);
  // A random HD wallet, as in the 0G docs (it is not a `Wallet`, so the SDK also skips its fine-tuning broker).
  return createZGComputeNetworkBroker(Wallet.createRandom().connect(provider) as unknown as Wallet);
}

export class RouterInference implements InferencePort {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly endpoints = new Map<string, Promise<string>>();

  constructor(
    private readonly broker: MainnetBroker,
    options: RouterOptions,
  ) {
    if (!options.apiKey) throw new Error("0G Router API key is missing (set ZG_ROUTER_API_KEY)");
    this.url = (options.url ?? ZG_ROUTER_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  /** Builds the mainnet broker once; every Decision reuses it. */
  static async connect(options: RouterOptions & { mainnetRpcUrl?: string }): Promise<RouterInference> {
    return new RouterInference(await connectMainnetBroker(options.mainnetRpcUrl), options);
  }

  async complete(providerAddress: Hex, request: unknown): Promise<InferenceReply> {
    const chat = request as ChatRequest;
    const { chatID, completion } = await this.call(providerAddress, chat);
    const valid = await this.bounded(this.broker.inference.processResponse(providerAddress, chatID), `processResponse for chat ${chatID}`);
    // Only an explicit true counts: false is a bad signature, null means the provider has nothing verifiable.
    if (valid !== true) throw new Error(`0G signature for chat ${chatID} did not verify (processResponse returned ${valid})`);

    const reply: InferenceReply = { chatID, rawResponse: completion.choices?.[0]?.message?.content ?? "" };
    // The receipt is optional evidence: failing to fetch it must not end the Episode (only the
    // completion and processResponse above do), so the Decision is kept without it.
    try {
      reply.receipt = await this.receipt(providerAddress, chat.model, chatID);
    } catch (error) {
      console.warn(`0G receipt for chat ${chatID} not fetched, recording the Decision without it:`, error);
    }
    return reply;
  }

  /** One billed chat completion through the Router, served by the pinned provider, and its chat ID. */
  private async call(providerAddress: Hex, request: ChatRequest): Promise<{ chatID: string; completion: Completion }> {
    const response = await fetch(`${this.url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "X-0G-Provider-Trust-Mode": ROUTER_TRUST_MODE,
        "X-0G-Provider-Address": providerAddress,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`0G Router inference failed: ${response.status} ${(await response.text()).slice(0, 500)}`);

    const completion = (await response.json()) as Completion;
    assertServedBy(providerAddress, [completion.x_0g_trace?.provider, response.headers.get("X-Provider")]);
    const chatID = response.headers.get("ZG-Res-Key") ?? completion.id?.replace(/^chatcmpl-/, "");
    if (!chatID) throw new Error("0G Router response has no chat ID (no ZG-Res-Key header, no id)");
    return { chatID, completion };
  }

  private endpoint(providerAddress: Hex, model: string): Promise<string> {
    const key = `${providerAddress.toLowerCase()}:${model}`;
    if (!this.endpoints.has(key)) {
      const lookup = this.bounded(this.broker.inference.getServiceMetadata(providerAddress, model), `service lookup for ${providerAddress}`);
      const endpoint = lookup.then((m) => m.endpoint);
      this.endpoints.set(key, endpoint);
      // A failed lookup must not be cached forever: drop it so the next Decision retries.
      endpoint.catch(() => this.endpoints.delete(key));
    }
    return this.endpoints.get(key)!;
  }

  /** GET {serviceUrl}/v1/proxy/signature/{chatID}?model={model} on the provider itself, not the Router. */
  private async receipt(providerAddress: Hex, model: string, chatID: string): Promise<ChatReceipt> {
    const endpoint = await this.endpoint(providerAddress, model);
    const url = `${endpoint}/signature/${encodeURIComponent(chatID)}?model=${encodeURIComponent(model)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`0G receipt for chat ${chatID} unavailable: ${response.status}`);
    const { text, signature } = (await response.json()) as { text?: unknown; signature?: unknown };
    if (typeof text !== "string" || typeof signature !== "string" || !signature.startsWith("0x")) {
      throw new Error(`0G receipt for chat ${chatID} is malformed`);
    }
    return { text, signature: signature as Hex };
  }

  /** The SDK calls take no AbortSignal, so they are raced against the same timeout as the HTTP calls. */
  private bounded<T>(work: Promise<T>, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }
}

/** The Router reports the serving provider in the body and a header; every one present must be the pinned provider. */
function assertServedBy(pinned: Hex, reported: (string | null | undefined)[]): void {
  const present = reported.filter((p): p is string => typeof p === "string" && p !== "");
  if (present.length === 0) throw new Error("0G Router response does not say which provider served it");
  const other = present.find((p) => p.toLowerCase() !== pinned.toLowerCase());
  if (other) throw new Error(`0G Router served the request from ${other}, not the Policy's provider ${pinned}`);
}
