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

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

async function decodePngRgba(input) {
  const chunks = parsePng(input);
  if (!chunks) throw new Error("Invalid PNG data");
  const header = chunks.find(({ type }) => type === "IHDR")?.data;
  if (!header || header.length !== 13) throw new Error("Invalid PNG header");

  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const colorType = header[9];
  const interlace = header[12];
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error(
      `Unsupported PNG format: depth=${bitDepth}, color=${colorType}, interlace=${interlace}`,
    );
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowBytes = width * bytesPerPixel;
  const compressed = Buffer.concat(
    chunks.filter(({ type }) => type === "IDAT").map(({ data }) => data),
  );
  const filtered = await inflate(compressed);
  if (filtered.length !== (rowBytes + 1) * height) {
    throw new Error("Unexpected PNG scanline length");
  }

  const rgba = Buffer.allocUnsafe(width * height * 4);
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (rowBytes + 1)];
    const source = filtered.subarray(
      y * (rowBytes + 1) + 1,
      (y + 1) * (rowBytes + 1),
    );
    const row = Buffer.allocUnsafe(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const above = previous[x] || 0;
      const upperLeft =
        x >= bytesPerPixel ? previous[x - bytesPerPixel] || 0 : 0;
      const filteredValue = source[x];
      switch (filter) {
        case 0:
          row[x] = filteredValue;
          break;
        case 1:
          row[x] = (filteredValue + left) & 0xff;
          break;
        case 2:
          row[x] = (filteredValue + above) & 0xff;
          break;
        case 3:
          row[x] = (filteredValue + Math.floor((left + above) / 2)) & 0xff;
          break;
        case 4:
          row[x] =
            (filteredValue + paethPredictor(left, above, upperLeft)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG filter: ${filter}`);
      }
    }

    const outputOffset = y * width * 4;
    if (colorType === 6) {
      row.copy(rgba, outputOffset);
    } else {
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = x * 3;
        const targetOffset = outputOffset + x * 4;
        rgba[targetOffset] = row[sourceOffset];
        rgba[targetOffset + 1] = row[sourceOffset + 1];
        rgba[targetOffset + 2] = row[sourceOffset + 2];
        rgba[targetOffset + 3] = 0xff;
      }
    }
    previous = row;
  }
  return { width, height, rgba };
}

async function encodeRgbaPng(width, height, rgba) {
  const rowBytes = width * 4;
  const scanlines = Buffer.allocUnsafe((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (rowBytes + 1);
    scanlines[scanlineOffset] = 0;
    rgba.copy(
      scanlines,
      scanlineOffset + 1,
      y * rowBytes,
      (y + 1) * rowBytes,
    );
  }
  const compressed = await deflate(scanlines, {
    level: zlib.constants.Z_BEST_COMPRESSION,
    memLevel: 9,
    strategy: zlib.constants.Z_DEFAULT_STRATEGY,
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function composePngColumns(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("At least one PNG column is required");
  }
  if (inputs.length === 1) {
    return Buffer.isBuffer(inputs[0]) ? inputs[0] : Buffer.from(inputs[0]);
  }

  const columns = [];
  for (const input of inputs) {
    columns.push(
      await decodePngRgba(
        Buffer.isBuffer(input) ? input : Buffer.from(input),
      ),
    );
  }
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  const height = Math.max(...columns.map((column) => column.height));
  const rgba = Buffer.allocUnsafe(width * height * 4);

  let columnX = 0;
  for (const column of columns) {
    const background = column.rgba.subarray(0, 4);
    for (let y = 0; y < height; y += 1) {
      const targetOffset = (y * width + columnX) * 4;
      if (y < column.height) {
        column.rgba.copy(
          rgba,
          targetOffset,
          y * column.width * 4,
          (y + 1) * column.width * 4,
        );
      } else {
        for (let x = 0; x < column.width; x += 1) {
          background.copy(rgba, targetOffset + x * 4);
        }
      }
    }
    columnX += column.width;
  }
  return encodeRgbaPng(width, height, rgba);
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
