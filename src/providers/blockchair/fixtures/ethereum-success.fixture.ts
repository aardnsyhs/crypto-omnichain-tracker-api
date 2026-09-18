import type { RawBlockchairResponse } from '../blockchair.interface';

export const ETHEREUM_SUCCESS_HASH =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export const ETHEREUM_SUCCESS_FIXTURE: RawBlockchairResponse = {
  data: {
    [ETHEREUM_SUCCESS_HASH]: {
      transaction: {
        block_id: 12345678,
        hash: ETHEREUM_SUCCESS_HASH,
        time: '2026-09-06 05:00:00',
        sender: '0x1234567890abcdef1234567890abcdef12345678',
        recipient: '0xabcdef1234567890abcdef1234567890abcdef12',
        value: '1500000000000000000',
        fee: '2100000000000000',
        has_result: true,
        status: 1,
      },
    },
  },
  context: {
    code: 200,
    error: null,
  },
};
