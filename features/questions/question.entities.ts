import { type TimeUnit } from '../../lib/deadline.js';

export type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer' | 'essay' | 'file_upload';

export type Question = {
  id: number;
  title: string;
  question_type: QuestionType;
  question: string;
  model_answers: string[] | null;
  expected_duration: number;
  expected_duration_unit: TimeUnit;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reason: string | null;
};

export type QuestionOption = {
  id: number;
  question_id: number;
  option_text: string;
  is_correct: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reason: string | null;
};
