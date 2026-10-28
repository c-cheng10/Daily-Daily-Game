// Framebuffers -> PNG with no dependencies (zlib is built in). Used for the contact sheet the critic sees.
import zlib from "node:zlib";
import { PALETTE, W, H } from "../engine/engine.js";

const RGB = PALETTE.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Tile up to 16 framebuffers into a 4x4 grid, each scaled 2x with a 4px gap.
export function contactSheet(fbs, { cols = 4, scale = 2, gap = 4 } = {}) {
  const rows = Math.max(1, Math.ceil(fbs.length / cols));
  const cw = W * scale, ch = H * scale, width = cols * cw + (cols + 1) * gap, height = rows * ch + (rows + 1) * gap;
  const rgb = Buffer.alloc(width * height * 3, 40);
  fbs.forEach((fb, i) => {
    const ox = gap + (i % cols) * (cw + gap), oy = gap + Math.floor(i / cols) * (ch + gap);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const c = RGB[fb[Math.floor(y / scale) * W + Math.floor(x / scale)] & 15];
      const o = ((oy + y) * width + ox + x) * 3;
      rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
    }
  });
  return encodePng(width, height, rgb);
}
