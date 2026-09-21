import { id, nullable } from '../common.js';

export const schemas = {
  TokenPayload: {
    type: 'object',
    properties: {
      id,
      first_name: { type: 'string' },
      last_name: nullable({ type: 'string' }),
      email: { type: 'string', format: 'email' },
      role: { type: 'string', enum: ['student', 'professor', 'examiner'] },
      iat: { type: 'integer' },
      exp: { type: 'integer' },
    },
  },
};
