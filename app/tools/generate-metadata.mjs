// Emit ERC-721 metadata JSON for every curated collection entry.
//
//   npm run metadata
//
// Output: app/build/metadata/<id>.json
// The image URI is `ipfs://<IPFS_IMAGE_CID>/<basename>` when IPFS_IMAGE_CID is
// set (the CID returned by `npm run upload:pinata`), otherwise a clear
// placeholder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCollectionMetadata } from './collection-metadata.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(here, '..', '..');
const manifestFile = path.join(appRoot, 'data', 'collection.json');
const outDir = path.join(appRoot, 'build', 'metadata');

if (!existsSync(manifestFile)) {
  console.error('[metadata] missing app/data/collection.json');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const imageRoot = path.resolve(repoRoot, manifest.imageRoot ?? 'public');

let records;
try {
  records = buildCollectionMetadata({
    manifest,
    imageRoot,
    imageCid: process.env.IPFS_IMAGE_CID ?? '',
    externalUrl: process.env.SUMO_EXTERNAL_URL ?? '',
  });
} catch (error) {
  console.error(`[metadata] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const record of records) {
  writeFileSync(path.join(outDir, record.file), `${JSON.stringify(record.content, null, 2)}\n`);
  console.log(`[metadata] wrote build/metadata/${record.file}`);
}

console.log(`[metadata] ok — ${records.length} token metadata file(s)`);
