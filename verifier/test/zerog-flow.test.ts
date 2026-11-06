import { describe, expect, it } from "vitest";
import { MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, parseAbiParameters, type Hex } from "viem";
import { GALILEO_FLOW, HEAD_MARGIN_SECONDS, fileRoot, viemFlowReader, zeroGFlow, type FlowReader, type SubmissionNode } from "../src/adapters/zerog-flow.js";

const SUBMIT = parseAbiItem(
  "event Submit(address indexed sender, bytes32 indexed identity, uint256 submissionIndex, uint256 startPos, uint256 length, (uint256 length, bytes tags, (bytes32 root, uint256 height)[] nodes) submission)",
);

const node = (byte: string, height = 1n): SubmissionNode => ({ root: `0x${byte.repeat(32)}` as Hex, height });

describe("fileRoot", () => {
  it("matches the roots of a live Galileo Episode (issue #64 evidence): one subtree is the root, two are hashed together", () => {
    // Flow Submit events in txs 0x95065f08...a171c85a (Policy) and 0xe6ecd506...993658fc (Episode Log) on Galileo.
    expect(fileRoot([{ root: "0x98ef32cad127c6a4cb9506a5b72fa1a395f95ee6e13d3eb7b5cfa07be7fbd520", height: 1n }]))
      .toBe("0x98ef32cad127c6a4cb9506a5b72fa1a395f95ee6e13d3eb7b5cfa07be7fbd520");
    expect(fileRoot([
      { root: "0x3a150056565384eee0c8b6e5ef529569d00ca59836a1e5a74617929e38f4818f", height: 8n },
      { root: "0xd8d7ecf14e1b9cdda9b2f567691beb811d205b95ea1e16086872b9255d419571", height: 7n },
    ])).toBe("0x827c31a014e65655e4f09fc1a82341360bea41d4858033ed4a5b3c6bed8fedc0");
  });

  it.each([78, 93_776, 13_835, 61_250])("equals the SDK's file root for a %i-byte upload", async (size) => {
    const bytes = new Uint8Array(size).map((_, i) => (i * 7 + 3) & 255);
    const file = new MemData(bytes);
    const [tree] = await file.merkleTree();
    const [submission] = await file.createSubmission("0x");
    expect(fileRoot(submission!.data.nodes as SubmissionNode[])).toBe(tree!.rootHash());
  });

  it("has no root for an empty subtree list", () => {
    expect(fileRoot([])).toBeNull();
  });
});

