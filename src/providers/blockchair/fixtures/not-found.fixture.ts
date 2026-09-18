import type { RawBlockchairResponse } from '../blockchair.interface';

export const NOT_FOUND_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const NOT_FOUND_EMPTY_DATA_FIXTURE: RawBlockchairResponse = {
  data: {},
  context: {
    code: 200,
    error: null,
  },
};

export const NOT_FOUND_ERROR_CONTEXT_FIXTURE: RawBlockchairResponse = {
  data: {},
  context: {
    code: 404,
    error: 'Transaction not found',
  },
};
