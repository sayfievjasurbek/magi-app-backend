import { type Response, type Request, type NextFunction } from 'express';

// express 5 leaves req.body undefined with no body
export const defaultBody = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body === undefined) req.body = {};
  next();
};
