// Compile both contracts in memory and pin the public surface the deploy and
// claim flows rely on. No network, no broadcast.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(here, '..', '..', 'contracts');

function compileContracts() {
  const sources = {};
  for (const file of readdirSync(contractsDir).sort()) {
    if (!file.endsWith('.sol')) continue;
    sources[file] = { content: readFileSync(path.join(contractsDir, file), 'utf8') };
  }
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object'] },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], 'contracts compile without errors');
  return output.contracts;
}

const compiled = compileContracts();

function contractFile(name) {
  for (const contracts of Object.values(compiled)) {
    if (contracts[name]) return contracts[name];
  }
  assert.fail(`contract ${name} was not compiled`);
}

function abiNames(contract) {
  return new Set(contract.abi.map((entry) => entry.name).filter(Boolean));
}

test('both collection contracts compile', () => {
  const names = Object.values(compiled).flatMap((contracts) => Object.keys(contracts));
  assert.ok(names.includes('SumoCoin'));
  assert.ok(names.includes('SumoCollection'));
});

test('SumoCoin exposes the EIP-712 claim mint', () => {
  const coin = contractFile('SumoCoin');
  const names = abiNames(coin);
  for (const member of ['claim', 'claimSigner', 'setClaimSigner', 'usedNonce']) {
    assert.ok(names.has(member), `SumoCoin.${member} is present`);
  }
  assert.ok(coin.evm.bytecode.object.length > 0, 'SumoCoin has deployable bytecode');
});

test('SumoCollection exposes owner minting and metadata', () => {
  const collection = contractFile('SumoCollection');
  const names = abiNames(collection);
  for (const member of ['mint', 'setBaseURI', 'tokenURI', 'MAX_SUPPLY']) {
    assert.ok(names.has(member), `SumoCollection.${member} is present`);
  }
  assert.ok(collection.evm.bytecode.object.length > 0, 'SumoCollection has deployable bytecode');
});
