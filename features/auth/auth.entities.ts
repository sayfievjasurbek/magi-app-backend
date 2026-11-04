// Auth domain: one type per table it owns, field for field from migrations/003_exam_schema.sql.
import { type TimeUnit } from '../../lib/deadline.js';

export type UserActiveStatus = 'pending' | 'active' | 'suspended' | 'banned' | 'deleted' | 'inactive';
export type TokenType = 'verify_account_email' | 'update_account_password' | 'cookie_token_login';
export type EmailUsageCase =
  | 'reset_password_account_email'
  | 'update_password_account_email'
  | 'verify_account_email'
  | 'welcome_user_email';

export type User = {
  id: number;
  first_name: string;
  last_name: string | null;
  email: string;
  password: string;
  is_verified: boolean;
  active_status: UserActiveStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  reason: string | null;
};

// the three role tables carry nothing but the user they mark
export type Professor = { user_id: number };
export type Student = { user_id: number };
export type Examiner = { user_id: number };

export type StudentPermittedUrl = { student_id: number; permitted_url_id: number };
export type StudentPermittedApp = { student_id: number; permitted_app_id: number };

export type Token = {
  id: number;
  token: string;
  token_type: TokenType;
  expires_at: string;
  revoked: boolean;
  created_at: string;
  updated_at: string;
};

export type UserToken = { user_id: number; token_id: number };

export type EmailRule = {
  id: number;
  email_usage_case: EmailUsageCase;
  max_per_day: number;
  cooldown_duration: number;
  cooldown_unit: TimeUnit;
  created_at: string;
  updated_at: string;
};

// email_usage_case is the email_rules id here, not the enum
export type EmailUsage = { user_id: number; email_usage_case: number; last_sent: string };

export type EmailLog = { user_id: number; email_usage_case: number; sent_at: string };
