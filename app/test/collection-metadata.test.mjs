// Pin the metadata builder contract: one file per curated item, deterministic
// image URIs, and a hard failure on broken manifests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCollectionMetadata } from '../tools/collection-metadata.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function fixture({ items, files = ['a.webp'] }) {
  const root = mkdtempSync(path.join(tmpdir(), 'sumo-metadata-'));
  for (const file of files) writeFileSync(path.join(root, file), 'fixture');
  return { root, manifest: { name: 'Fixture', items } };
}

const item = {
  id: '1',
  name: 'Sumo #1',
  description: 'A fixture token.',
  image: 'a.webp',
  traits: [{ trait_type: 'Style', value: 'Classic' }],
};

test('emits one metadata record per item with a placeholder CID', () => {
  const { root, manifest } = fixture({ items: [item] });
  const records = buildCollectionMetadata({ manifest, imageRoot: root });
  assert.equal(records.length, 1);
  assert.equal(records[0].file, '1.json');
  assert.equal(records[0].content.image, 'ipfs://REPLACE_WITH_IMAGE_CID/a.webp');
  assert.deepEqual(records[0].content.attributes, item.traits);
});

test('uses the supplied image CID and external URL', () => {
  const { root, manifest } = fixture({ items: [item] });
  const [record] = buildCollectionMetadata({
    manifest,
    imageRoot: root,
    imageCid: ' bafyfixture ',
    externalUrl: 'https://sumo.example',
  });
  assert.equal(record.content.image, 'ipfs://bafyfixture/a.webp');
  assert.equal(record.content.external_url, 'https://sumo.example/nft');
});

test('refuses a manifest with no items', () => {
  const { root, manifest } = fixture({ items: [] });
  assert.throws(() => buildCollectionMetadata({ manifest, imageRoot: root }), /no items/);
});

test('refuses a missing image', () => {
  const { root, manifest } = fixture({ items: [{ ...item, image: 'missing.webp' }] });
  assert.throws(
    () => buildCollectionMetadata({ manifest, imageRoot: root }),
    /image not found: missing\.webp/,
  );
});

test('the shipped collection manifest resolves against public/', () => {
  const manifestPath = path.join(repoRoot, 'app', 'data', 'collection.json');
  assert.ok(existsSync(manifestPath), 'app/data/collection.json exists');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const records = buildCollectionMetadata({
    manifest,
    imageRoot: path.join(repoRoot, manifest.imageRoot ?? 'public'),
  });
  assert.equal(records.length, manifest.items.length);
  assert.ok(records.length > 0);
});
