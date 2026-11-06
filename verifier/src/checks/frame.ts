import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { Hex } from "viem";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PIXELS = 1024 * 1024; // the sim renders 224x224; refuse anything far larger than a decompression bomb needs

/**
 * The sim's canonical frame hash (sim/README.md): sha256("dewo-frame-v1" + width BE u32 + height BE u32 + raw RGB, row-major).
 * It hashes pixels, not PNG bytes, so it does not depend on any zlib build. Decodes 8-bit RGB, non-interlaced PNGs (what the sim
 * writes, any filter type). Returns null for anything else, which the caller treats as a mismatch.
 */
export function frameHashOfPng(png: Uint8Array): Hex | null {
  try {
    const rgb = decodeRgbPng(Buffer.from(png));
    if (!rgb) return null;
    const head = Buffer.alloc(13 + 8);
    head.write("dewo-frame-v1", 0, "ascii");
    head.writeUInt32BE(rgb.width, 13);
    head.writeUInt32BE(rgb.height, 17);
    return `0x${createHash("sha256").update(head).update(rgb.pixels).digest("hex")}`;
  } catch {
    return null;
  }
}

function decodeRgbPng(png: Buffer): { width: number; height: number; pixels: Buffer } | null {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let header: { width: number; height: number } | null = null;
  const idat: Buffer[] = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    if (data.length !== length) return null;
    if (type === "IHDR") {
      const [bitDepth, colorType, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) return null;
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4) };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (!header || header.width === 0 || header.height === 0 || header.width * header.height > MAX_PIXELS) return null;

  const stride = header.width * 3;
  const scanlines = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * header.height });
  if (scanlines.length !== (stride + 1) * header.height) return null;

  const pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y++) {
    const filter = scanlines[y * (stride + 1)]!;
    const line = scanlines.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= 3 ? pixels[y * stride + x - 3]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= 3 ? pixels[(y - 1) * stride + x - 3]! : 0;
      const predictor =
        filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : -1;
      if (predictor < 0) return null;
      pixels[y * stride + x] = (line[x]! + predictor) & 0xff;
    }
  }
  return { width: header.width, height: header.height, pixels };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
