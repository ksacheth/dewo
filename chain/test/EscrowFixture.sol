// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MissionEscrow} from "../src/MissionEscrow.sol";
import {IHederaTokenService} from "../src/interfaces/IHederaTokenService.sol";

contract TestToken is ERC20 {
    enum BlockMode {
        Revert,
        ReturnFalse
    }

    mapping(address => bool) public blocked;
    BlockMode public blockMode;

    constructor() ERC20("Test USDC", "USDC") {}

    function setBlocked(address account, bool isBlocked, BlockMode mode) external {
        blocked[account] = isBlocked;
        blockMode = mode;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (blocked[to]) {
            if (blockMode == BlockMode.Revert) revert("blocked");
            return false;
        }
        return super.transfer(to, value);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

abstract contract EscrowFixture is Test {
    MissionEscrow internal escrow;
    TestToken internal token;
    address internal requester = address(0x100);
    address internal worker = address(0x200);
    uint256 internal constant BOUNTY = 10_000_000;
    uint8 internal constant DIFFICULTY = 1;
    uint16 internal constant RISK_BPS = 2500;
    bytes32 internal constant SEED = keccak256("seed");
    uint32 internal constant MAX_STEPS = 60;
    uint32 internal constant MAX_COLLISIONS = 1;
    uint256 internal constant PRICE = 6_000_000;
    uint256 internal constant STAKE = 1_700_000;
    bytes32 internal constant EVIDENCE = keccak256("episode-evidence");
    bytes32 internal missionId;
    MissionEscrow.Deadlines internal deadlines;
    address[3] internal verifiers;

    function setUp() public virtual {
        vm.chainId(296);
        vm.warp(1000);
        token = new TestToken();
        vm.mockCall(
            address(0x167), abi.encodeWithSelector(IHederaTokenService.associateToken.selector), abi.encode(int64(22))
        );
        escrow = new MissionEscrow(address(token));
        verifiers = [vm.addr(11), vm.addr(22), vm.addr(33)];
        deadlines = MissionEscrow.Deadlines(1060, 30, 300, 4600);
        token.mint(requester, BOUNTY * 10);
        token.mint(worker, BOUNTY * 10);
        vm.prank(requester);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(worker);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(requester);
        missionId =
            escrow.createMission(SEED, verifiers, deadlines, BOUNTY, DIFFICULTY, RISK_BPS, MAX_STEPS, MAX_COLLISIONS);
    }

    function _sign(bytes32 digest, uint256 key) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sigs(bytes32 digest) internal pure returns (bytes[2] memory signatures) {
        signatures[0] = _sign(digest, 11);
        signatures[1] = _sign(digest, 22);
    }

    function _award() internal {
        vm.warp(deadlines.biddingEndsAt);
        escrow.award(missionId, worker, PRICE, STAKE, _sigs(escrow.awardDigest(missionId, worker, PRICE, STAKE)));
    }

    function _stake() internal {
        _award();
        vm.prank(worker);
        escrow.stake(missionId);
    }

    function _settle(MissionEscrow.Outcome outcome) internal {
        escrow.settle(missionId, outcome, EVIDENCE, _sigs(escrow.verdictDigest(missionId, outcome, EVIDENCE)));
    }
}
