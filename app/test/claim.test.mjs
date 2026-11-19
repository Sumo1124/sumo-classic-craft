import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverTypedDataAddress } from 'viem';
import { CLAIM_TYPES, claimDomain, createClaimSigner } from '../backend/claim.mjs';

// Well-known Hardhat/Anvil test account #0. Never a real secret.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const COIN = `0x${'1'.repeat(40)}`;
const PLAYER = `0x${'2'.repeat(40)}`;

test('a claim voucher recovers to the claim signer under the SumoCoin domain', async () => {
  const signer = createClaimSigner({ key: KEY, chainId: 11155111, verifyingContract: COIN });
  const message = { to: PLAYER, amount: 1000n * 10n ** 18n, nonce: 1n };
  const { signature } = await signer.signClaim(message);
  const recovered = await recoverTypedDataAddress({
    domain: claimDomain(11155111, COIN),
    primaryType: 'Claim',
    types: CLAIM_TYPES,
    message,
    signature,
  });
  assert.equal(recovered.toLowerCase(), signer.address.toLowerCase());
});

test('a malformed signing key is rejected', () => {
  assert.throws(() => createClaimSigner({ key: 'nope', chainId: 11155111, verifyingContract: COIN }));
});
