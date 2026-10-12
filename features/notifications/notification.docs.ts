// Notifications domain: the endpoints of notification.route.ts and the schemas they use (helpers in docs/common.ts).
import { authed, dateTime, envelope, errors, id, messageOnly, nullable, ok, ref } from '../../docs/common.js';

export const tags = [{ name: 'Notifications', description: "Things sent to the current user - mostly from the professor/admin side, but also a student's own password change notifying their professor" }];

export const schemas = {
  Notification: {
    type: 'object',
    properties: {
      id,
      type: { type: 'string', enum: ['exam_assigned', 'module_enrolled', 'exam_graded', 'password_changed'], example: 'exam_assigned' },
      title: { type: 'string', example: 'New exam assigned' },
      body: nullable({ type: 'string', example: 'Algorithms Midterm, in Algorithms' }),
      related_id: nullable(id),
      read_at: nullable(dateTime),
      created_at: dateTime,
    },
  },
};

export const paths = {
  '/api/notifications': {
    get: {
      tags: ['Notifications'],
      summary: "The current user's own notifications, newest first",
      ...authed,
      responses: {
        '200': ok('Notifications', envelope({ notifications: { type: 'array', items: ref('Notification') } })),
        ...errors(401),
      },
    },
  },
  '/api/notifications/unread-count': {
    get: {
      tags: ['Notifications'],
      summary: 'How many are unread, for the bell icon badge',
      ...authed,
      responses: { '200': ok('Unread count', envelope({ count: { type: 'integer', example: 3 } })), ...errors(401) },
    },
  },
  '/api/notifications/read-all': {
    patch: {
      tags: ['Notifications'],
      summary: 'Mark every unread notification as read',
      ...authed,
      responses: { '200': ok('Marked as read', messageOnly), ...errors(401) },
    },
  },
  '/api/notifications/{id}/read': {
    patch: {
      tags: ['Notifications'],
      summary: 'Mark one notification as read',
      description: 'A notification belonging to someone else answers 404.',
      ...authed,
      parameters: [{ name: 'id', in: 'path', required: true, schema: id }],
      responses: { '200': ok('Marked as read', envelope({ notification: ref('Notification') })), ...errors(401, 404) },
    },
  },
};
