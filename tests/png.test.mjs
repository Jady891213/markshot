import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import {
  composePngColumns,
  optimizePngLossless,
} from "../src/png.mjs";

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

function fixturePng(width = 240, height = 160, color = [255, 255, 255, 255]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const rowSize = 1 + width * 4;
  const scanlines = Buffer.alloc(rowSize * height);
  for (let row = 0; row < height; row += 1) {
    scanlines[row * rowSize] = 0;
    for (let column = 0; column < width; column += 1) {
      const offset = row * rowSize + 1 + column * 4;
      scanlines.set(color, offset);
    }
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

test("PNG columns are combined left-to-right and aligned at the top", async () => {
  const red = fixturePng(2, 2, [255, 0, 0, 255]).png;
  const blue = fixturePng(3, 1, [0, 0, 255, 255]).png;
  const output = await composePngColumns([red, blue]);
  const chunks = inflatedImageData(output);
  const rowSize = 1 + 5 * 4;
  assert.equal(chunks.length, rowSize * 2);
  assert.deepEqual(
    [...chunks.subarray(1, 1 + 2 * 4)],
    [255, 0, 0, 255, 255, 0, 0, 255],
  );
  assert.deepEqual(
    [...chunks.subarray(1 + 2 * 4, 1 + 5 * 4)],
    [0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255],
  );
  const secondRow = rowSize + 1;
  assert.deepEqual(
    [...chunks.subarray(secondRow + 2 * 4, secondRow + 5 * 4)],
    [0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255],
  );
});
