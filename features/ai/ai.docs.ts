import { authed, envelope, json, ok, errors, ref, pathParam } from '../../docs/common.js';

export const tags = [{ name: 'AI', description: 'AI-assisted grading and the Magi AI chat assistant' }];

const conversationParam = pathParam('id', 'Id of the conversation');

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
  AiConversation: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      title: { type: 'string', nullable: true, example: "Midterm testini 5-guruhga joyla" },
      updatedAt: { type: 'string', format: 'date-time' },
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
  '/api/ai/conversations': {
    get: {
      tags: ['AI'],
      summary: "The professor's past Magi AI conversations (professor)",
      description: 'Every conversation this professor has had with Magi AI, most recently active first - the chat panel\'s sidebar, same shape as ChatGPT/Claude.ai.',
      ...authed,
      responses: { '200': ok('Conversations', envelope({ conversations: { type: 'array', items: ref('AiConversation') } })), ...errors(401, 403) },
    },
  },
  '/api/ai/conversations/{id}': {
    delete: {
      tags: ['AI'],
      summary: 'Delete a conversation (professor)',
      ...authed,
      parameters: [conversationParam],
      responses: { '200': ok('Deleted', envelope({ message: { type: 'string', example: 'Conversation deleted' } })), ...errors(401, 403, 404) },
    },
  },
  '/api/ai/conversations/{id}/messages': {
    get: {
      tags: ['AI'],
      summary: "One conversation's messages (professor)",
      description: 'Every message in one conversation, oldest first - lets the chat panel load it when the professor switches to it in the sidebar.',
      ...authed,
      parameters: [conversationParam],
      responses: {
        '200': ok(
          'Messages',
          envelope({
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string' },
                  actions: { type: 'array', items: ref('AiAction'), nullable: true },
                  fileName: { type: 'string', nullable: true },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          }),
        ),
        ...errors(401, 403, 404),
      },
    },
  },
  '/api/ai/chat': {
    post: {
      tags: ['AI'],
      summary: 'Send a message to Magi AI (professor)',
      description:
        "Runs the professor's message through Magi AI, a tool-calling assistant that can answer questions about the system and carry out actions " +
        '(listing groups/exams/questions, scheduling an exam to a group, creating exams/questions, attendance and cheating lookups) using the ' +
        "same authorization checks the REST endpoints themselves use. `conversationId` picks up an existing conversation (its history is loaded " +
        "server-side, not trusted from the client) - omit it to start a new one; the response always carries the conversation's id back, unless " +
        'conversation persistence itself is unavailable, in which case it comes back null and `history` (the prior turns of this browser session, ' +
        "kept client-side) is used instead, so a persistence outage degrades to an unsaved chat rather than one that's lost its own context.",
      ...authed,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Midterm testini 5-guruhga joyla' },
            conversationId: { type: 'integer', nullable: true, description: 'Omit to start a new conversation' },
            history: {
              type: 'array',
              description: "Only used as a fallback if conversationId comes back null - ignored otherwise, since the DB is the real source of truth then",
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
          envelope({
            reply: { type: 'string', example: "Midterm testini 5-guruhga joyladim - 18 talaba qo'shildi." },
            actions: { type: 'array', items: ref('AiAction') },
            conversationId: { type: 'integer', nullable: true },
            suggestions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Quick-reply options alongside a clarifying question - each one the exact text tapping it should send',
            },
          }),
        ),
        ...errors(400, 401, 403, 404, 503),
      },
    },
  },
};
