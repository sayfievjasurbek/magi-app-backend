import { type Response, type Request, type NextFunction } from 'express';
import { type Role } from '../lib/types.js';

export const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) {
    const allowed = roles.map((role) => `${role}s`).join(' or ');
    return res.status(403).json({ success: false, message: `Only ${allowed} can access this resource` });
  };

  next();
};
