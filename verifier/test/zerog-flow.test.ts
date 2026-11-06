import { describe, expect, it } from "vitest";
import { MemData } from "@0gfoundation/0g-storage-ts-sdk";
import type { Hex } from "viem";
import { fileRoot, zeroGFlow, type FlowReader, type SubmissionNode } from "../src/adapters/zerog-flow.js";

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

  it("finds a submission of the root inside the window", async () => {
    const { reader } = chain(10_000n, { 300: [node("01")], 310: [node("ab")] });
    expect(await zeroGFlow(reader).submittedBetween(ROOT, 1_100, 1_200)).toBe(true);
  });

  it("finds a root uploaded as several subtrees by folding them", async () => {
    const parts = [node("01", 3n), node("02", 2n), node("03", 1n)];
    const { reader } = chain(10_000n, { 310: parts });
    expect(await zeroGFlow(reader).submittedBetween(fileRoot(parts)!, 1_100, 1_200)).toBe(true);
  });

  it("is false for a root never submitted", async () => {
    const { reader } = chain(10_000n, { 300: [node("01")] });
    expect(await zeroGFlow(reader).submittedBetween(ROOT, 1_100, 1_200)).toBe(false);
  });

  it("counts blocks stamped exactly at either end, and nothing outside them", async () => {
    // Blocks 200-201 are stamped 1100, block 400 is the last stamped 1200 (block 401 jumps to 1250).
    const at = async (block: number) => zeroGFlow(chain(10_000n, { [block]: [node("ab")] }).reader).submittedBetween(ROOT, 1_100, 1_200);
    expect(await at(200)).toBe(true);
    expect(await at(400)).toBe(true);
    expect(await at(199)).toBe(false);
    expect(await at(401)).toBe(false);
  });

  it("scans the window in fixed chunks that cover exactly its blocks, whatever the chain head is", async () => {
    const scans = await Promise.all([5_000n, 90_000n].map(async (head) => {
      const { reader, ranges } = chain(head, {});
      await zeroGFlow(reader, { chunk: 64n }).submittedBetween(ROOT, 1_100, 1_200);
      return ranges;
    }));
    expect(scans[0]).toEqual(scans[1]);
    expect(scans[0][0][0]).toBe(200n);
    expect(scans[0].at(-1)![1]).toBe(400n);
    for (let i = 1; i < scans[0].length; i++) expect(scans[0][i][0]).toBe(scans[0][i - 1][1] + 1n);
  });

  it("refuses to answer until the chain has a block after the window, so no later upload can split the Verifiers", async () => {
    const { reader } = chain(400n, { 300: [node("ab")] }); // the head is stamped 1200, the end of the window
    await expect(zeroGFlow(reader).submittedBetween(ROOT, 1_100, 1_200)).rejects.toThrow(/not passed/);
  });
});
