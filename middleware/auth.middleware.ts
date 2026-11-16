import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { type Response, type Request, type NextFunction } from 'express';
import { database } from '../lib/db.js';
import { handleControllerError } from '../lib/utils.js';
import { type TokenPayload } from '../lib/types.js';

export const protectRoute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // desktop app sends a bearer token, web uses the cookie
    const bearer = req.headers?.authorization;
    const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : req.cookies.jwt;

    if (!token) return res.status(401).json({ success: false, message: "Not authorized, token missing" });


    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as TokenPayload;

    if (typeof decoded !== "object" || !decoded || !("id" in decoded)) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // revoked on logout even if the jwt hasn't expired yet
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const { data: session, error: sessionError } = await database
      .from('tokens')
      .select('revoked')
      .eq('token', hashedToken)
      .eq('token_type', 'cookie_token_login')
      .maybeSingle<{ revoked: boolean }>();

    if (sessionError) throw new Error(sessionError.message);
    if (!session || session.revoked) {
      return res.status(401).json({ success: false, message: "Not authorized, session has been logged out" });
    };

    req.user = decoded;

    next();
  } catch (error: unknown) {
    if (error instanceof jwt.JsonWebTokenError) return res.status(401).json({ success: false, message: "Not authorized, invalid or expired token" });
    return handleControllerError(res, error, "protectRoute middleware");
  };
};