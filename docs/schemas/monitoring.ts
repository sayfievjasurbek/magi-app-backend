// Monitoring domain: the schemas used by docs/paths/monitoring.ts (helpers in docs/common.ts).
import { dateTime, id, nullable } from '../common.js';

export const schemas = {
  MonitoringMedia: {
    type: 'object',
    properties: {
      id,
      url: { type: 'string', format: 'uri', example: 'https://media.magi.edu/attempts/12/snapshot-3.png' },
      created_at: dateTime,
    },
  },
  DeletedMonitoringMedia: {
    type: 'object',
    properties: {
      id,
      url: { type: 'string', format: 'uri' },
      deleted_at: dateTime,
      reason: nullable({ type: 'string' }),
    },
  },
};
