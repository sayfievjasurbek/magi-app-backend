// Create a types file (e.g., backend/types/index.ts)
import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export type Role = 'student' | 'professor' | 'examiner';

export type TokenPayload = {
  id: number;
  first_name: string;
  last_name: string | null;
  email: string;
  role: Role;
  iat: number;
  exp: number;
};
