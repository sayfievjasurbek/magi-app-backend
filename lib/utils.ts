import jwt from 'jsonwebtoken';
import { type Response } from 'express';
import { HttpError } from './errors.js';

const JWT_SECRET = process.env.JWT_SECRET;

export const handleControllerError = (res: Response, error: unknown, context: string = "controller") => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({
      success: false,
      message: error.message
    });
  }

  if (error instanceof Error) {
    console.error(`Error in ${context}:`, error.message);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }

  console.error(`Unknown error in ${context}:`, error);
  return res.status(500).json({
    success: false,
    message: "An unknown error occurred"
  });
};


export const generateToken = async (id: number, first_name: string, last_name: string | null, email: string, role: string, res: Response): Promise<string> => {
  if (!JWT_SECRET) {
    console.error("JWT_SECRET is not defined in environment variables");
    throw new Error("JWT_SECRET is not defined");
  }

  const token = jwt.sign({ 
    id,
    first_name,
    last_name,
    email,
    role
  }, JWT_SECRET, { expiresIn: "7d" });

  const isProduction = process.env.NODE_ENV === 'production';

  res.cookie("jwt", token, {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: isProduction ? "strict" : "lax",
    secure: isProduction ? true : false,
    path: "/",
  });

  return token;
};

// ids are bigint: a path parameter or a body field is only an id when it is a positive safe integer
export const parseId = (value: unknown): number | null => {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

// tables carrying deleted_at/reason are soft deleted, so live rows have to be filtered explicitly
export const activeOnly = <T extends { is: (column: string, value: null) => T }>(query: T): T => query.is('deleted_at', null);

export const softDelete = (reason: string | null = null) => ({ deleted_at: new Date().toISOString(), reason });
