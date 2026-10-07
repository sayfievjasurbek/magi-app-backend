import { type Response, type Request, type NextFunction } from 'express';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// the jwt cookie is SameSite=None in production, so refuse writes that come from another site
const allowedOrigins = process.env.CLIENT_URL?.split(',').map((url) => url.trim()) ?? [];

// the desktop app's webview serves its own UI from a custom scheme - tauri://localhost on
// macOS/Linux, http://tauri.localhost on Windows (WebView2 needs an http(s) scheme) - and sends
// it as the Origin header even though the actual request leaves from Rust, not a browser tab
const isDesktopApp = (origin: string) => origin === 'tauri://localhost' || origin === 'http://tauri.localhost';

export const sameOrigin = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;

  if (
    !origin ||
    SAFE_METHODS.includes(req.method) ||
    allowedOrigins.includes(origin) ||
    isDesktopApp(origin) ||
    origin === `${req.protocol}://${req.get('host')}`
  ) {
    return next();
  };

  return res.status(403).json({ success: false, message: 'Origin not allowed' });
};
