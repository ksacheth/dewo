import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { frameHashOfPng } from "../src/checks/frame.js";
import { encodePng } from "./fixtures/builders.js";

// A PNG and hash produced by the sim's own `encode_png` and `frame_hash` (sim/src/sim/camera.py) on a random 5x6 image.
const golden = JSON.parse(readFileSync(new URL("./fixtures/sim-frame.json", import.meta.url), "utf8")) as { png: string; frameHash: string };

const hashOfRaw = (rgb: Uint8Array, w: number, h: number) => {
  const head = Buffer.alloc(21); head.write("dewo-frame-v1"); head.writeUInt32BE(w, 13); head.writeUInt32BE(h, 17);
  return `0x${createHash("sha256").update(head).update(rgb).digest("hex")}`;
};

/** Re-encode `rgb` with a PNG filter type, the way another encoder would. */
function pngWithFilter(rgb: Uint8Array, w: number, h: number, filter: number): Uint8Array {
  const stride = w * 3;
  const at = (x: number, y: number) => (x < 0 || y < 0 ? 0 : rgb[y * stride + x]!);
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const lines = [];
  for (let y = 0; y < h; y++) {
    const line = Buffer.alloc(stride + 1); line[0] = filter;
    for (let x = 0; x < stride; x++) {
      const a = at(x - 3, y), b = at(x, y - 1), c = at(x - 3, y - 1);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
      line[x + 1] = (rgb[y * stride + x]! - predictor) & 0xff;
    }
    lines.push(line);
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(lines))), chunk("IEND", Buffer.alloc(0))]);
}

describe("frameHashOfPng", () => {
  it("matches the hash the real sim computed for the PNG its own encoder wrote", () => {
    expect(frameHashOfPng(Buffer.from(golden.png, "hex"))).toBe(golden.frameHash);
  });

  it("hashes the pixels, whatever PNG filter the encoder used", () => {
    const w = 7, h = 5;
    const rgb = Uint8Array.from({ length: w * h * 3 }, (_, i) => (i * 37 + (i >> 3) * 11) & 0xff);
    for (const filter of [0, 1, 2, 3, 4]) expect(frameHashOfPng(pngWithFilter(rgb, w, h, filter))).toBe(hashOfRaw(rgb, w, h));
  });

  it("hashes different pixels differently", () => {
    expect(frameHashOfPng(encodePng(new Uint8Array(48), 4, 4))).not.toBe(frameHashOfPng(encodePng(new Uint8Array(48).fill(1), 4, 4)));
  });

  it("rejects bytes that are not a supported PNG", () => {
    expect(frameHashOfPng(Buffer.from("not a png"))).toBeNull();
    expect(frameHashOfPng(Buffer.from(golden.png, "hex").subarray(0, 40))).toBeNull();
    const rgba = Buffer.from(golden.png, "hex"); rgba[25] = 6; // IHDR colour type: RGBA
    expect(frameHashOfPng(rgba)).toBeNull();
  });
});
