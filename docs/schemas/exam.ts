// Exams domain: the schemas used by docs/paths/exam.ts (helpers in docs/common.ts).
import { dateTime, id, nullable, ref } from '../common.js';

export const examStatus = { type: 'string', enum: ['demo', 'scheduled', 'ongoing', 'completed', 'delayed', 'cancelled'] };

export const schemas = {
  Exam: {
    type: 'object',
    description: 'An exam as staff see it.',
    properties: {
      id,
      name: { type: 'string' },
      shuffle_questions: { type: 'boolean' },
      scheduled_start: dateTime,
      scheduled_end: dateTime,
      status: examStatus,
      max_marks: { type: 'integer' },
      passing_marks: { type: 'integer' },
      created_by: nullable(id),
      created_at: dateTime,
      updated_at: dateTime,
    },
  },
  StudentExam: {
    type: 'object',
    description: 'An exam as the students assigned to it see it: no questions, no owner, no shuffling.',
    properties: {
      id,
      name: { type: 'string' },
      scheduled_start: dateTime,
      scheduled_end: dateTime,
      status: examStatus,
      max_marks: { type: 'integer' },
      passing_marks: { type: 'integer' },
      permitted_urls: { type: 'array', items: ref('PermittedUrl') },
    },
  },
  ExamDetail: {
    allOf: [
      ref('Exam'),
      {
        type: 'object',
        properties: {
          modules: { type: 'array', items: { type: 'object', properties: { id, name: { type: 'string' } } } },
          examiners: { type: 'array', items: ref('Person') },
          students: { type: 'array', items: ref('Person') },
          events: { type: 'array', items: ref('MonitoredEvent') },
          permitted_urls: { type: 'array', items: ref('PermittedUrl') },
          questions: { type: 'array', items: ref('ExamQuestion') },
          marks_total: { type: 'integer', description: 'The marks of the questions added up; it has to equal max_marks before the exam can go ongoing' },
        },
      },
    ],
  },
  ExamQuestion: {
    type: 'object',
    description: 'A question of an exam, with the position and the marks it carries in that exam.',
    properties: {
      id,
      title: { type: 'string' },
      question_type: { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer', 'essay'] },
      question: { type: 'string' },
      expected_duration: { type: 'integer' },
      expected_duration_unit: { type: 'string', enum: ['seconds', 'minutes', 'hours', 'days'] },
      position: { type: 'integer' },
      marks: { type: 'integer' },
      options: { type: 'array', items: ref('ExamQuestionOption') },
    },
  },
  ExamQuestionOption: {
    type: 'object',
    description: 'Only ever returned to a professor or an examiner: is_correct is never sent to a student.',
    properties: {
      id,
      question_id: id,
      option_text: { type: 'string' },
      is_correct: { type: 'boolean' },
    },
  },
  ExamQuestionLink: {
    type: 'object',
    properties: { question_id: id, position: { type: 'integer' }, marks: { type: 'integer' } },
  },
  MonitoredEvent: {
    type: 'object',
    properties: {
      id,
      name: {
        type: 'string',
        enum: [
          'browser_version', 'active_app', 'menu_bar_icon', 'open_window', 'monitor_count', 'monitor_hotplug',
          'chrome_extension', 'tab_switch', 'app_switch', 'screen_mirror', 'devtools_opened', 'copy_paste', 'url_access',
        ],
      },
      description: { type: 'string' },
    },
  },
};
