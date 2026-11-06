import { concat, createPublicClient, http, keccak256, parseAbiItem, type Address, type Hex } from "viem";
import type { UploadRecordPort } from "../ports.js";

/** The 0G Storage Flow contract on Galileo (chain 16602), as storage nodes report it in `zgs_getStatus` (`networkIdentity.flowAddress`). */
export const GALILEO_FLOW: Address = "0x22e03a6a89b950f1c82ec5e74f8eca321a105296";

/** One subtree of an uploaded file, as the Flow `Submit` event lists it. */
export interface SubmissionNode { root: Hex; height: bigint }

/** What the Verifier reads from Galileo to find a Flow submission. */
export interface FlowReader {
  latestBlock(): Promise<bigint>;
  blockTimestamp(block: bigint): Promise<number>;
  /** The subtree list of every Flow `Submit` event mined in blocks [fromBlock, toBlock]. */
  submissions(fromBlock: bigint, toBlock: bigint): Promise<SubmissionNode[][]>;
}

/**
 * A file's 0G Storage root from its submission's subtree roots, folded from the right the way storage nodes index it (it equals the
 * SDK's `merkleTree().rootHash()`). The event's indexed `identity` is keccak256 of the packed subtree roots, which is not the file
 * root, so the root cannot be used as a log topic and every event in the window is folded instead.
 */
export function fileRoot(nodes: readonly SubmissionNode[]): Hex | null {
  if (nodes.length === 0) return null;
  return nodes.slice(0, -1).reduceRight<Hex>((acc, node) => keccak256(concat([node.root, acc])), nodes[nodes.length - 1].root);
}

type StampOf = (block: bigint) => Promise<number>;

/**
 * The lowest block in [lo, hi] stamped at or after `t`, given that `hi` is. Block timestamps never decrease, so the answer is the
 * same however it is searched for. Steps alternate between interpolating on timestamps (Galileo's block time is steady, so this
 * lands close) and bisecting (so the worst case stays logarithmic).
 */
async function firstBlockAtOrAfter(stampOf: StampOf, t: number, lo: bigint, hi: bigint): Promise<bigint> {
  let tLo = await stampOf(lo);
  if (tLo >= t) return lo;
  let tHi = await stampOf(hi);
  for (let interpolate = true; hi - lo > 1n; interpolate = !interpolate) {
    const guess = interpolate ? lo + BigInt(Math.ceil(((t - tLo) / (tHi - tLo)) * Number(hi - lo))) : (lo + hi) / 2n;
    const mid = guess <= lo ? lo + 1n : guess >= hi ? hi - 1n : guess;
    const stamp = await stampOf(mid);
    if (stamp >= t) [hi, tHi] = [mid, stamp];
    else [lo, tLo] = [mid, stamp];
  }
  return hi;
}

const memoized = (stampOf: StampOf): StampOf => {
  const seen = new Map<bigint, Promise<number>>();
  return (block) => {
    if (!seen.has(block)) seen.set(block, stampOf(block));
    return seen.get(block) as Promise<number>;
  };
};

export interface FlowOptions {
  /** Blocks per `eth_getLogs` call, under the RPC's range limit. Fixed in code, so every Verifier scans the same ranges. */
  chunk?: bigint;
}
const DEFAULT_CHUNK = 5_000n; // about 40 minutes of Galileo blocks

/**
 * How far past the window the chain head must be before the Verifier answers. A load-balanced RPC can serve `eth_getLogs` from a
 * node a little behind the head it reported, and that node answers an empty list rather than an error; this margin (a constant,
 * so every Verifier applies the same one) keeps the window well inside what such a node has already seen.
 */
export const HEAD_MARGIN_SECONDS = 120;

/** The roots (lowercased) with no Flow `Submit` in blocks [first, last], scanned in fixed chunks from `first`. */
async function rootsNotSubmitted(reader: FlowReader, roots: readonly Hex[], first: bigint, last: bigint, chunk: bigint): Promise<Set<string>> {
  const missing = new Set(roots.map((root) => root.toLowerCase()));
  for (let start = first; start <= last && missing.size > 0; start += chunk) {
    const end = start + chunk - 1n < last ? start + chunk - 1n : last;
    for (const nodes of await reader.submissions(start, end)) missing.delete(fileRoot(nodes)?.toLowerCase() ?? "");
  }
  return missing;
}

/**
 * Proof of upload on 0G Galileo: every 0G Storage upload first submits its root to the Flow contract, so a root with no `Submit` in
 * the window was never uploaded in it. The window is mapped to blocks by timestamp alone, so all Verifiers scan the same blocks.
 */
export function zeroGFlow(reader: FlowReader, { chunk = DEFAULT_CHUNK }: FlowOptions = {}): UploadRecordPort {
  /** The chain head, once its block is stamped at least HEAD_MARGIN_SECONDS past `to`. */
  async function headPast(stampOf: StampOf, to: number): Promise<bigint> {
    const head = await reader.latestBlock();
    if ((await stampOf(head)) < to + HEAD_MARGIN_SECONDS) throw new Error(`Galileo is not ${HEAD_MARGIN_SECONDS} s past ${to} yet`);
    return head;
  }
  return {
    async assertPast(to) {
      await headPast((block) => reader.blockTimestamp(block), to);
    },
    async submittedBetween(roots, from, to) {
      const stampOf = memoized((block) => reader.blockTimestamp(block));
      const head = await headPast(stampOf, to);
      const first = await firstBlockAtOrAfter(stampOf, from, 0n, head);
      const last = (await firstBlockAtOrAfter(stampOf, to + 1, first, head)) - 1n;
      const missing = await rootsNotSubmitted(reader, roots, first, last, chunk);
      // A head that went backwards means the reads came from different nodes, and an empty answer may be a lagging one.
      if ((await reader.latestBlock()) < head) throw new Error("Galileo RPC head went backwards during the Flow scan");
      return roots.map((root) => !missing.has(root.toLowerCase()));
    },
  };
}

const submitEvent = parseAbiItem(
  "event Submit(address indexed sender, bytes32 indexed identity, uint256 submissionIndex, uint256 startPos, uint256 length, (uint256 length, bytes tags, (bytes32 root, uint256 height)[] nodes) submission)",
);

/** Reads the Flow contract's `Submit` events and block timestamps on 0G Galileo over JSON-RPC. */
export function viemFlowReader(rpcUrl: string, address: Address = GALILEO_FLOW): FlowReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    latestBlock: () => client.getBlockNumber(),
    async blockTimestamp(blockNumber) {
      return Number((await client.getBlock({ blockNumber })).timestamp);
    },
    async submissions(fromBlock, toBlock) {
      const logs = await client.getLogs({ address, event: submitEvent, fromBlock, toBlock, strict: true });
      return logs.map((log) => [...log.args.submission.nodes]);
    },
  };
}
