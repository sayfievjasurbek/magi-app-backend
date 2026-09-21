// Questions domain: document the endpoints of routes/question.route.ts here, openapi.ts picks this file up.
import { authed, envelope, errors, json, messageOnly, ok, pathParam, ref } from '../common.js';

export const tags = [{ name: 'Questions', description: 'Questions and their options' }];

const questionParam = pathParam('id', 'Question id');

export const paths = {
  '/api/questions': {
    post: {
      tags: ['Questions'],
      summary: 'Create a question with its options (professor)',
      description: 'Question and options are written in one call; if the options cannot be written the question is removed again.',
      ...authed,
      requestBody: { required: true, content: json(ref('QuestionInput')) },
      responses: { '201': ok('Question created', envelope({ question: ref('QuestionWithOptions') })), ...errors(400, 401, 403) },
    },
    get: {
      tags: ['Questions'],
      summary: 'List own questions (professor)',
      ...authed,
      parameters: [
        { name: 'questionType', in: 'query', required: false, description: 'Only questions of this type', schema: { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer', 'essay'] } },
        { name: 'search', in: 'query', required: false, description: 'Case insensitive match on the title', schema: { type: 'string' } },
      ],
      responses: { '200': ok('Questions', envelope({ questions: { type: 'array', items: ref('Question') } })), ...errors(400, 401, 403) },
    },
  },
  '/api/questions/{id}': {
    get: {
      tags: ['Questions'],
      summary: 'Get a question with its options (professor)',
      description: 'Readable by the professor who owns the question and by a professor whose exam asks it. Anything else answers 404.',
      ...authed,
      parameters: [questionParam],
      responses: { '200': ok('Question', envelope({ question: ref('QuestionWithOptions') })), ...errors(401, 403, 404) },
    },
    patch: {
      tags: ['Questions'],
      summary: 'Update a question (owner)',
      description:
        'Sending `options` replaces the whole option set; once a student has answered the question that answers 409. ' +
        'A new `questionType` without `options` is only accepted when the options the question keeps fit it.',
      ...authed,
      parameters: [questionParam],
      requestBody: { required: true, content: json(ref('QuestionInput')) },
      responses: { '200': ok('Question updated', envelope({ question: ref('QuestionWithOptions') })), ...errors(400, 401, 403, 404, 409) },
    },
    delete: {
      tags: ['Questions'],
      summary: 'Soft delete a question (owner)',
      description: 'A question a student has already answered cannot be deleted (409).',
      ...authed,
      parameters: [questionParam],
      requestBody: { content: json({ type: 'object', properties: { reason: { type: 'string', example: 'replaced by a clearer wording' } } }) },
      responses: { '200': ok('Question deleted', messageOnly), ...errors(400, 401, 403, 404, 409) },
    },
  },
};
