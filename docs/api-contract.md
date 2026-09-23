# Canonical API Contract

**Repository:** `crypto-omnichain-tracker-api`  
**Contract Version:** 1.1.0  
**Ownership:** Backend (`crypto-omnichain-tracker-api`) owns this document. Frontend (`crypto-omnichain-tracker-web`) consumes this contract.  
**Implementation Status:** Active — Milestone 1 & Transaction Story Evolution (ERC-20 transfers, approvals, deterministic narrative, and status reconciliation).

---

## 1. Migration & Evolution Notes (v1.0.0 -> v1.1.0)

> [!WARNING]
> **Breaking Consumer Adjustments:**
>
> 1. **Nullable Timestamp:** `data.timestamp` is now typed as `string | null`. Legacy consumers assuming a guaranteed non-null ISO string must be updated to handle `null` when upstream providers report unconfirmed or invalid timestamps.
> 2. **Status 'unknown':** `data.status` now includes `'unknown'` alongside `'confirmed'`, `'failed'`, and `'pending'`. Consumers must handle `'unknown'` in UI badges and status checks.
> 3. **Search History Separation:** In `GET /v1/history`, `txStatus` is introduced as `'confirmed' | 'failed' | 'pending' | 'unknown'`. The `outcome` field strictly represents lookup request success (`'success'`, `'not_found'`, etc.), while `txStatus` reflects blockchain execution. Older history records without execution metadata default to `'unknown'`.

---

## 2. Versioning and Route Conventions

1. **API Prefix:** All business endpoints use the `/v1` prefix (`/v1/transactions/lookup`, `/v1/history`).
2. **Health Endpoints:** Infrastructure health checks remain unversioned:
   - `GET /health/live`
   - `GET /health/ready`
3. **Contract Evolution:** Any breaking change requires a documentation update, version bump, and coordinated deployment with the frontend.

---

## 3. Supported EVM Chains

The `chain` parameter must be strictly one of the following lowercase enum strings:

| Enum Value | Network Name     | Native Symbol | Expected Chain ID |
| :--------- | :--------------- | :------------ | :---------------- |
| `ethereum` | Ethereum Mainnet | ETH           | 1 (`0x1`)         |
| `bsc`      | BNB Smart Chain  | BNB           | 56 (`0x38`)       |
| `polygon`  | Polygon PoS      | POL (MATIC)   | 137 (`0x89`)      |

---

## 4. Transaction Lookup Endpoint

### `POST /v1/transactions/lookup`

Looks up and enriches a single EVM transaction hash on the specified chain.

#### Request Headers

```http
Content-Type: application/json
Accept: application/json
```

#### Request Body

```json
{
  "chain": "ethereum",
  "transactionHash": "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

#### Request Field Specifications

| Field             | Type     | Required | Validation Rules                             | Description                                           |
| :---------------- | :------- | :------- | :------------------------------------------- | :---------------------------------------------------- |
| `chain`           | `string` | Yes      | Must be one of: `ethereum`, `bsc`, `polygon` | Targeted EVM blockchain                               |
| `transactionHash` | `string` | Yes      | Must match `^0x[0-9a-fA-F]{64}$`             | 0x-prefixed 64-character hexadecimal transaction hash |

---

### Successful Response (200 OK)

Returned when the transaction hash exists on the selected network and normalized data was retrieved either from Redis cache or upstream providers (Blockchair + EVM RPC).

```json
{
  "data": {
    "transactionHash": "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "chain": "ethereum",
    "status": "confirmed",
    "from": "0x1234567890abcdef1234567890abcdef12345678",
    "to": "0xabcdef1234567890abcdef1234567890abcdef12",
    "value": {
      "raw": "1500000000000000000",
      "formatted": "1.5",
      "symbol": "ETH"
    },
    "fee": {
      "raw": "2100000000000000",
      "formatted": "0.0021",
      "symbol": "ETH"
    },
    "blockNumber": "12345678",
    "timestamp": "2026-09-06T05:00:00.000Z",
    "explorerUrl": "https://etherscan.io/tx/0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "fetchedAt": "2026-09-23T14:40:00.000Z",
    "explanation": "Transferred 1.5 ETH from 0x1234...5678 to 0xabcd...ef12; Transferred 500 USDC to 0xabcd...ef12.",
    "coverage": "complete",
    "coverageReasons": [],
    "actions": [
      {
        "type": "native_transfer",
        "description": "Sent 1.5 ETH to 0xabcdef1234567890abcdef1234567890abcdef12",
        "actor": "0x1234567890abcdef1234567890abcdef12345678",
        "recipient": "0xabcdef1234567890abcdef1234567890abcdef12",
        "asset": {
          "type": "native",
          "symbol": "ETH",
          "contractAddress": null,
          "rawAmount": "1500000000000000000",
          "formattedAmount": "1.5",
          "decimals": 18
        },
        "proof": {
          "source": "native_value",
          "contractAddress": null,
          "logIndex": null
        }
      }
    ],
    "tokenTransfers": [
      {
        "tokenAddress": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "symbol": "USDC",
        "name": "USD Coin",
        "decimals": 6,
        "from": "0x1234567890abcdef1234567890abcdef12345678",
        "to": "0xabcdef1234567890abcdef1234567890abcdef12",
        "rawAmount": "500000000",
        "formattedAmount": "500",
        "logIndex": "0x1"
      }
    ],
    "approvals": [],
    "technical": {
      "gasUsed": "45200",
      "inputData": "0xa9059cbb..."
    }
  },
  "meta": {
    "requestId": "c1f516d0-a35b-4c27-91fa-bf1447dbb13b",
    "cache": {
      "hit": false
    }
  }
}
```

#### Field Semantics & Standards

- `data.status`: Execution status string (`confirmed`, `failed`, `pending`, or `unknown`).
- `data.fetchedAt`: Exact ISO 8601 timestamp when backend retrieved/enriched data. Preserved on Redis cache hits.
- `data.explanation`: Rule-based deterministic narrative. Failed transactions explicitly declare that transfers did not take effect.
- `data.coverage`: `'complete'` (all logs and transfers fully decoded within supported decoder scope), `'partial'` (unparsed logs or missing metadata), or `'unsupported'` (unrecognized contract interaction).
- `data.coverageReasons`: Array detailing why coverage was partial or unsupported (`metadata_unavailable`, `receipt_unavailable`, `unsupported_call`, `trace_not_available`, `temporary_enrichment_failure`, `provider_discrepancy`).
- `data.actions`: High-level action sequence with actor, recipient, asset breakdown, and proof source.
- `data.tokenTransfers`: Recognized ERC-20 transfers. Raw amounts are strings (never floats). If decimals are null, formattedAmount is null.
- `data.approvals`: Recognized ERC-20 approvals. `isUnlimited` is true if rawAmount equals maximum uint256 (`2^256 - 1`). `isRevocation` is true if rawAmount is `'0'`.

---

## 5. History Endpoint

### `GET /v1/history`

Retrieves recent transaction search records scoped to the current anonymous session.

#### Response (200 OK)

```json
{
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174001",
      "transactionHash": "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "chain": "ethereum",
      "outcome": "success",
      "txStatus": "confirmed",
      "cacheHit": true,
      "searchedAt": "2026-09-23T14:40:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "sessionId": "a8f5..."
  }
}
```

---

## 6. Standard Error Response Envelope

```json
{
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human-readable description of the error.",
    "requestId": "c1f516d0-a35b-4c27-91fa-bf1447dbb13b"
  }
}
```
