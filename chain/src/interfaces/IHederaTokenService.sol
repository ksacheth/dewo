// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IHederaTokenService {
    function associateToken(address account, address token) external returns (int64 responseCode);
}
