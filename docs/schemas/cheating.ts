// Cheatings domain: the schemas used by docs/paths/cheating.ts (helpers in docs/common.ts).
import { dateTime, id, nullable } from '../common.js';

// type_cheating_types
const name = {
  type: 'string',
  enum: ['tab_switch_limit', 'copy_paste', 'devtools', 'multiple_monitors', 'face_mismatch', 'screen_share', 'unauthorized_app', 'manual_review'],
};

export const schemas = {
  CheatingType: name,
  Cheating: {
    type: 'object',
    properties: { id, name, explanation: { type: 'string' }, created_at: dateTime },
  },
  CheatingDetail: {
    type: 'object',
    properties: {
      id,
      name,
      explanation: { type: 'string' },
      created_at: dateTime,
      updated_at: dateTime,
      assignment_id: id,
    },
  },
  DismissedCheating: {
    type: 'object',
    properties: { id, name, deleted_at: dateTime, reason: nullable({ type: 'string' }) },
  },
  CheatingCount: {
    type: 'object',
    properties: { name, count: { type: 'integer', minimum: 1 } },
  },
};
