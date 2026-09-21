import { type Response, type Request, type NextFunction } from 'express';

// express 5 leaves req.body undefined when the request carries no body at all, and every
// controller reads fields straight off it: without this a missing body is a 500 instead of a 400
export const defaultBody = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body === undefined) req.body = {};
  next();
};
