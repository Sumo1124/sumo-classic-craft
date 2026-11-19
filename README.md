# Sumo Classic Craft

A Web3 guardian adventure set in the **World of CarrickCraft**. Players connect MetaMask, complete memory-matching challenges, explore a 3D adventure world, earn SUMO, and collect original NFT guardians on the Sepolia testnet.

## Features

- Six untimed Guardian Match chapters and a daily UTC quest trail
- 3D adventure gameplay with classes, quests, battles, equipment, items, and farming
- Local SUMO rewards with optional on-chain claims using EIP-712 signed vouchers
- Original eight-piece guardian NFT collection with IPFS metadata support
- MetaMask wallet integration and a same-origin, read-only Sepolia RPC proxy
- JSON-file persistence with no database required

## Tech Stack

- **Frontend:** TypeScript, Vite, Three.js, CSS
- **Backend:** Node.js HTTP server
- **Blockchain:** Solidity, viem, Sepolia, MetaMask
- **Storage:** Local JSON files and IPFS/Pinata
- **Testing:** Node.js built-in test runner

## Requirements

- Node.js 22 or newer
- npm
- MetaMask for gameplay
- Sepolia ETH for contract deployment and on-chain transactions

## Run Locally

```bash
npm install
npm start
```

Open [http://127.0.0.1:8788](http://127.0.0.1:8788). The first start builds the frontend automatically.

Local gameplay works without deployment or IPFS credentials. Copy `.env.example` to `.env` only when you need to change local settings or enable remote Web3 steps. Never commit `.env` or real private keys.

## Available Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Build if needed and serve the complete app |
| `npm run dev` | Start the Vite frontend development server |
| `npm run build` | Build the production frontend |
| `npm run check:ts` | Run TypeScript type checking |
| `npm test` | Compile contracts and run backend and contract tests |
| `npm run compile` | Compile the Solidity contracts |
| `npm run web3:preflight` | Check Web3 deployment and upload prerequisites |
| `npm run deploy:sepolia` | Deploy SUMO contracts to Sepolia |
| `npm run metadata` | Generate ERC-721 metadata files |
| `npm run upload:pinata` | Upload collection assets and metadata to Pinata |

## Sepolia Deployment

1. Copy `.env.example` to `.env`.
2. Set `SEPOLIA_RPC_URL` and a Sepolia-funded `DEPLOYER_PRIVATE_KEY`.
3. Optionally set `SUMO_CLAIM_SIGNER_ADDRESS`; otherwise, the deployer is used.
4. Compile, check the configuration, and deploy:

```bash
npm run compile
npm run web3:preflight
npm run deploy:sepolia
```

Deployment details are written to `app/deployment/sepolia.json`. To enable on-chain SUMO claims, also set `SUMO_CLAIM_SIGNER_KEY` to the private key matching the contract's claim signer, then restart the server.

For existing deployments, contract addresses can instead be supplied through `SUMO_COIN_ADDRESS` and `SUMO_COLLECTION_ADDRESS`. `SUMO_SEPOLIA_RPC_URL` configures server-side chain reads.

## NFT Collection

Collection artwork lives in `public/nft`, with its manifest in `app/data/collection.json`.

- Set `PINATA_JWT` and run `npm run upload:pinata` to upload assets and write direct per-token IPFS URIs.
- For the optional metadata-folder workflow, set `IPFS_IMAGE_CID`, `SUMO_EXTERNAL_URL`, and `SUMO_COLLECTION_BASE_URI`, then run `npm run metadata`.

Generated metadata is written to `app/build/metadata`.

## Project Structure

```text
contracts/          SUMO ERC-20 and guardian ERC-721 contracts
src/                TypeScript frontend, games, 3D battle, audio, and styles
app/backend/        Node server, game logic, persistence, RPC, and claim signing
app/tools/          Contract, deployment, metadata, and Pinata utilities
app/test/           Backend and game tests
app/chain-test/     Contract and RPC tests
app/data/           Collection manifest and local JSON progress
app/deployment/     Sepolia deployment receipts
public/nft/         Original guardian artwork
tools/              Local startup helper
```

## Testing

```bash
npm run check:ts
npm test
```

The test command compiles the contracts before running the backend, game, metadata, RPC, and contract test suites.
