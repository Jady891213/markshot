import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import { optimizePngLossless } from "../src/png.mjs";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([typeBuffer, data])) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function fixturePng() {
  const width = 240;
  const height = 160;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const rowSize = 1 + width * 4;
  const scanlines = Buffer.alloc(rowSize * height, 0xff);
  for (let row = 0; row < height; row += 1) {
    scanlines[row * rowSize] = 0;
  }
  const unoptimized = zlib.deflateSync(scanlines, { level: 0 });
  return {
    png: Buffer.concat([
      PNG_SIGNATURE,
      chunk("IHDR", header),
      chunk("IDAT", unoptimized),
      chunk("IEND", Buffer.alloc(0)),
    ]),
    scanlines,
  };
}

function inflatedImageData(png) {
  const parts = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") {
      parts.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return zlib.inflateSync(Buffer.concat(parts));
}

test("PNG optimization is lossless and reduces compressible screenshots", async () => {
  const { png, scanlines } = fixturePng();
  const optimized = await optimizePngLossless(png);
  assert.ok(optimized.length < png.length);
  assert.deepEqual(inflatedImageData(optimized), scanlines);
});

test("invalid and already optimized input remains safe", async () => {
  const invalid = Buffer.from("not a png");
  assert.strictEqual(await optimizePngLossless(invalid), invalid);

  const { png } = fixturePng();
  const optimized = await optimizePngLossless(png);
  const secondPass = await optimizePngLossless(optimized);
  assert.deepEqual(secondPass, optimized);
});