describe("zeroGFlow.submittedBetween", () => {
  const ROOT = node("ab").root;
  /** Two blocks per second from t=1000, a 50 s gap after block 400, and Submit events at the given blocks. */
  function chain(head: bigint, submits: Record<number, SubmissionNode[]>) {
    const ranges: [bigint, bigint][] = [];
    const reader: FlowReader = {
      latestBlock: async () => head,
      blockTimestamp: async (b) => 1_000 + Math.floor(Number(b) / 2) + (b > 400n ? 50 : 0),
      submissions: async (from, to) => {
        expect(to).toBeLessThanOrEqual(head);
        ranges.push([from, to]);
        return Object.entries(submits).filter(([b]) => BigInt(b) >= from && BigInt(b) <= to).map(([, nodes]) => nodes);
      },
    };
    return { reader, ranges };
  }

  const one = (reader: FlowReader, root: Hex, from = 1_100, to = 1_200) => zeroGFlow(reader).submittedBetween([root], from, to).then(([found]) => found);

  it("finds a submission of the root inside the window", async () => {
    const { reader } = chain(10_000n, { 300: [node("01")], 310: [node("ab")] });
    expect(await one(reader, ROOT)).toBe(true);
  });

  it("answers for several roots from one scan, in order", async () => {
    const { reader, ranges } = chain(10_000n, { 300: [node("01")], 310: [node("ab")] });
    expect(await zeroGFlow(reader).submittedBetween([node("cd").root, ROOT, node("01").root], 1_100, 1_200)).toEqual([false, true, true]);
    expect(ranges).toEqual([[200n, 400n]]);
  });

  it("finds a root uploaded as several subtrees by folding them", async () => {
    const parts = [node("01", 3n), node("02", 2n), node("03", 1n)];
    expect(await one(chain(10_000n, { 310: parts }).reader, fileRoot(parts)!)).toBe(true);
  });

  it("is false for a root never submitted", async () => {
    expect(await one(chain(10_000n, { 300: [node("01")] }).reader, ROOT)).toBe(false);
  });

  it("counts blocks stamped exactly at either end, and nothing outside them", async () => {
    // Blocks 200-201 are stamped 1100, block 400 is the last stamped 1200 (block 401 jumps to 1250).
    const at = (block: number) => one(chain(10_000n, { [block]: [node("ab")] }).reader, ROOT);
    expect(await at(200)).toBe(true);
    expect(await at(400)).toBe(true);
    expect(await at(199)).toBe(false);
    expect(await at(401)).toBe(false);
  });

  it("scans the window in fixed chunks that cover exactly its blocks, whatever the chain head is", async () => {
    const scans = await Promise.all([5_000n, 90_000n].map(async (head) => {
      const { reader, ranges } = chain(head, {});
      await zeroGFlow(reader, { chunk: 64n }).submittedBetween([ROOT], 1_100, 1_200);
      return ranges;
    }));
    expect(scans[0]).toEqual(scans[1]);
    expect(scans[0][0][0]).toBe(200n);
    expect(scans[0].at(-1)![1]).toBe(400n);
    for (let i = 1; i < scans[0].length; i++) expect(scans[0][i][0]).toBe(scans[0][i - 1][1] + 1n);
  });

  it(`refuses to answer until the head is ${HEAD_MARGIN_SECONDS} s past the window, so a lagging RPC node has seen all of it`, async () => {
    // Block 540 is the first stamped 1320 = 1200 + the margin.
    await expect(one(chain(539n, { 300: [node("ab")] }).reader, ROOT)).rejects.toThrow(/not 120 s past/);
    expect(await one(chain(540n, { 300: [node("ab")] }).reader, ROOT)).toBe(true);
  });

  it("refuses to answer when the RPC head goes backwards during the scan (reads served by a node behind the first one)", async () => {
    const { reader } = chain(10_000n, {});
    const heads = [10_000n, 9_990n];
    const lagging: FlowReader = { ...reader, latestBlock: async () => heads.shift() ?? 9_990n };
    await expect(one(lagging, ROOT)).rejects.toThrow(/went backwards/);
  });
});

describe("viemFlowReader", () => {
  it("decodes the subtree roots of Flow Submit events from eth_getLogs", async () => {
    const nodes = [node("3a", 8n), node("d8", 7n)];
    const data = encodeAbiParameters(
      parseAbiParameters("uint256, uint256, uint256, (uint256 length, bytes tags, (bytes32 root, uint256 height)[] nodes)"),
      [7n, 0n, 93_776n, { length: 93_776n, tags: "0x", nodes }],
    );
    const topics = encodeEventTopics({ abi: [SUBMIT], eventName: "Submit", args: { sender: `0x${"11".repeat(20)}`, identity: node("ee").root } });
    const requests: { method: string; params: unknown[] }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { id, method, params } = JSON.parse(body);
        requests.push({ method, params });
        const log = { address: GALILEO_FLOW, topics, data, blockNumber: "0x10", transactionHash: node("99").root, transactionIndex: "0x0", blockHash: node("98").root, logIndex: "0x0", removed: false };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result: method === "eth_getLogs" ? [log] : null }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const decoded = await viemFlowReader(url).submissions(16n, 20n);
      expect(decoded).toEqual([nodes]);
      expect(fileRoot(decoded[0])).toBe(fileRoot(nodes));
      expect(requests[0]).toMatchObject({ method: "eth_getLogs", params: [{ address: GALILEO_FLOW, fromBlock: "0x10", toBlock: "0x14", topics: [topics[0]] }] });
    } finally {
      server.close();
    }
  });
});
