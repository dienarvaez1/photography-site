// One-off dev utility: generates gradient placeholder photos so the site has
// something to render before you drop in real images. Safe to delete once
// every category has real photos. Run with: node scripts/generate-placeholders.mjs
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.join(__dirname, '..', 'src', 'content', 'photos');

const CATEGORIES = [
  { slug: 'real-estate', label: 'Real Estate', colors: ['#2b3a4a', '#4a6178'] },
  { slug: 'landscape', label: 'Landscape', colors: ['#1f4d3d', '#3f8a68'] },
  { slug: 'portrait', label: 'Portrait', colors: ['#4a2b3a', '#8a4f6b'] },
  { slug: 'astro', label: 'Astro', colors: ['#0d1230', '#2a2f6b'] },
  { slug: 'pets', label: 'Pets', colors: ['#4a3a1f', '#8a6b3f'] },
  { slug: 'events', label: 'Social Events', colors: ['#3a1f4a', '#6b3f8a'] },
];

const PHOTOS_PER_CATEGORY = 4;
const WIDTH = 1600;
const HEIGHT = 1067;

function svgFor(label, index, colorA, colorB) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${colorA}"/>
        <stop offset="100%" stop-color="${colorB}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="48%" font-family="Georgia, serif" font-size="64" fill="rgba(255,255,255,0.92)" text-anchor="middle">${label}</text>
    <text x="50%" y="58%" font-family="Helvetica, Arial, sans-serif" font-size="28" letter-spacing="4" fill="rgba(255,255,255,0.6)" text-anchor="middle">SAMPLE ${index}</text>
  </svg>`;
}

for (const category of CATEGORIES) {
  const dir = path.join(contentRoot, category.slug, 'images');
  await mkdir(dir, { recursive: true });
  for (let i = 1; i <= PHOTOS_PER_CATEGORY; i++) {
    const svg = svgFor(category.label, i, category.colors[0], category.colors[1]);
    const outFile = path.join(dir, `placeholder-${i}.jpg`);
    await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toFile(outFile);
    console.log('wrote', path.relative(process.cwd(), outFile));
  }
}

console.log('\nDone. These are placeholders — replace them with your real photos,');
console.log('then update the matching frontmatter in src/content/photos/**/*.md.');
