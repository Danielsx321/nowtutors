// Renders the share card (public/brand/og.vN.png) from the vector wordmark.
// Run from the repo root: node scripts/render-og-card.mjs
// To change the slogan, edit SLOGAN and bump OUT so cached previews refresh.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const SLOGAN = "Instant Quality Tutoring";
const OUT = "public/brand/og.v2.png";

const root = process.cwd();
// sharp comes in through Next; resolve it from Next's real (pnpm) folder.
const require = createRequire(fs.realpathSync(path.join(root, "node_modules/next/package.json")));
const sharp = require("sharp");

const svg = fs.readFileSync(path.join(root, "public/brand/wordmark.v1.svg"), "utf8");
const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/fill="#000"/g, 'fill="#FFFFFF"');
const W = 720, H = (W * 163.25) / 1058, X = (1200 - W) / 2, Y = 198;
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<rect width="1200" height="630" fill="#1F2B3A"/>
<svg x="${X}" y="${Y}" width="${W}" height="${H}" viewBox="1 12.75 1058 163.25">${inner}</svg>
<text x="600" y="400" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="38" font-weight="500" fill="#FFFFFF">${SLOGAN}</text>
<rect x="560" y="439" width="80" height="4" fill="#BF4019"/>
</svg>`;

const info = await sharp(Buffer.from(card)).png({ compressionLevel: 9, palette: true }).toFile(path.join(root, OUT));
console.log(`${OUT}: ${info.width}x${info.height}, ${info.size} bytes`);
