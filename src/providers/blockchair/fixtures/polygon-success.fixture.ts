import type { RawBlockchairResponse } from '../blockchair.interface';

export const POLYGON_SUCCESS_HASH =
  '0x4444444444444444444444444444444444444444444444444444444444444444';

export const POLYGON_SUCCESS_FIXTURE: RawBlockchairResponse = {
  data: {
    [POLYGON_SUCCESS_HASH]: {
      transaction: {
        block_id: 34567890,
        hash: POLYGON_SUCCESS_HASH,
        time: '2026-09-06 05:10:00',
        sender: '0x4444111122223333444411112222333344441111',
        recipient: '0x5555111122223333444411112222333344441111',
        value: '10000000000000000000',
        fee: '5000000000000000',
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
