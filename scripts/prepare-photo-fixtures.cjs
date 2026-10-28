// Optional public-domain fixtures. Images and generated controls stay ignored.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../backend/node_modules/sharp');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.local/ocr-evaluation/fixtures');

async function main() {
  fs.mkdirSync(directory, { recursive: true });
  const controls = [
    { file: 'latin-control.png', text: 'DIS MANIBVS\nC PORCIVS DIONYSIVS\nFILIO DVLCISSIMO' },
    { file: 'greek-control.png', text: 'ΑΧΙΛΛΕΟΥΣ ΕΝΘΑ ΔΕ ΚΙΤΕ ΖΗΣΑΣ\nΒΕΙΟΝ ΑΜΕΜΠΤΟΝ ΤΕΛΕΥΤΑ ΤΗ ΠΡΟ' },
    { file: 'english-control.png', text: 'ROMAN INSCRIPTION\nEXAMINE EVERY LETTER\nBEFORE SAVING' },
  ];
  for (const control of controls) {
    const lines = control.text.split('\n');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1700" height="460"><rect width="100%" height="100%" fill="white"/>${lines.map((line, index) => `<text x="60" y="${115 + index * 130}" font-family="serif" font-size="64" fill="black">${line}</text>`).join('')}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(directory, control.file));
  }
  await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#c9bea8' } }).png().toFile(path.join(directory, 'blank-control.png'));
  const sources = [];
  for (const id of [256771, 466087, 465925]) {
    const metadata = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { signal: AbortSignal.timeout(15000) });
    if (!metadata.ok) throw new Error(`Museum metadata unavailable for ${id}`);
    const object = await metadata.json();
    if (!object.isPublicDomain || !object.primaryImage) throw new Error(`No public-domain photograph for ${id}`);
    const url = new URL(object.primaryImage);
    if (url.protocol !== 'https:' || url.hostname !== 'images.metmuseum.org') throw new Error('Unexpected museum image host');
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw new Error(`Museum image unavailable for ${id}`);
    // Official museum images only; stop downloads that exceed the fixture budget.
    const reader = response.body.getReader();
    const chunks = []; let count = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        count += value.length; if (count > 20 * 1024 * 1024) throw new Error('Museum fixture exceeds 20 MB');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    await sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000 }).resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 }).toFile(path.join(directory, `met-${id}.jpg`));
    sources.push({ id, title: object.title, url: object.objectURL, image: object.primaryImage, credit: object.creditLine, license: 'Met Open Access / public domain' });
  }
  fs.writeFileSync(path.join(directory, '../public-fixture-manifest.json'), JSON.stringify({ controls, sources, warning: 'Generated controls and selected public-domain photos are workflow fixtures, not an accuracy benchmark.' }, null, 2));
  console.log(`Prepared ${controls.length} text controls, a blank and ${sources.length} public-domain photos in .local/ocr-evaluation/fixtures.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
