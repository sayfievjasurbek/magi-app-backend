import { type Response, type Request, type NextFunction } from 'express';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// the jwt cookie is SameSite=None in production, so refuse writes that come from another site
export const sameOrigin = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;

  if (!origin || SAFE_METHODS.includes(req.method) || origin === process.env.CLIENT_URL || origin === `${req.protocol}://${req.get('host')}`) {
    return next();
  };

  return res.status(403).json({ success: false, message: 'Origin not allowed' });
};
