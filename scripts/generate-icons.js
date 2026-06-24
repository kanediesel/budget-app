// Generate the PNG icons iOS needs from icon.svg (apple-touch-icon must be PNG).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ICONS = path.join(__dirname, '..', 'public', 'icons');
const svg = fs.readFileSync(path.join(ICONS, 'icon.svg'));

const targets = [
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'maskable-512.png', size: 512 }, // our svg already has padding + full-bleed bg → maskable-safe
];

(async () => {
  for (const t of targets) {
    await sharp(svg, { density: 384 }).resize(t.size, t.size).png().toFile(path.join(ICONS, t.name));
    console.log('wrote', t.name);
  }
})().catch((e) => { console.error(e); process.exit(1); });
