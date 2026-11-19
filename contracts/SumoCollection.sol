// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Sumo Classic Craft Collection ($SUMOCC)
/// @notice Minimal ERC-721 for World of CarrickCraft. Metadata lives on IPFS
///         via Pinata; the owner mints with an explicit token URI, or sets a
///         base URI to an IPFS folder so `tokenURI` resolves to `<baseURI><id>.json`.
/// @dev Hand-written (ERC-721 + ERC-165) to keep the toolchain to `solc` alone.
contract SumoCollection {
    string public constant name = "Sumo Classic Craft: World of CarrickCraft";
    string public constant symbol = "SUMOCC";
    uint256 public constant MAX_SUPPLY = 5000;

    address public owner;
    string public baseURI;
    uint256 public nextTokenId = 1;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(uint256 => string) private _tokenURIs;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event BaseURIChanged(string baseURI);

    error NotOwner();
    error ZeroAddress();
    error MaxSupplyReached();
    error TokenDoesNotExist();
    error NotTokenOwnerOrApproved();
    error WrongFrom();
    error UnsafeRecipient();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0x80ac58cd || // ERC-721
            interfaceId == 0x5b5e139f; // ERC-721 Metadata
    }

    function totalSupply() external view returns (uint256) {
        return nextTokenId - 1;
    }

    function balanceOf(address account) external view returns (uint256) {
        if (account == address(0)) revert ZeroAddress();
        return _balances[account];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert TokenDoesNotExist();
        return tokenOwner;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
        string memory explicitURI = _tokenURIs[tokenId];
        if (bytes(explicitURI).length > 0) return explicitURI;
        return string(abi.encodePacked(baseURI, _toString(tokenId), ".json"));
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address account, address operator) external view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    function setBaseURI(string calldata nextBaseURI) external onlyOwner {
        baseURI = nextBaseURI;
        emit BaseURIChanged(nextBaseURI);
    }

    /// @notice Mint one token with an explicit metadata URI (e.g. ipfs://<cid>).
    function mint(address to, string calldata uri) external onlyOwner returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (nextTokenId > MAX_SUPPLY) revert MaxSupplyReached();
        tokenId = nextTokenId;
        nextTokenId = tokenId + 1;
        _owners[tokenId] = to;
        unchecked {
            _balances[to] += 1;
        }
        if (bytes(uri).length > 0) _tokenURIs[tokenId] = uri;
        emit Transfer(address(0), to, tokenId);
    }

    function approve(address to, uint256 tokenId) external {
        address tokenOwner = ownerOf(tokenId);
        if (msg.sender != tokenOwner && !_operatorApprovals[tokenOwner][msg.sender]) {
            revert NotTokenOwnerOrApproved();
        }
        _tokenApprovals[tokenId] = to;
        emit Approval(tokenOwner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        address tokenOwner = ownerOf(tokenId);
        if (tokenOwner != from) revert WrongFrom();
        if (to == address(0)) revert ZeroAddress();
        if (
            msg.sender != tokenOwner &&
            msg.sender != _tokenApprovals[tokenId] &&
            !_operatorApprovals[tokenOwner][msg.sender]
        ) {
            revert NotTokenOwnerOrApproved();
        }
        delete _tokenApprovals[tokenId];
        unchecked {
            _balances[from] -= 1;
            _balances[to] += 1;
        }
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public {
        transferFrom(from, to, tokenId);
        if (to.code.length > 0) {
            bytes4 selector = IERC721Receiver(to).onERC721Received(
                msg.sender,
                from,
                tokenId,
                data
            );
            if (selector != IERC721Receiver.onERC721Received.selector) revert UnsafeRecipient();
        }
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}

interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}
