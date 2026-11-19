// Sumo Classic Craft: one small Node server for World of CarrickCraft.
// Serves the built client, exposes the read-only chain proxy, signs SUMO claim
// vouchers, and reports collection
// data. No database: claim nonces live in a JSON file (see store.mjs).
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChainConfig } from './chain-config.mjs';
import { readRpc } from './rpc.mjs';
import { createClaimSigner } from './claim.mjs';
import { createClaimStore, createGameStore } from './store.mjs';
import { GameError, createGame } from './game.mjs';
import { createAdventure } from './adventure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const distRoot = path.join(repoRoot, 'dist');
const collectionFile = path.join(repoRoot, 'app', 'data', 'collection.json');
const store = createClaimStore(
  process.env.SUMO_CLAIM_STORE ?? path.join(repoRoot, 'app', 'data', 'claims.local.json'),
);

const config = readChainConfig();
const chainId = config.chainId;
const claimSigner =
  config.sumoCoin && process.env.SUMO_CLAIM_SIGNER_KEY
    ? createClaimSigner({
        key: process.env.SUMO_CLAIM_SIGNER_KEY,
        chainId,
        verifyingContract: config.sumoCoin,
      })
    : null;

const itemCount = JSON.parse(readFileSync(collectionFile, 'utf8')).items.length;
const gameStore = createGameStore(
  process.env.SUMO_GAME_STORE ?? path.join(repoRoot, 'app', 'data', 'game.local.json'),
);
const game = createGame({
  store: gameStore,
  claimSigner,
  nextNonce: (address) => store.nextNonce(address),
  itemCount,
});
const adventure = createAdventure({ store: gameStore });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 16000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, limit = 4000) {
  try {
    return JSON.parse((await readBody(req, limit)).toString('utf8'));
  } catch {
    throw new GameError('Invalid JSON body.', 400);
  }
}

function serveStatic(res, urlPath) {
  if (!existsSync(path.join(distRoot, 'index.html'))) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('client not built: run npm run build');
    return;
  }
  const relative = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  let file = path.normalize(path.join(distRoot, relative));
  if (!file.startsWith(distRoot)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || !path.extname(file)) file = path.join(distRoot, 'index.html');
  const body = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname === '/livez') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      sendJson(res, 200, {
        chainId,
        sumoCoin: config.sumoCoin,
        sumoCollection: config.sumoCollection,
        claimEnabled: claimSigner !== null,
        claimSigner: claimSigner?.address ?? null,
        explorer: 'https://sepolia.etherscan.io',
      });
      return;
    }

    if (url.pathname === '/api/collection' && req.method === 'GET') {
      const manifest = JSON.parse(readFileSync(collectionFile, 'utf8'));
      sendJson(res, 200, {
        name: manifest.name,
        description: manifest.description,
        items: manifest.items.map((item) => ({ ...item, image: `/${item.image}` })),
      });
      return;
    }

    if (url.pathname === '/api/rpc') {
      const body = await readBody(req);
      // viem omits `params` for parameterless methods (eth_chainId,
      // eth_blockNumber), which JSON-RPC allows. The read-only proxy requires
      // an array, so restore the empty one instead of loosening its checks.
      let payload = body;
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        if (parsed && !Array.isArray(parsed) && parsed.params === undefined) parsed.params = [];
        payload = Buffer.from(JSON.stringify(parsed));
      } catch {
        // Leave malformed JSON for readRpc to reject with its own message.
      }
      const request = new Request(url, {
        method: req.method,
        headers: { 'content-type': 'application/json', origin: req.headers.origin ?? url.origin },
        ...(req.method === 'POST' ? { body: payload } : {}),
      });
      const response = await readRpc(request, config, config.publicRpc);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (url.pathname === '/api/game/stages' && req.method === 'GET') {
      sendJson(res, 200, game.stages(url.searchParams.get('address')));
      return;
    }

    if (url.pathname === '/api/game/start' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, game.start(input?.address, input?.stage, input?.guardianId));
      return;
    }

    if (url.pathname === '/api/game/flip' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, game.flip({
        address: input?.address,
        stageId: input?.stage,
        sessionId: input?.sessionId,
        index: input?.index,
      }));
      return;
    }

    if (url.pathname === '/api/game/complete' && req.method === 'POST') {
      const input = await readJson(req);
      // Rewards require a server-tracked clear and wallet ownership proof.
      sendJson(
        res,
        200,
        await game.complete({
          address: input?.address,
          stageId: input?.stage,
          sessionId: input?.sessionId,
          signature: input?.signature,
        }),
      );
      return;
    }

    if (url.pathname === '/api/game/daily' && req.method === 'GET') {
      sendJson(res, 200, game.daily(url.searchParams.get('address')));
      return;
    }

    if (url.pathname === '/api/game/daily/start' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, game.dailyStart(input?.address, input?.step, input?.guardianId));
      return;
    }

    if (url.pathname === '/api/game/daily/flip' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, game.dailyFlip({
        address: input?.address,
        sessionId: input?.sessionId,
        index: input?.index,
      }));
      return;
    }

    if (url.pathname === '/api/game/daily/complete' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, await game.dailyComplete({
        address: input?.address,
        sessionId: input?.sessionId,
        signature: input?.signature,
      }));
      return;
    }

    if (url.pathname === '/api/adventure' && req.method === 'GET') {
      sendJson(res, 200, adventure.overview(url.searchParams.get('address')));
      return;
    }

    if (url.pathname === '/api/adventure/class' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.chooseClass(input?.address, input?.className));
      return;
    }

    if (url.pathname === '/api/adventure/quest/accept' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.acceptQuest(input?.address, input?.questId));
      return;
    }

    if (url.pathname === '/api/adventure/quest/turnin' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.turnInQuest(input?.address, input?.questId));
      return;
    }

    if (url.pathname === '/api/adventure/battle/start' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.startBattle(input?.address, input?.zoneId, input?.mobId));
      return;
    }

    if (url.pathname === '/api/adventure/battle/action' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.act(input?.address, input?.abilityId, input?.itemId));
      return;
    }

    if (url.pathname === '/api/adventure/battle/resolve' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.resolveBattle(input?.address, input));
      return;
    }

    if (url.pathname === '/api/adventure/battle/flee' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.flee(input?.address));
      return;
    }

    if (url.pathname === '/api/adventure/rest' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.rest(input?.address));
      return;
    }

    if (url.pathname === '/api/adventure/item' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.useItem(input?.address, input?.itemId));
      return;
    }

    if (url.pathname === '/api/adventure/equip' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.equip(input?.address, input?.itemId));
      return;
    }

    if (url.pathname === '/api/adventure/unequip' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.unequip(input?.address, input?.slot));
      return;
    }

    if (url.pathname === '/api/adventure/farm/plant' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.plant(input?.address, input?.index, input?.cropId));
      return;
    }

    if (url.pathname === '/api/adventure/farm/harvest' && req.method === 'POST') {
      const input = await readJson(req);
      sendJson(res, 200, adventure.harvest(input?.address, input?.index));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    if (error instanceof GameError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Internal error.' });
  }
});

const port = Number(process.env.PORT || 8788);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
  console.log(`[sumo-classic-craft] http://${host}:${port}/  (chain ${chainId}, claims ${claimSigner ? 'on' : 'off'})`);
});
