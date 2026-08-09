// PWA 用アイコンを SVG から生成する。
// sharp は @nas-fm/server の依存（npm workspaces でルート node_modules に hoist 済み）を利用するため、
// このモノレポの外では単体で動かない。
// 実行: node apps/web/scripts/generate-pwa-icons.mjs
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const BG = "#18181b";
const FG = "#fafafa";

// 512x512 の NAS/ドライブをモチーフにした単色グリフ。
// 本体(272x152)は中心(256,256)基準で対称配置のため、そのままで maskable safe zone
// （中心から半径 204.8px の円）に収まる。専用の maskable 版 SVG は不要。
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  <rect x="120" y="180" width="272" height="152" rx="24" fill="${FG}"/>
  <rect x="152" y="268" width="208" height="16" rx="8" fill="${BG}"/>
  <circle cx="352" cy="300" r="12" fill="${BG}"/>
</svg>`;

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../public/icons");
await mkdir(outDir, { recursive: true });

const svgBuffer = Buffer.from(svg);

await sharp(svgBuffer).resize(192, 192).png().toFile(path.join(outDir, "icon-192.png"));
await sharp(svgBuffer).resize(512, 512).png().toFile(path.join(outDir, "icon-512.png"));
await sharp(svgBuffer).resize(512, 512).png().toFile(path.join(outDir, "icon-maskable-512.png"));
await sharp(svgBuffer)
  .resize(180, 180)
  .flatten({ background: BG })
  .png()
  .toFile(path.join(outDir, "apple-touch-icon.png"));

console.log(`icons written to ${outDir}`);
