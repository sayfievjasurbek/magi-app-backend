// Cheatings domain: one type per table it owns, field for field from migrations/003_exam_schema.sql.

export type CheatingType =
  | 'tab_switch_limit'
  | 'copy_paste'
  | 'devtools'
  | 'multiple_monitors'
  | 'face_mismatch'
  | 'screen_share'
  | 'unauthorized_app'
  | 'manual_review';

export type Cheating = {
  id: number;
  name: CheatingType;
  explanation: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reason: string | null;
};

export type CheatingReason = { assignment_id: number; cheating_id: number };
