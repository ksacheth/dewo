// Live 0G spikes on Galileo (chain 16602), using the agents' own adapters.
//   storage  (#7)  upload a small JSON blob, print its root hash, download it back, compare bytes
//   compute  (#3)  render one real sim frame, send it with a Policy prompt through the broker path,
//                  check processResponse, and inspect the signed receipt (what it binds: #2 / #48)
// Usage (from agents/): ZG_PRIVATE_KEY=0x... pnpm spike:0g storage|compute|all
// Optional: ZG_PROVIDER (default: the omni model provider), ZG_MODEL, SIM_COMMAND (default ../sim/scripts/sim-docker).
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { JsonRpcProvider, Wallet, formatEther, keccak256, parseEther, toUtf8Bytes, verifyMessage } from "ethers";
import { buildRequest, parseAction, type Hex, type Policy } from "../src/formats";
import { SimCli } from "../src/shared/sim-cli";
import { ZeroGInference } from "../src/shared/zg-compute";
import { ZG_TESTNET, ZeroGStorage } from "../src/shared/zg-storage";

const OMNI = { provider: "0xd6269e257761705B9e442E59794703762DFcC940" as Hex, model: "qwen/qwen3.8-omni-flash" };
const LEDGER_MIN = 3; // 0G docs: ledger creation needs at least 3 0G
const PROVIDER_MIN = 1; // 0G docs: each provider sub-account needs at least 1 0G locked

const key = process.env.ZG_PRIVATE_KEY;
if (!key) throw new Error("set ZG_PRIVATE_KEY (0x-prefixed key of a funded Galileo wallet)");
const wallet = new Wallet(key, new JsonRpcProvider(ZG_TESTNET.rpc));
const mode = process.argv[2] ?? "all";

async function storage(): Promise<void> {
  console.log("\n== 0G Storage (#7)");
  const store = new ZeroGStorage(wallet);
  const bytes = toUtf8Bytes(JSON.stringify({ spike: "dewo #7", nonce: randomBytes(8).toString("hex"), at: new Date().toISOString() }));
  const root = await store.upload(bytes);
  console.log("uploaded", bytes.length, "bytes, root", root);
  const back = await store.download(root);
  const same = Buffer.from(back).equals(Buffer.from(bytes));
  console.log("downloaded", back.length, "bytes, identical:", same);
  if (!same) throw new Error("downloaded bytes differ");
}

async function frame(): Promise<Uint8Array> {
  const command = (process.env.SIM_COMMAND ?? "../sim/scripts/sim-docker").split(" ") as [string, ...string[]];
  const runs = mkdtempSync(join(tmpdir(), "zg-spike-"));
  const sim = new SimCli(command, runs);
  const missionId = `0x${randomBytes(32).toString("hex")}`;
  const session = await sim.openSession(`0x${"ab".repeat(32)}` as Hex, "medium", missionId);
  try {
    const observation = await session.observe();
    console.log("sim frame", observation.frame.length, "bytes, frameHash", observation.frameHash);
    return observation.frame;
  } finally {
    await session.close();
  }
}

async function ensureFunds(broker: Awaited<ReturnType<typeof createZGComputeNetworkBroker>>, provider: Hex): Promise<void> {
  try {
    const ledger = await broker.ledger.getLedger();
    console.log("ledger exists:", JSON.stringify(ledger, (_k, v) => (typeof v === "bigint" ? formatEther(v) : v)));
  } catch {
    console.log(`creating ledger with ${LEDGER_MIN} 0G`);
    await broker.ledger.addLedger(LEDGER_MIN);
  }
  console.log(`moving ${PROVIDER_MIN} 0G to the provider sub-account`);
  await broker.ledger.transferFund(provider, "inference", parseEther(String(PROVIDER_MIN)));
  try {
    await broker.inference.acknowledgeProviderSigner(provider);
    console.log("provider signer acknowledged");
  } catch (error) {
    console.log("acknowledgeProviderSigner:", (error as Error).message.slice(0, 160));
  }
}

async function compute(): Promise<void> {
  console.log("\n== 0G Compute (#3) + receipt inspection (#2 / #48)");
  const provider = (process.env.ZG_PROVIDER ?? OMNI.provider) as Hex;
  const model = process.env.ZG_MODEL ?? OMNI.model;
  const broker = await createZGComputeNetworkBroker(wallet);
  const service = (await broker.inference.listService()).find((s) => s.provider.toLowerCase() === provider.toLowerCase());
  if (!service) throw new Error(`provider ${provider} not listed`);
  console.log("service", JSON.stringify({ model: service.model, verifiability: service.verifiability, url: service.url, additionalInfo: service.additionalInfo }));
  await ensureFunds(broker, provider);

  const policy: Policy = {
    name: "Spike",
    model,
    providerAddress: provider,
    promptTemplate:
      "You are driving a small rover toward a charger. Avoid every obstacle. Camera view: {{frame}}. Your recent moves, oldest first: {{history}}. Reply with exactly one word: FORWARD, TURN_LEFT, TURN_RIGHT or STOP.",
    memoryWindow: 3,
    temperature: 0,
    version: "1",
  };
  const request = buildRequest(policy, await frame(), []);
  const started = Date.now();
  const reply = await new ZeroGInference(broker).complete(provider, request);
  console.log(`reply in ${Date.now() - started} ms, chatID ${reply.chatID}`);
  console.log("rawResponse:", JSON.stringify(reply.rawResponse), "-> action", parseAction(reply.rawResponse));
  console.log("processResponse: valid (complete() throws otherwise)");

  if (!reply.receipt) return console.log("no receipt fetched: request binding cannot be checked (see #48)");
  const { text, signature } = reply.receipt;
  console.log("receipt text:", text.length > 400 ? `${text.slice(0, 400)}...` : text);
  const signer = verifyMessage(text, signature);
  console.log("receipt signer", signer, "| listed TEE signer", JSON.stringify(service.additionalInfo ?? null).slice(0, 200));
  // What does the signed text commit to? Look for common hashes of the request and the response.
  const body = JSON.stringify(request);
  const candidates: Record<string, string> = {
    "sha256(request)": createHash("sha256").update(body).digest("hex"),
    "keccak(request)": keccak256(toUtf8Bytes(body)).slice(2),
    "sha256(response)": createHash("sha256").update(reply.rawResponse).digest("hex"),
    "keccak(response)": keccak256(toUtf8Bytes(reply.rawResponse)).slice(2),
  };
  for (const [name, hash] of Object.entries(candidates)) console.log(`receipt contains ${name}:`, text.toLowerCase().includes(hash));
}

const before = await wallet.provider!.getBalance(wallet.address);
console.log("wallet", wallet.address, "balance", formatEther(before), "0G");
if (mode === "storage" || mode === "all") await storage();
if (mode === "compute" || mode === "all") await compute();
console.log("\nspent", formatEther(before - (await wallet.provider!.getBalance(wallet.address))), "0G");
