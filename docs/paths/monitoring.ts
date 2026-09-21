// Monitoring domain: document the endpoints of routes/monitoring.route.ts here, openapi.ts picks this file up.
import { authed, envelope, errors, json, ok, pathParam, ref } from '../common.js';

export const tags = [{ name: 'Monitoring', description: 'Proctoring media and exam events of an attempt' }];

// the four media kinds of services/monitoring.service.ts
const kindParam = {
  name: 'kind',
  in: 'path',
  required: true,
  description: 'Which media of the attempt. An unknown kind answers 404.',
  schema: { type: 'string', enum: ['panoramic-views', 'video-recordings', 'face-snapshots', 'snapshots'] },
};

export const paths = {
  '/api/monitoring/attempts/{attemptId}/{kind}': {
    post: {
      tags: ['Monitoring'],
      summary: 'Add a media url to an attempt (student)',
      description:
        'The student who owns the attempt stores the url of a recording or snapshot taken by their client; the file itself is uploaded elsewhere. ' +
        'Only while the attempt is in progress and inside its time limit (409 once the time is over), and only `http`/`https` urls of at most 2048 characters.',
      ...authed,
      parameters: [pathParam('attemptId', 'Attempt (assignments.id)'), kindParam],
      requestBody: { required: true, content: json({ type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' } } }) },
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
      requestBody: { required: true, content: json({ type: 'object', required: ['reason'], properties: { reason: { type: 'string', maxLength: 1000 } } }) },
      responses: {
        '200': ok('Media deleted', envelope({ media: ref('DeletedMonitoringMedia') })),
        ...errors(400, 401, 403, 404),
      },
    },
  },
};
