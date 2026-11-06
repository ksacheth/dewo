// Manual live check of the 0G Router path (ADR 0004): one camera frame through a demo Policy, the same adapter a
// Worker uses (provider pin, processResponse on mainnet, receipt), then the receipt signer and the Verifier's rebuild.
// Costs one Decision (about $0.000007) on the key's Router credit. Not run by the test suite.
// Usage (from agents/): ZG_ROUTER_API_KEY=sk-... pnpm check:router [path/to/frame.png]
// Optional: WORKER_POLICY (default policies/careful.json), ZG_ROUTER_URL, ZG_MAINNET_RPC_URL,
// SIM_COMMAND (default ../sim/scripts/sim-docker; used to render a frame when no PNG path is given).
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyMessage } from "ethers";
import { assertUsablePolicy, buildRequest, canonicalJson, parseAction, type Hex, type Policy } from "../src/formats";
import { SimCli } from "../src/shared/sim-cli";
import { RouterInference, connectMainnetBroker } from "../src/shared/zg-router";
import { inferenceConfig } from "../src/shared/zg-inference";

const config = inferenceConfig({ ...process.env, ZG_INFERENCE: "router" });
if (config.kind !== "router") throw new Error("unreachable");
const policy = JSON.parse(readFileSync(process.env.WORKER_POLICY ?? "policies/careful.json", "utf8")) as Policy;
assertUsablePolicy(policy);

async function frame(): Promise<Uint8Array> {
  const path = process.argv[2];
  if (path) return new Uint8Array(readFileSync(path));
  const command = (process.env.SIM_COMMAND ?? "../sim/scripts/sim-docker").split(" ") as [string, ...string[]];
  const session = await new SimCli(command, mkdtempSync(join(tmpdir(), "router-check-"))).openSession(
    `0x${"ab".repeat(32)}` as Hex,
    "medium",
    `0x${randomBytes(32).toString("hex")}`,
  );
  try {
    return (await session.observe()).frame;
  } finally {
    await session.close();
  }
}

const png = await frame();
const request = buildRequest(policy, png, []);
console.log(`Policy "${policy.name}": ${policy.model} on ${policy.providerAddress}, frame ${png.length} bytes`);
console.log("router", config.routerUrl, "| mainnet rpc", config.mainnetRpcUrl);

const broker = await connectMainnetBroker(config.mainnetRpcUrl);
const inference = new RouterInference(broker, { url: config.routerUrl, apiKey: config.apiKey });
const started = Date.now();
// Throws if the Router fails, another provider served it, or processResponse is not true.
const reply = await inference.complete(policy.providerAddress, request);
console.log(`reply in ${Date.now() - started} ms, chatID ${reply.chatID}`);
console.log("served by the pinned provider; processResponse on mainnet: true");
console.log("rawResponse:", JSON.stringify(reply.rawResponse), "-> action", parseAction(reply.rawResponse));
// What a Verifier does: read the request back from the logged JSON and compare it with a fresh rebuild.
const logged = JSON.parse(JSON.stringify(request)) as unknown;
console.log("Verifier rebuild matches the logged request:", canonicalJson(logged) === canonicalJson(buildRequest(policy, png, [])));

if (!reply.receipt) {
  console.log("no receipt fetched (optional; the Decision would be kept without it)");
} else {
  const { text, signature } = reply.receipt;
  console.log("receipt text:", text.length > 300 ? `${text.slice(0, 300)}...` : text);
  console.log("receipt signer:", verifyMessage(text, signature));
}
