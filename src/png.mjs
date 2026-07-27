import { promisify } from "node:util";
import zlib from "node:zlib";

const inflate = promisify(zlib.inflate);
const deflate = promisify(zlib.deflate);
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value =
      value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(data.length, 0);

  let crc = 0xffffffff;
  for (const byte of typeBuffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  const checksum = Buffer.allocUnsafe(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function parsePng(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < PNG_SIGNATURE.length ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return undefined;
  }

  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  let foundHeader = false;
  let foundEnd = false;

  while (offset + 12 <= buffer.length) {
    const dataLength = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + dataLength;
    if (chunkEnd > buffer.length) return undefined;

    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + dataLength);
    chunks.push({
      type,
      original: buffer.subarray(offset, chunkEnd),
      data,
    });
    foundHeader ||= type === "IHDR";
    if (type === "IEND") {
      foundEnd = true;
      break;
    }
    offset = chunkEnd;
  }

  if (!foundHeader || !foundEnd) return undefined;
  return chunks;
}

/**
 * Recompresses the existing PNG scanline stream without changing filters or
 * pixel data. Unsupported or already-optimal PNG data is returned unchanged.
 */
export async function optimizePngLossless(input) {
  const original = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const chunks = parsePng(original);
  if (!chunks) return original;

  const idatChunks = chunks.filter(({ type }) => type === "IDAT");
  if (idatChunks.length === 0) return original;

  try {
    const compressed = Buffer.concat(idatChunks.map(({ data }) => data));
    const scanlines = await inflate(compressed);
    const optimized = await deflate(scanlines, {
      level: zlib.constants.Z_BEST_COMPRESSION,
      memLevel: 9,
      strategy: zlib.constants.Z_DEFAULT_STRATEGY,
    });

    if (optimized.length >= compressed.length) return original;

    const output = [PNG_SIGNATURE];
    let wroteImageData = false;
    for (const chunk of chunks) {
      if (chunk.type === "IDAT") {
        if (!wroteImageData) {
          output.push(pngChunk("IDAT", optimized));
          wroteImageData = true;
        }
        continue;
      }
      output.push(chunk.original);
    }
    const result = Buffer.concat(output);
    return result.length < original.length ? result : original;
  } catch {
    return original;
  }
}
