# Canonical API Contract

**Repository:** `crypto-omnichain-tracker-api`
**Contract Version:** 1.0.0
**Ownership:** Backend (`crypto-omnichain-tracker-api`) owns this document. Frontend (`crypto-omnichain-tracker-web`) consumes this contract without importing backend source code.
**Implementation Status in Milestone 1A:** **Documentation only.** No transaction controllers, routes, DTOs, or services are implemented in the Milestone 1A source code.

---

## 1. Versioning and Route Conventions

1. **API Prefix:** All business endpoints use the `/v1` prefix (e.g., `/v1/transactions/lookup`, `/v1/history`, `/v1/stats`).
2. **Health Endpoints:** Infrastructure health checks remain unversioned:
   - `GET /health/live`
   - `GET /health/ready`
3. **Contract Evolution:** Any breaking change requires a documentation update, version bump or migration note, and coordinated testing with the frontend.

---

## 2. Supported EVM Chains

The `chain` parameter must be strictly one of the following lowercase enum strings:

| Enum Value | Network Name     | Native Symbol |
| :--------- | :--------------- | :------------ |
| `ethereum` | Ethereum Mainnet | ETH           |
| `bsc`      | BNB Smart Chain  | BNB           |
| `polygon`  | Polygon PoS      | POL (MATIC)   |

---

## 3. Transaction Lookup Endpoint

### `POST /v1/transactions/lookup`

Looks up a single EVM transaction hash on the specified chain.

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

Returned when the transaction hash exists on the selected network and normalized data was retrieved either from Redis cache or the upstream provider.

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
    "explorerUrl": "https://etherscan.io/tx/0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "meta": {
    "requestId": "c1f516d0-a35b-4c27-91fa-bf1447dbb13b",
    "cache": {
      "hit": true
    }
  }
}
```

#### Response Data Fields

- `data.transactionHash`: Canonical lowercase 0x-prefixed 64-character hex hash.
- `data.chain`: The requested chain identifier (`ethereum`, `bsc`, `polygon`).
- `data.status`: Transaction status string (`confirmed`, `failed`, or `pending`).
- `data.from`: Sender EVM address.
- `data.to`: Recipient or contract address (null if contract deployment).
- `data.value`: Object containing `raw` wei string, `formatted` decimal string, and native `symbol`.
- `data.fee`: Object containing `raw` wei string, `formatted` decimal string, and native `symbol`.
- `data.blockNumber`: Block height as string.
- `data.timestamp`: ISO 8601 UTC timestamp.
- `data.explorerUrl`: Direct URL to external block explorer.
- `meta.requestId`: UUID assigned to this request for tracing.
- `meta.cache.hit`: Boolean indicating if result was served from Redis cache-aside.

---

### Standard Error Response Envelope

All error responses return a standardized, stable JSON envelope. Stack traces, internal database details, Redis connection strings, and provider API keys are never exposed.

```json
{
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human-readable description of the error.",
    "requestId": "c1f516d0-a35b-4c27-91fa-bf1447dbb13b"
  }
}
```

---

### Documented Error Status Codes & Mappings

| HTTP Status                 | Error Code                 | Trigger Condition                                                                  |
| :-------------------------- | :------------------------- | :--------------------------------------------------------------------------------- |
| **400 Bad Request**         | `INVALID_TRANSACTION_HASH` | The provided hash does not match `0x` + 64 hex characters.                         |
| **400 Bad Request**         | `UNSUPPORTED_CHAIN`        | The provided chain is not `ethereum`, `bsc`, or `polygon`.                         |
| **400 Bad Request**         | `VALIDATION_ERROR`         | Missing required body fields or malformed JSON payload.                            |
| **404 Not Found**           | `TRANSACTION_NOT_FOUND`    | The transaction hash does not exist or has not been confirmed on the chosen chain. |
| **429 Too Many Requests**   | `RATE_LIMIT_EXCEEDED`      | Client has exceeded public API lookup rate limits.                                 |
| **502 Bad Gateway**         | `UPSTREAM_PROVIDER_ERROR`  | Blockchair returned an unrecoverable 5xx error or invalid payload.                 |
| **502 Bad Gateway**         | `UPSTREAM_TIMEOUT`         | Upstream provider request exceeded configured deadline.                            |
| **503 Service Unavailable** | `UPSTREAM_RATE_LIMITED`    | Upstream provider quota was exhausted.                                             |

---

## 4. Unversioned Health Probes

### `GET /health/live`

- **Purpose:** Liveness check to confirm API process is running.
- **HTTP Status:** `200 OK`
- **Response:**
  ```json
  {
    "status": "ok",
    "uptimeSeconds": 120,
    "timestamp": "2026-09-06T06:12:00.000Z"
  }
  ```

### `GET /health/ready`

- **Purpose:** Readiness check for routing traffic.
- **HTTP Status (Milestone 1A):** `200 OK`
- **Response:**
  ```json
  {
    "status": "degraded",
    "checks": {
      "api": "ready",
      "database": "not_checked",
      "redis": "not_checked"
    },
    "phase": "milestone-1a"
  }
  ```
  _(In Milestone 1A, this honestly reflects that database and cache dependencies are not yet checked or integrated)._
