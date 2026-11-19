// Resolve the public Sepolia chain configuration for the chain sidecar.
//
// Precedence: explicit environment values, then the public deployment receipt
// written by `npm run deploy:sepolia`, then null. Invalid addresses resolve to
// null instead of throwing, so a typo cannot crash a request.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDeploymentPath = path.resolve(here, '..', 'deployment', 'sepolia.json');
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DEFAULT_PUBLIC_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

function readReceipt(deploymentPath) {
  if (!existsSync(deploymentPath)) return null;
  try {
    return JSON.parse(readFileSync(deploymentPath, 'utf8'));
  } catch {
    return null;
  }
}

function pickAddress(...values) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (HEX_ADDRESS.test(trimmed)) return trimmed.toLowerCase();
  }
  return null;
}

export function readChainConfig(env = process.env, { deploymentPath = defaultDeploymentPath } = {}) {
  const receipt = readReceipt(deploymentPath);
  return {
    chainId: 11155111,
    sumoCoin: pickAddress(env.SUMO_COIN_ADDRESS, receipt?.sumoCoin),
    sumoCollection: pickAddress(env.SUMO_COLLECTION_ADDRESS, receipt?.sumoCollection),
    publicRpc: (env.SUMO_SEPOLIA_RPC_URL || env.SUMO_RPC_URL || DEFAULT_PUBLIC_RPC).trim(),
  };
}
