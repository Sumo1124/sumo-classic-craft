// Prove the read-only RPC proxy cannot be turned into a write or an arbitrary
// contract proxy. The upstream fetch is injected, so this never hits the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRpc } from '../backend/rpc.mjs';

const config = {
  sumoCoin: `0x${'11'.repeat(20)}`,
  sumoCollection: `0x${'22'.repeat(20)}`,
};
const rpcUrl = 'https://sepolia.example.invalid';

function request(body, { method = 'POST', origin = 'https://game.example' } = {}) {
  return new Request('https://game.example/api/rpc', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

function callBody(to, data = '0x18160ddd') {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  };
}

test('rejects non-POST requests', async () => {
  const response = await readRpc(request(null, { method: 'GET' }), config, rpcUrl);
  assert.equal(response.status, 405);
});

test('rejects cross-origin requests', async () => {
  const response = await readRpc(request(callBody(config.sumoCoin), { origin: 'https://evil.example' }), config, rpcUrl);
  assert.equal(response.status, 403);
});

test('rejects write and admin methods', async () => {
  const response = await readRpc(
    request({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0xdead'] }),
    config,
    rpcUrl,
  );
  assert.equal(response.status, 403);
});

test('rejects eth_call to an unrelated contract', async () => {
  const response = await readRpc(request(callBody(`0x${'33'.repeat(20)}`)), config, rpcUrl);
  assert.equal(response.status, 403);
});

test('allows eth_call to the configured contracts', async () => {
  let forwarded = null;
  const fakeFetch = async (_url, init) => {
    forwarded = JSON.parse(init.body);
    return Response.json({ jsonrpc: '2.0', id: 1, result: '0x1' });
  };
  const response = await readRpc(request(callBody(config.sumoCollection)), config, rpcUrl, fakeFetch);
  assert.equal(response.status, 200);
  assert.equal(forwarded.method, 'eth_call');
  const payload = await response.json();
  assert.equal(payload.result, '0x1');
});

test('maps upstream failure to 503', async () => {
  const failingFetch = async () => {
    throw new Error('network down');
  };
  const response = await readRpc(request(callBody(config.sumoCoin)), config, rpcUrl, failingFetch);
  assert.equal(response.status, 503);
});
