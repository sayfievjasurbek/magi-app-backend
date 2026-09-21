// Cheatings domain: document the endpoints of routes/cheating.route.ts here, openapi.ts picks this file up.
import { authed, envelope, errors, id, json, ok, pathParam, ref } from '../common.js';

export const tags = [{ name: 'Cheatings', description: 'Cheating findings attached to an attempt' }];

export const paths = {
  '/api/cheatings/attempts/{attemptId}': {
    post: {
      tags: ['Cheatings'],
      summary: 'Record an incident on an attempt',
      description:
        'The student who owns the attempt may report the automatic types while the attempt is in progress and inside its time limit (409 once the time is over); `manual_review` answers 403 for them. ' +
        'A professor who manages the exam (its owner or a professor of one of its modules) or an examiner assigned to it may record any type at any time.\n\n' +
        'The attempt is set to `flagged` unless it is already graded; it can still be graded afterwards.',
      ...authed,
      parameters: [pathParam('attemptId', 'Attempt (assignments.id)')],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['name', 'explanation'],
          properties: { name: ref('CheatingType'), explanation: { type: 'string', maxLength: 1000 } },
        }),
      },
      responses: {
        '201': ok('Incident recorded', envelope({ cheating: ref('Cheating') })),
        ...errors(400, 401, 403, 404, 409),
      },
    },
    get: {
      tags: ['Cheatings'],
      summary: 'Incidents of an attempt (professor, examiner)',
      description: 'Newest first, at most 200. Dismissed incidents are left out. Students cannot read incidents.',
      ...authed,
      parameters: [pathParam('attemptId', 'Attempt (assignments.id)')],
      responses: {
        '200': ok('Incidents of the attempt', envelope({ cheatings: { type: 'array', items: ref('Cheating') } })),
        ...errors(401, 403, 404),
      },
    },
  },
  '/api/cheatings/summary': {
    get: {
      tags: ['Cheatings'],
      summary: 'Incident counts per type of an exam (professor, examiner)',
      description: 'Counts the live incidents of the attempts of one exam, biggest count first. Covers up to 1000 attempts and 1000 incidents.',
      ...authed,
      parameters: [{ name: 'examId', in: 'query', required: true, description: 'Exam to summarise', schema: id }],
      responses: {
        '200': ok('Counts per cheating type', envelope({ summary: { type: 'array', items: ref('CheatingCount') } })),
        ...errors(400, 401, 403, 404),
      },
    },
  },
  '/api/cheatings/{cheatingId}': {
    get: {
      tags: ['Cheatings'],
      summary: 'One incident (professor, examiner)',
      ...authed,
      parameters: [pathParam('cheatingId', 'Incident (cheatings.id)')],
      responses: {
        '200': ok('The incident', envelope({ cheating: ref('CheatingDetail') })),
        ...errors(401, 403, 404),
      },
    },
    delete: {
      tags: ['Cheatings'],
      summary: 'Dismiss an incident (professor)',
      description: 'Only a professor of the exam behind the attempt. The incident is soft deleted with the reason; the attempt keeps the status it has, dismissing never unflags it.',
      ...authed,
      parameters: [pathParam('cheatingId', 'Incident (cheatings.id)')],
      requestBody: { required: true, content: json({ type: 'object', required: ['reason'], properties: { reason: { type: 'string', maxLength: 1000 } } }) },
      responses: {
        '200': ok('Incident dismissed', envelope({ cheating: ref('DismissedCheating') })),
        ...errors(400, 401, 403, 404),
      },
    },
  },
};
