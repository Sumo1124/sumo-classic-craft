// Deploy SumoCoin + SumoCollection to Sepolia.
//
//   npm run deploy:sepolia -- --dry-run   # validate config, no network
//   npm run deploy:sepolia                # broadcasts
//
// Credentials come from the repository root .env (see .env.example). Nothing
// here runs automatically from the game server.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(here, '..', '..');
const dryRun = process.argv.includes('--dry-run');
const SEPOLIA_CHAIN_ID = 11155111;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

function fail(message) {
  console.error(`[deploy] ${message}`);
  process.exit(1);
}

function readArtifact(name) {
  const file = path.join(repoRoot, 'artifacts', `${name}.json`);
  if (!existsSync(file)) {
    fail(`missing artifacts/${name}.json — run: npm run compile`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

const rpcUrl = (process.env.SEPOLIA_RPC_URL ?? '').trim();
const privateKey = (process.env.DEPLOYER_PRIVATE_KEY ?? '').trim();
const claimSignerEnv = (process.env.SUMO_CLAIM_SIGNER_ADDRESS ?? '').trim();
const baseURI = (process.env.SUMO_COLLECTION_BASE_URI ?? '').trim();

const sumoCoin = readArtifact('SumoCoin');
const sumoCollection = readArtifact('SumoCollection');

if (dryRun) {
  console.log('[deploy] dry run — no network calls, no keys required');
  console.log(`  artifacts: SumoCoin (${sumoCoin.abi.length} abi), SumoCollection (${sumoCollection.abi.length} abi)`);
  console.log(`  chain: Sepolia ${SEPOLIA_CHAIN_ID}`);
  console.log(`  rpc configured: ${rpcUrl ? 'yes' : 'no (set SEPOLIA_RPC_URL)'}`);
  console.log(`  deployer key configured: ${HEX_PRIVATE_KEY.test(privateKey) ? 'yes' : 'no (set DEPLOYER_PRIVATE_KEY)'}`);
  console.log(`  claim signer: ${claimSignerEnv || 'defaults to deployer'}`);
  console.log(`  base URI: ${baseURI || '(none — mint with per-token URIs)'}`);
  console.log('  would deploy: SumoCoin(claimSigner), SumoCollection(), then setBaseURI when provided');
  process.exit(0);
}

if (!HEX_PRIVATE_KEY.test(privateKey)) fail('DEPLOYER_PRIVATE_KEY must be 0x + 64 hex chars');
if (!rpcUrl) fail('SEPOLIA_RPC_URL is required');
if (claimSignerEnv && !HEX_ADDRESS.test(claimSignerEnv)) {
  fail('SUMO_CLAIM_SIGNER_ADDRESS must be 0x + 40 hex chars');
}

const { createPublicClient, createWalletClient, getAddress, http, parseGwei } = await import('viem');
const { privateKeyToAccount } = await import('viem/accounts');
const { sepolia } = await import('viem/chains');

const account = privateKeyToAccount(privateKey);
const claimSigner = claimSignerEnv ? getAddress(claimSignerEnv) : account.address;
const transport = http(rpcUrl);
const wallet = createWalletClient({ account, chain: sepolia, transport });
const publicClient = createPublicClient({ chain: sepolia, transport });

console.log(`[deploy] deployer ${account.address} → Sepolia`);
console.log(`[deploy] claim signer ${claimSigner}`);

const coinHash = await wallet.deployContract({
  abi: sumoCoin.abi,
  bytecode: sumoCoin.bytecode,
  args: [claimSigner],
  gasPrice: parseGwei('2'),
});
console.log(`[deploy] SumoCoin tx ${coinHash}`);
const coinReceipt = await publicClient.waitForTransactionReceipt({ hash: coinHash });
if (!coinReceipt.contractAddress) fail('SumoCoin deployment produced no address');
console.log(`[deploy] SumoCoin ${coinReceipt.contractAddress}`);

const collectionHash = await wallet.deployContract({
  abi: sumoCollection.abi,
  bytecode: sumoCollection.bytecode,
  args: [],
  gasPrice: parseGwei('2'),
});
console.log(`[deploy] SumoCollection tx ${collectionHash}`);
const collectionReceipt = await publicClient.waitForTransactionReceipt({ hash: collectionHash });
if (!collectionReceipt.contractAddress) fail('SumoCollection deployment produced no address');
console.log(`[deploy] SumoCollection ${collectionReceipt.contractAddress}`);

if (baseURI) {
  const setBaseHash = await wallet.writeContract({
    address: collectionReceipt.contractAddress,
    abi: sumoCollection.abi,
    functionName: 'setBaseURI',
    args: [baseURI],
    gasPrice: parseGwei('2'),
  });
  await publicClient.waitForTransactionReceipt({ hash: setBaseHash });
  console.log(`[deploy] setBaseURI(${baseURI}) tx ${setBaseHash}`);
}

const deploymentsDir = path.join(appRoot, 'deployment');
mkdirSync(deploymentsDir, { recursive: true });
const outFile = path.join(deploymentsDir, 'sepolia.json');
writeFileSync(
  outFile,
  `${JSON.stringify(
    {
      chainId: SEPOLIA_CHAIN_ID,
      deployer: account.address,
      claimSigner,
      sumoCoin: coinReceipt.contractAddress,
      sumoCollection: collectionReceipt.contractAddress,
      baseURI: baseURI || null,
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);
console.log(`[deploy] wrote ${path.relative(process.cwd(), outFile)}`);
console.log('[deploy] next: copy sumoCoin → SUMO_COIN_ADDRESS and sumoCollection → SUMO_COLLECTION_ADDRESS');
