// Monitoring domain: the endpoints of monitoring.route.ts and the schemas they use (helpers in docs/common.ts).
import { authed, dateTime, envelope, errors, id, json, nullable, ok, pathParam, ref } from '../../docs/common.js';

export const tags = [{ name: 'Monitoring', description: 'Proctoring media and exam events of an attempt' }];

export const schemas = {
  MonitoringMedia: {
    type: 'object',
    properties: {
      id,
      url: { type: 'string', format: 'uri', example: 'https://media.magi.edu/attempts/12/snapshot-3.png' },
      label: nullable({ type: 'string', example: 'ID number 12' }),
      created_at: dateTime,
    },
  },
  DeletedMonitoringMedia: {
    type: 'object',
    properties: {
      id,
      url: { type: 'string', format: 'uri', example: 'https://media.magi.edu/attempts/12/snapshot-3.png' },
      deleted_at: dateTime,
      reason: nullable({ type: 'string', example: 'Recording of the wrong candidate' }),
    },
  },
};

// the four media kinds of monitoring.service.ts
const kindParam = {
  name: 'kind',
  in: 'path',
  required: true,
  description: 'Which media of the attempt. An unknown kind answers 404.',
  schema: { type: 'string', enum: ['panoramic-views', 'video-recordings', 'face-snapshots', 'snapshots'], example: 'snapshots' },
};

export const paths = {
  '/api/monitoring/attempts/{attemptId}/{kind}': {
    post: {
      tags: ['Monitoring'],
      summary: 'Upload a photo to an attempt (student)',
      description:
        'The student who owns the attempt uploads a photo, stored in Supabase Storage. ' +
        'Only while the attempt is in progress and inside its time limit (409 once the time is over). ' +
        "For `face-snapshots`, if the student has set a reference photo (see POST /api/auth/me/photo), it's compared against this one in the " +
        'background (self-hosted, no response delay) - a mismatch auto-records a face_mismatch cheating incident and flags the attempt, the same ' +
        'as a self-reported one would.',
      ...authed,
      parameters: [pathParam('attemptId', 'Attempt (assignments.id)'), kindParam],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['image'],
          properties: {
            image: { type: 'string', description: 'data:image/jpeg;base64,... or data:image/png;base64,...', example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...' },
            label: { type: 'string', example: 'ID number 12' },
          },
        }),
      },
      responses: {
        '201': ok('Media stored', envelope({ media: ref('MonitoringMedia') })),
        ...errors(400, 401, 403, 404, 409),
      },
    },
    get: {
      tags: ['Monitoring'],
      summary: 'Media of an attempt (professor, examiner)',
      description:
        'The professors who manage the exam (its owner and the professors of its modules) and the examiners assigned to it, newest first, at most 100 items. ' +
        'Soft deleted items are left out. Students cannot read media back.',
      ...authed,
      parameters: [pathParam('attemptId', 'Attempt (assignments.id)'), kindParam],
      responses: {
        '200': ok('Media of the attempt', envelope({ media: { type: 'array', items: ref('MonitoringMedia') } })),
        ...errors(401, 403, 404),
      },
    },
  },
  '/api/monitoring/{kind}/{mediaId}': {
    delete: {
      tags: ['Monitoring'],
      summary: 'Soft delete a media item (professor)',
      description: 'Only a professor of the exam behind the attempt. The media row is soft deleted with the reason, the link to the attempt stays.',
      ...authed,
      parameters: [kindParam, pathParam('mediaId', 'Media item of that kind')],
      requestBody: { required: true, content: json({ type: 'object', required: ['reason'], properties: { reason: { type: 'string', maxLength: 1000, example: 'Recording of the wrong candidate' } } }) },
      responses: {
        '200': ok('Media deleted', envelope({ media: ref('DeletedMonitoringMedia') })),
        ...errors(400, 401, 403, 404),
      },
    },
  },
};
