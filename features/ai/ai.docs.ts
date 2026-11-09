// AI domain: the "is it configured" status check the admin panel polls for its indicator, and
// Magi AI, the chat assistant embedded in the admin panel (assistant.service.ts). The AI-assisted
// grading endpoint itself lives on the attempts domain (POST /assignments/{id}/ai-review), since
// it only makes sense in that context.
import { authed, envelope, json, ok, errors, ref } from '../../docs/common.js';

export const tags = [{ name: 'AI', description: 'AI-assisted grading and the Magi AI chat assistant' }];

export const schemas = {
  AiAction: {
    type: 'object',
    properties: {
      tool: { type: 'string', example: 'schedule_exam_to_group' },
      args: { type: 'object' },
      ok: { type: 'boolean' },
      summary: { type: 'string', example: 'Scheduled exam 12 to group 5 (18 student(s) rostered)' },
    },
  },
};

export const paths = {
  '/api/ai/status': {
    get: {
      tags: ['AI'],
      summary: 'Whether AI is configured (professor)',
      description: 'True once OPENAI_API_KEY is set on the server - not a live ping, just whether AI-assisted grading and Magi AI are turned on at all.',
      ...authed,
      responses: { '200': ok('Status', envelope({ configured: { type: 'boolean', example: true } })), ...errors(401, 403) },
    },
  },
  '/api/ai/chat': {
    post: {
      tags: ['AI'],
      summary: 'Send a message to Magi AI (professor)',
      description:
        "Runs the professor's message through Magi AI, a tool-calling assistant that can answer questions about the system and carry out actions " +
        '(listing groups/exams/questions, scheduling an exam to a group, creating exams/questions, attendance and cheating lookups) using the ' +
        "same authorization checks the REST endpoints themselves use. `history` is the prior turns of this conversation, kept client-side.",
      ...authed,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Midterm testini 5-guruhga joyla' },
            history: {
              type: 'array',
              items: {
                type: 'object',
                properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } },
              },
            },
          },
          required: ['message'],
        }),
      },
      responses: {
        '200': ok(
          'Reply',
          envelope({ reply: { type: 'string', example: "Midterm testini 5-guruhga joyladim - 18 talaba qo'shildi." }, actions: { type: 'array', items: ref('AiAction') } }),
        ),
        ...errors(400, 401, 403, 503),
      },
    },
  },
};
