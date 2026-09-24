import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  DEFAULT_RPC_TIMEOUT_MS,
  EXPECTED_CHAIN_IDS,
  getRpcUrlForChain,
  SELECTOR_DECIMALS,
  SELECTOR_NAME,
  SELECTOR_SYMBOL,
} from './evm-rpc.constants';
import type { RpcTransaction, RpcTransactionReceipt, TokenMetadata } from './evm-rpc.interface';

interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

@Injectable()
export class EvmRpcClient {
  private readonly logger = new Logger(EvmRpcClient.name);
  private readonly http: AxiosInstance;
  private readonly validatedChains = new Set<string>();

  constructor() {
    this.http = axios.create({
      timeout: DEFAULT_RPC_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Performs JSON-RPC 2.0 call to chain's configured endpoint.
   */
  async rpcCall<T>(chain: string, method: string, params: unknown[] = []): Promise<T | null> {
    const rpcUrl = getRpcUrlForChain(chain);
    if (!rpcUrl) {
      return null;
    }

    // Verify chain ID on first connection to prevent querying the wrong network
    await this.verifyChainId(chain, rpcUrl);

    const payload = {
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1000000),
      method,
      params,
    };

    const res = await this.http.post<JsonRpcResponse<T>>(rpcUrl, payload);
    if (res.data?.error) {
      const err = res.data.error;
      const isTransientRpcError =
        err.code === 429 ||
        err.code === -32005 ||
        err.code === -32603 ||
        err.message?.toLowerCase().includes('rate limit') ||
        err.message?.toLowerCase().includes('timeout') ||
        err.message?.toLowerCase().includes('syncing');

      if (isTransientRpcError) {
        throw new Error(`RPC transient error: ${err.code} - ${err.message}`);
      }

      this.logger.debug(
        `RPC ${method} error on ${chain}: ${res.data.error.code} - ${res.data.error.message}`,
      );
      return null;
    }

    return res.data?.result ?? null;
  }

  /**
   * Verifies that the RPC endpoint actually matches the expected chain ID.
   */
  async verifyChainId(chain: string, rpcUrl: string): Promise<void> {
    const normalizedChain = chain.toLowerCase();
    if (this.validatedChains.has(normalizedChain)) {
      return;
    }

    const expectedId = EXPECTED_CHAIN_IDS[normalizedChain];
    if (!expectedId) {
      return;
    }

    try {
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
      };

      const res = await this.http.post<JsonRpcResponse<string>>(rpcUrl, payload);
      const chainIdHex = res.data?.result;
      if (chainIdHex) {
        const chainIdNum = Number.parseInt(chainIdHex, 16);
        if (chainIdNum !== expectedId) {
          throw new Error(
            `RPC chain ID mismatch for ${normalizedChain}: expected ${expectedId}, received ${chainIdNum}`,
          );
        }
      }
      this.validatedChains.add(normalizedChain);
    } catch (err) {
      this.logger.warn(
        `Failed chain ID verification on ${normalizedChain}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Retrieves transaction receipt including status and event logs.
   */
  async getTransactionReceipt(
    chain: string,
    transactionHash: string,
  ): Promise<RpcTransactionReceipt | null> {
    return await this.rpcCall<RpcTransactionReceipt>(chain, 'eth_getTransactionReceipt', [
      transactionHash.toLowerCase(),
    ]);
  }

  /**
   * Retrieves transaction input data and basic transaction details.
   */
  async getTransactionByHash(
    chain: string,
    transactionHash: string,
  ): Promise<RpcTransaction | null> {
    return await this.rpcCall<RpcTransaction>(chain, 'eth_getTransactionByHash', [
      transactionHash.toLowerCase(),
    ]);
  }

  /**
   * Retrieves the bytecode of an address to verify if it is a smart contract.
   */
  async getCode(chain: string, address: string): Promise<string | null> {
    try {
      return await this.rpcCall<string>(chain, 'eth_getCode', [
        address.toLowerCase(),
        'latest',
      ]);
    } catch (err) {
      this.logger.debug(
        `Failed to fetch code for ${address}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Retrieves block header to extract timestamp.
   */
  async getBlockByNumber(
    chain: string,
    blockNumberHex: string,
  ): Promise<{ number: string; timestamp: string } | null> {
    try {
      return await this.rpcCall<{ number: string; timestamp: string }>(
        chain,
        'eth_getBlockByNumber',
        [blockNumberHex, false],
      );
    } catch (err) {
      this.logger.debug(
        `Failed to fetch block header for ${blockNumberHex} on ${chain}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Retrieves suggested gas price from node (eth_gasPrice).
   */
  async getGasPrice(chain: string): Promise<string | null> {
    try {
      return await this.rpcCall<string>(chain, 'eth_gasPrice', []);
    } catch (err) {
      this.logger.debug(
        `Failed to fetch gas price on ${chain}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Retrieves the latest block header and suggested gas price.
   * Guarantees block number and timestamp reference the exact same block.
   */
  async getLatestBlockAndGas(chain: string): Promise<{
    blockNumberHex: string | null;
    blockTimestampHex: string | null;
    gasPriceHex: string | null;
  }> {
    const [block, gasPriceHex] = await Promise.all([
      this.getBlockByNumber(chain, 'latest'),
      this.getGasPrice(chain),
    ]);

    return {
      blockNumberHex: block?.number ?? null,
      blockTimestampHex: block?.timestamp ?? null,
      gasPriceHex,
    };
  }

  /**
   * Fetches decimals, symbol, and name for an ERC-20 token contract via eth_call.
   */
  async fetchTokenMetadata(chain: string, contractAddress: string): Promise<TokenMetadata> {
    const to = contractAddress.toLowerCase();

    const [rawDecimals, rawSymbol, rawName] = await Promise.allSettled([
      this.ethCall(chain, to, SELECTOR_DECIMALS),
      this.ethCall(chain, to, SELECTOR_SYMBOL),
      this.ethCall(chain, to, SELECTOR_NAME),
    ]);

    const failureReasons: string[] = [];

    // Distinguish transient network/RPC error from clean contract revert / missing field
    const decimalsFailed = rawDecimals.status === 'rejected';
    if (decimalsFailed) {
      failureReasons.push(`decimals: ${(rawDecimals.reason as Error)?.message || 'call failed'}`);
    }

    const symbolFailed = rawSymbol.status === 'rejected';
    if (symbolFailed) {
      failureReasons.push(`symbol: ${(rawSymbol.reason as Error)?.message || 'call failed'}`);
    }

    const nameFailed = rawName.status === 'rejected';
    if (nameFailed) {
      failureReasons.push(`name: ${(rawName.reason as Error)?.message || 'call failed'}`);
    }

    // Degraded if ANY field suffered a transient RPC/network failure
    const isDegraded = decimalsFailed || symbolFailed || nameFailed;

    const decimals =
      rawDecimals.status === 'fulfilled' && rawDecimals.value
        ? this.parseUint8(rawDecimals.value)
        : null;

    const symbol =
      rawSymbol.status === 'fulfilled' && rawSymbol.value
        ? this.parseAbiString(rawSymbol.value)
        : null;

    const name =
      rawName.status === 'fulfilled' && rawName.value ? this.parseAbiString(rawName.value) : null;

    return {
      contractAddress: to,
      chain: chain.toLowerCase(),
      decimals,
      symbol,
      name,
      isDegraded,
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined,
    };
  }

  private async ethCall(chain: string, to: string, data: string): Promise<string | null> {
    return this.rpcCall<string>(chain, 'eth_call', [
      {
        to,
        data,
      },
      'latest',
    ]);
  }

  /**
   * Parses uint8 / uint256 hex result into a number.
   */
  parseUint8(hex: string): number | null {
    if (!hex || hex === '0x') return null;
    try {
      const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
      if (!clean) return null;
      const num = Number.parseInt(clean, 16);
      return Number.isFinite(num) && num >= 0 && num <= 255 ? num : null;
    } catch {
      return null;
    }
  }

  /**
   * Decodes ABI encoded string or bytes32 into a clean UTF-8 string.
   */
  parseAbiString(hex: string): string | null {
    if (!hex || hex === '0x') return null;
    try {
      const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
      if (clean.length < 64) return null;

      // Check if standard ABI string (offset at word 0, length at word 1)
      if (clean.length >= 128) {
        const offset = Number.parseInt(clean.slice(0, 64), 16);
        if (offset === 32) {
          const length = Number.parseInt(clean.slice(64, 128), 16);
          if (length > 0 && length <= 256) {
            const hexData = clean.slice(128, 128 + length * 2);
            const str = Buffer.from(hexData, 'hex').toString('utf8').replace(/\0/g, '').trim();
            if (str) return str;
          }
        }
      }

      // Fallback: bytes32 representation
      const bytes32Hex = clean.slice(0, 64);
      const str = Buffer.from(bytes32Hex, 'hex').toString('utf8').replace(/\0/g, '').trim();
      return str || null;
    } catch {
      return null;
    }
  }
}
