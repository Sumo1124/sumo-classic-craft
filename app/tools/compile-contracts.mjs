// Compile every contract in the repository root contracts/ directory with solc
// and emit lean artifacts under the root artifacts/ directory.
//
//   npm run compile
//
// solc is a root devDependency, so this runs offline after one install.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const contractsDir = path.join(repoRoot, 'contracts');
const outDir = path.join(repoRoot, 'artifacts');

const sources = {};
for (const file of readdirSync(contractsDir).sort()) {
  if (!file.endsWith('.sol')) continue;
  sources[file] = { content: readFileSync(path.join(contractsDir, file), 'utf8') };
}

if (Object.keys(sources).length === 0) {
  console.error('[compile] no .sol sources found in contracts/');
  process.exit(1);
}

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const diagnostics = output.errors ?? [];
for (const entry of diagnostics) {
  const line = `[compile] ${entry.severity}: ${entry.formattedMessage}`;
  if (entry.severity === 'error') console.error(line);
  else console.warn(line);
}
if (diagnostics.some((entry) => entry.severity === 'error')) process.exit(1);

mkdirSync(outDir, { recursive: true });
let emitted = 0;
for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
  for (const [contractName, contract] of Object.entries(contracts)) {
    const artifact = {
      contractName,
      source: `contracts/${file}`,
      solcVersion: solc.version(),
      abi: contract.abi,
      bytecode: `0x${contract.evm.bytecode.object}`,
      deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    };
    writeFileSync(
      path.join(outDir, `${contractName}.json`),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    emitted += 1;
    console.log(`[compile] wrote artifacts/${contractName}.json`);
  }
}

if (emitted === 0) {
  console.error('[compile] compiled no contracts');
  process.exit(1);
}
console.log(`[compile] ok — ${emitted} contract(s) via solc ${solc.version()}`);
