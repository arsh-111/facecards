// Generates neutral PWA icons (a crescent moon) as PNG + SVG with no dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const outDir = new URL('../apps/web/public/icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size) {
  const bg = [11, 7, 16];
  const moon = [232, 180, 160];
  const rows = [];
  const r = size * 0.3;
  const cx = size * 0.5;
  const cy = size * 0.5;
  const ox = cx + r * 0.45;
  const oy = cy - r * 0.25;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      // 2x2 supersampling for smooth edges
      let cover = 0;
      for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const px = x + dx;
        const py = y + dy;
        const inMoon = (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
        const inCut = (px - ox) ** 2 + (py - oy) ** 2 <= (r * 0.85) ** 2;
        if (inMoon && !inCut) cover += 0.25;
      }
      for (let i = 0; i < 3; i++) row[1 + x * 3 + i] = Math.round(bg[i] + (moon[i] - bg[i]) * cover);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) writeFileSync(new URL(`icon-${size}.png`, outDir), png(size));
writeFileSync(
  new URL('icon.svg', outDir),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0B0710"/><mask id="m"><rect width="64" height="64" fill="#fff"/><circle cx="40.6" cy="27.2" r="16.3" fill="#000"/></mask><circle cx="32" cy="32" r="19.2" fill="#E8B4A0" mask="url(#m)"/></svg>\n`,
);
console.log('icons written');
