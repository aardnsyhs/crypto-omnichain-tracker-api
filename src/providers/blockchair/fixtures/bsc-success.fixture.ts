import type { RawBlockchairResponse } from '../blockchair.interface';

export const BSC_SUCCESS_HASH =
  '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';

export const BSC_SUCCESS_FIXTURE: RawBlockchairResponse = {
  data: {
    [BSC_SUCCESS_HASH]: {
      transaction: {
        block_id: 23456789,
        hash: BSC_SUCCESS_HASH,
        time: '2026-09-06 05:05:00',
        sender: '0x2222222222222222222222222222222222222222',
        recipient: '0x3333333333333333333333333333333333333333',
        value: '500000000000000000',
        fee: '1000000000000000',
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
