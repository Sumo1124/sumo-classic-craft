// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Sumo Coin ($SUMO)
/// @notice Sepolia ERC-20 earned in Sumo Classic Craft. The game server signs an
///         EIP-712 `Claim(to, amount, nonce)` voucher; the player submits it and the
///         contract mints to their own wallet. The server never holds player funds.
/// @dev Hand-written to keep the toolchain to `solc` alone.
contract SumoCoin {
    string public constant name = "Sumo Coin";
    string public constant symbol = "SUMO";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public owner;
    address public claimSigner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(uint256 => bool)) public usedNonce;

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address to,uint256 amount,uint256 nonce)");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant HASHED_NAME = keccak256(bytes("SumoCoin"));
    bytes32 private constant HASHED_VERSION = keccak256(bytes("1"));
    bytes32 private immutable _domainSeparator;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event ClaimSignerChanged(address indexed signer);
    event Claimed(address indexed to, uint256 amount, uint256 nonce);

    error NotOwner();
    error ZeroAddress();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error InsufficientBalance();
    error InsufficientAllowance();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialClaimSigner) {
        owner = msg.sender;
        claimSigner = initialClaimSigner;
        _domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                HASHED_NAME,
                HASHED_VERSION,
                block.chainid,
                address(this)
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator;
    }

    /// @notice The exact digest the game server signs for a claim.
    function claimDigest(address to, uint256 amount, uint256 nonce) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator,
                keccak256(abi.encode(CLAIM_TYPEHASH, to, amount, nonce))
            )
        );
    }

    function setClaimSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        claimSigner = signer;
        emit ClaimSignerChanged(signer);
    }

    /// @notice Mint $SUMO to `to` with a server-signed voucher. One use per (to, nonce).
    function claim(address to, uint256 amount, uint256 nonce, bytes calldata signature) external {
        if (usedNonce[to][nonce]) revert NonceAlreadyUsed();
        bytes32 digest = claimDigest(to, amount, nonce);
        if (_recover(digest, signature) != claimSigner) revert InvalidSignature();
        usedNonce[to][nonce] = true;
        _mint(to, amount);
        emit Claimed(to, amount, nonce);
    }

    /// @notice Owner treasury/dev mint. Not used by gameplay claims.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = balance - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        unchecked {
            balanceOf[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }
}
