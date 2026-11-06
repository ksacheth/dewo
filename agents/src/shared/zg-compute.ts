// 0G Compute adapter: one verifiable chat call per Decision (spike #3).
// Flow per the SDK: getServiceMetadata -> getRequestHeaders -> POST {endpoint}/chat/completions
// -> chat ID from the ZG-Res-Key header -> processResponse (fee cache + signature check)
// -> fetch the signed receipt so Verifiers can check it offline (best effort: a missing receipt is
// omitted, never fatal).
import { createZGComputeNetworkBroker, type ZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import type { Wallet } from "ethers";
import type { ChatReceipt, ChatRequest, Hex } from "../formats";
import type { InferencePort, InferenceReply } from "../worker/ports";

interface Completion {
  id?: string;
  choices?: { message?: { content?: string } }[];
  usage?: unknown;
}

export class ZeroGInference implements InferencePort {
  private readonly endpoints = new Map<string, Promise<string>>();

  /** `timeoutMs` bounds each 0G HTTP call, so an unreachable provider surfaces as an error (the Episode then safe-stops). */
  constructor(
    private readonly broker: ZGComputeNetworkBroker,
    private readonly timeoutMs = 60_000,
  ) {}

  static async connect(wallet: Wallet): Promise<ZeroGInference> {
    return new ZeroGInference(await createZGComputeNetworkBroker(wallet));
  }

  async complete(providerAddress: Hex, request: unknown): Promise<InferenceReply> {
    const { chatID, completion } = await this.call(providerAddress, request as ChatRequest);
    const usage = JSON.stringify(completion.usage ?? {});
    const valid = await this.broker.inference.processResponse(providerAddress, chatID, usage);
    if (valid === false) throw new Error(`0G signature for chat ${chatID} did not verify`);

    const reply: InferenceReply = { chatID, rawResponse: completion.choices?.[0]?.message?.content ?? "" };
    // The receipt is optional evidence: failing to fetch it must not end the Episode (only the
    // completion and processResponse above do), so the Decision is kept without it.
    try {
      reply.receipt = await this.receipt(providerAddress, chatID);
    } catch (error) {
      console.warn(`0G receipt for chat ${chatID} not fetched, recording the Decision without it:`, error);
    }
    return reply;
  }

  /** One billed chat completion and its chat ID. */
  private async call(providerAddress: Hex, request: ChatRequest): Promise<{ chatID: string; completion: Completion }> {
    const endpoint = await this.endpoint(providerAddress, request.model);
    const headers = await this.broker.inference.getRequestHeaders(providerAddress);
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers as unknown as Record<string, string>) },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`0G inference failed: ${response.status} ${await response.text()}`);

    const completion = (await response.json()) as Completion;
    const chatID = response.headers.get("ZG-Res-Key") ?? completion.id;
    if (!chatID) throw new Error("0G response has no chat ID");
    return { chatID, completion };
  }

  private endpoint(providerAddress: Hex, model: string): Promise<string> {
    const key = `${providerAddress}:${model}`;
    if (!this.endpoints.has(key)) {
      const metadata = this.broker.inference.getServiceMetadata(providerAddress, model);
      const endpoint = metadata.then((m) => m.endpoint);
      this.endpoints.set(key, endpoint);
      // A failed lookup must not be cached forever: drop it so the next Decision retries.
      endpoint.catch(() => this.endpoints.delete(key));
    }
    return this.endpoints.get(key)!;
  }

  private async receipt(providerAddress: Hex, chatID: string): Promise<ChatReceipt> {
    const url = await this.broker.inference.getChatSignatureDownloadLink(providerAddress, chatID);
    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`0G receipt for chat ${chatID} unavailable: ${response.status}`);
    const { text, signature } = (await response.json()) as { text: string; signature: Hex };
    return { text, signature };
  }
}
