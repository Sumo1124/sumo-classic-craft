// EIP-712 voucher signing for SumoCoin.claim(to, amount, nonce, signature).
// The domain and types mirror contracts/SumoCoin.sol exactly: the player
// submits the voucher from their own wallet, so the server never holds funds.
import { privateKeyToAccount } from 'viem/accounts';

export const CLAIM_TYPES = {
  Claim: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

export function claimDomain(chainId, verifyingContract) {
  return { name: 'SumoCoin', version: '1', chainId, verifyingContract };
}

export function createClaimSigner({ key, chainId, verifyingContract }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? '')) {
    throw new Error('SUMO_CLAIM_SIGNER_KEY must be 0x plus 64 hex characters');
  }
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    chainId,
    verifyingContract,
    async signClaim(message) {
      const signature = await account.signTypedData({
        domain: claimDomain(chainId, verifyingContract),
        primaryType: 'Claim',
        types: CLAIM_TYPES,
        message,
      });
      return { signature, signer: account.address };
    },
  };
}
