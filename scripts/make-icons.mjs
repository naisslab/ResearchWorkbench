import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const iconset = path.join(root, 'build/icon.iconset');
mkdirSync(iconset, { recursive: true });
// build/icon.png is rendered from the imagegen-derived vector master.
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = size * scale;
    const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
    execFileSync('/usr/bin/sips', ['-z', String(pixels), String(pixels), 'build/icon.png', '--out', path.join(iconset, name)], { stdio: 'ignore' });
  }
}
// ICNS supports PNG-backed chunks. Write the container directly so generation
// also works when macOS iconutil's encoding service is unavailable.
const records = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]];
const sizes = new Map([[16, 'icon_16x16.png'], [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'], [128, 'icon_128x128.png'], [256, 'icon_256x256.png'], [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png']]);
const chunks = records.map(([type, pixels]) => {
  const png = readFileSync(path.join(iconset, sizes.get(pixels)));
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
});
const header = Buffer.alloc(8);
header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
writeFileSync('build/icon.icns', Buffer.concat([header, ...chunks]));
console.log('Generated build/icon.icns at 16–1024 pixels');
