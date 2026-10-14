// AI domain: just the "is it configured" status check the admin panel polls for its indicator.
// The actual AI-assisted grading endpoint lives on the attempts domain (POST /assignments/{id}/ai-review),
// since it only makes sense in that context.
import { authed, envelope, ok, errors } from '../../docs/common.js';

export const tags = [{ name: 'AI', description: 'AI-assisted grading support' }];

export const schemas = {};

export const paths = {
  '/api/ai/status': {
    get: {
      tags: ['AI'],
      summary: 'Whether AI-assisted grading is configured (professor)',
      description: 'True once ANTHROPIC_API_KEY is set on the server - not a live ping, just whether the feature is turned on at all.',
      ...authed,
      responses: { '200': ok('Status', envelope({ configured: { type: 'boolean', example: true } })), ...errors(401, 403) },
    },
  },
};
