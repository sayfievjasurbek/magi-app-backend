import jwt from 'jsonwebtoken';
import { type Response, type Request, type NextFunction } from 'express';
import { database } from '../lib/db.js';
import { handleControllerError } from '../lib/utils.js';
import { type TokenPayload } from '../lib/types.js';

export const protectRoute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.jwt;

    if (!token) return res.status(401).json({ success: false, message: "Not authorized, token missing" });
   
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as TokenPayload;

    if (typeof decoded !== "object" || !decoded || !("id" in decoded)) {
      return res.status(401).json({ message: "Invalid token" });
    }
    
    req.user = decoded;

    next();
  } catch (error: unknown) {
    if (error instanceof jwt.JsonWebTokenError) return res.status(401).json({ success: false, message: "Not authorized, invalid or expired token" });
    return handleControllerError(res, error, "protectRoute middleware");
  };
};