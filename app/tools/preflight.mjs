// Report which remote Web3 steps can run, without touching the network.
//
//   npm run web3:preflight
//
// Every MISSING row is something only the operator can supply (a Sepolia RPC, a
// funded key, a Pinata JWT, a Render account). Nothing here broadcasts, uploads,
// or applies a blueprint.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEX_KEY = /^0x[0-9a-f]{64}$/i;

function urlOk(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function inspectWeb3Readiness({ env = process.env, repoRoot, exists = existsSync }) {
  const rows = [];
  const row = (step, name, ok, detail) => rows.push({ step, name, status: ok ? 'ok' : 'missing', detail });

  for (const contract of ['SumoCoin', 'SumoCollection']) {
    row(
      'deploy',
      `artifacts/${contract}.json`,
      exists(path.join(repoRoot, 'artifacts', `${contract}.json`)),
      'run npm run compile',
    );
  }
  row(
    'deploy',
    'SEPOLIA_RPC_URL',
    urlOk((env.SEPOLIA_RPC_URL ?? '').trim()),
    'https endpoint from Alchemy, Infura, QuickNode or a public Sepolia RPC',
  );
  row(
    'deploy',
    'DEPLOYER_PRIVATE_KEY',
    HEX_KEY.test((env.DEPLOYER_PRIVATE_KEY ?? '').trim()),
    '0x plus 64 hex characters; fund it from a Sepolia faucet',
  );
  const signer = (env.SUMO_CLAIM_SIGNER_ADDRESS ?? '').trim();
  row(
    'deploy',
    'SUMO_CLAIM_SIGNER_ADDRESS',
    signer === '' || /^0x[0-9a-f]{40}$/i.test(signer),
    'optional; defaults to the deployer address when empty, otherwise 0x + 40 hex',
  );
  row(
    'pinata',
    'PINATA_JWT',
    (env.PINATA_JWT ?? '').trim().length > 20,
    'Pinata API key with Files:write, from app.pinata.cloud',
  );

  const manifestFile = path.join(repoRoot, 'app', 'data', 'collection.json');
  let artDetail = 'app/data/collection.json is missing';
  let artOk = false;
  if (exists(manifestFile)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      const root = path.resolve(repoRoot, manifest.imageRoot ?? 'public');
      const missing = (manifest.items ?? []).filter((item) => !exists(path.join(root, item.image)));
      artOk = missing.length === 0;
      artDetail = artOk
        ? `${manifest.items.length} item image(s) found`
        : `missing: ${missing.map((item) => item.image).join(', ')}`;
    } catch (error) {
      artDetail = error instanceof Error ? error.message : String(error);
    }
  }
  row('pinata', 'collection art', artOk, artDetail);

  const renderFile = path.join(repoRoot, 'render.yaml');
  const renderText = exists(renderFile) ? readFileSync(renderFile, 'utf8') : '';
  row(
    'render',
    'render.yaml blueprint',
    renderText.includes('dockerfilePath: ./Dockerfile') && renderText.includes('healthCheckPath: /livez'),
    'blueprint must reference the Dockerfile and /livez',
  );
  row(
    'render',
    'RENDER_API_KEY',
    (env.RENDER_API_KEY ?? '').trim().length > 0,
    'optional locally; needed only to apply the blueprint from a terminal',
  );

  return { ready: rows.every((entry) => entry.status === 'ok'), rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { ready, rows } = inspectWeb3Readiness({ repoRoot });
  for (const entry of rows) {
    console.log(`${entry.status === 'ok' ? 'OK     ' : 'MISSING'} ${entry.step.padEnd(7)} ${entry.name.padEnd(30)} ${entry.detail}`);
  }
  console.log(
    ready
      ? '\n[web3:preflight] all local prerequisites are present; remote steps still need real credentials.'
      : '\n[web3:preflight] fill the MISSING values in the root .env. Nothing was broadcast or uploaded.',
  );
  process.exit(ready ? 0 : 1);
}
