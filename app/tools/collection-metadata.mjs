// Pure ERC-721 metadata builder shared by the CLI and the app tests.
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Build one metadata record per curated collection item.
 *
 * Throws when the manifest is empty or any referenced image is missing, so a
 * broken manifest never produces uploadable metadata.
 */
export function buildCollectionMetadata({ manifest, imageRoot, imageCid = '', externalUrl = '' }) {
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  if (items.length === 0) throw new Error('collection.json has no items');

  const missing = items.filter((item) => !existsSync(path.join(imageRoot, item.image)));
  if (missing.length > 0) {
    throw new Error(`image not found: ${missing.map((item) => item.image).join(', ')}`);
  }

  const cid = imageCid.trim();
  const external = externalUrl.trim();

  return items.map((item) => {
    const basename = path.basename(item.image);
    const image = cid
      ? `ipfs://${cid}/${basename}`
      : `ipfs://REPLACE_WITH_IMAGE_CID/${basename}`;
    return {
      id: item.id,
      file: `${item.id}.json`,
      content: {
        name: item.name,
        description: item.description,
        image,
        ...(external ? { external_url: `${external}/nft` } : {}),
        attributes: Array.isArray(item.traits) ? item.traits : [],
      },
    };
  });
}
