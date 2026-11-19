// Pin the curated collection art + ERC-721 metadata to IPFS through Pinata.
//
//   node app/tools/upload-pinata.mjs --dry-run   # list the plan, no network
//   npm run upload:pinata                        # requires PINATA_JWT
//
// Writes app/deployment/ipfs.json with a direct tokenURI for every guardian.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(here, '..', '..');
const dryRun = process.argv.includes('--dry-run');
const PINATA_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const PINATA_JSON_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

function fail(message) {
  console.error(`[pinata] ${message}`);
  process.exit(1);
}

function mimeFor(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

const manifestFile = path.join(appRoot, 'data', 'collection.json');
if (!existsSync(manifestFile)) fail('missing app/data/collection.json');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const items = Array.isArray(manifest.items) ? manifest.items : [];
if (items.length === 0) fail('collection.json has no items');

const imageRoot = path.resolve(repoRoot, manifest.imageRoot ?? 'public');
for (const item of items) {
  if (!existsSync(path.join(imageRoot, item.image))) {
    fail(`image not found: ${item.image}`);
  }
}

if (dryRun) {
  console.log('[pinata] dry run — no network calls');
  console.log(`  collection: ${manifest.name}`);
  console.log(`  images to pin: ${items.length}`);
  for (const item of items) console.log(`    - ${item.id}: ${item.image}`);
  console.log(`  metadata JSON to pin: ${items.length}`);
  console.log('  index JSON to pin: 1');
  console.log(`  PINATA_JWT configured: ${(process.env.PINATA_JWT ?? '').trim() ? 'yes' : 'no'}`);
  process.exit(0);
}

const jwt = (process.env.PINATA_JWT ?? '').trim();
if (!jwt) fail('PINATA_JWT is required (see .env.example)');

async function pinFile(absPath, name) {
  const form = new FormData();
  const bytes = readFileSync(absPath);
  form.append('file', new Blob([bytes], { type: mimeFor(absPath) }), path.basename(absPath));
  form.append('pinataMetadata', JSON.stringify({ name }));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
  const response = await fetch(PINATA_FILE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!response.ok) {
    fail(`pinFileToIPFS ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  if (typeof payload.IpfsHash !== 'string') fail('Pinata returned no IpfsHash');
  return payload.IpfsHash;
}

async function pinJson(content, name) {
  const response = await fetch(PINATA_JSON_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pinataContent: content,
      pinataMetadata: { name },
      pinataOptions: { cidVersion: 1 },
    }),
  });
  if (!response.ok) {
    fail(`pinJSONToIPFS ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  if (typeof payload.IpfsHash !== 'string') fail('Pinata returned no IpfsHash');
  return payload.IpfsHash;
}

const pinned = [];
for (const item of items) {
  const abs = path.join(imageRoot, item.image);
  const imageCid = await pinFile(abs, `sumo-classic-craft-${item.id}-${path.basename(item.image)}`);
  console.log(`[pinata] image ${item.id} → ipfs://${imageCid}`);
  const metadata = {
    name: item.name,
    description: item.description,
    image: `ipfs://${imageCid}`,
    attributes: Array.isArray(item.traits) ? item.traits : [],
  };
  const tokenCid = await pinJson(metadata, `sumo-classic-craft-${item.id}-metadata`);
  console.log(`[pinata] metadata ${item.id} → ipfs://${tokenCid}`);
  pinned.push({
    id: item.id,
    name: item.name,
    image: `ipfs://${imageCid}`,
    tokenURI: `ipfs://${tokenCid}`,
  });
}

const index = {
  name: manifest.name,
  description: manifest.description,
  items: pinned,
  updatedAt: new Date().toISOString(),
};
const indexCid = await pinJson(index, 'sumo-classic-craft-carrickcraft-index');
console.log(`[pinata] index → ipfs://${indexCid}`);

const deploymentsDir = path.join(appRoot, 'deployment');
mkdirSync(deploymentsDir, { recursive: true });
const outFile = path.join(deploymentsDir, 'ipfs.json');
writeFileSync(
  outFile,
  `${JSON.stringify({ indexCid, indexURI: `ipfs://${indexCid}`, items: pinned, updatedAt: index.updatedAt }, null, 2)}\n`,
);
console.log(`[pinata] wrote ${path.relative(process.cwd(), outFile)}`);
console.log('[pinata] mint each guardian with its tokenURI from app/deployment/ipfs.json');
console.log('[pinata] SUMO_COLLECTION_BASE_URI is only needed for a separately uploaded metadata folder');
