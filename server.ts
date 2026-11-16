import 'dotenv/config';
import './lib/env-check.js';
import express from "express";
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { apiReference } from '@scalar/express-api-reference';
import { openapi } from './docs/openapi.js';
import { defaultBody } from './middleware/body.middleware.js';
import { sameOrigin } from './middleware/origin.middleware.js';
import { database } from './lib/db.js';
import authRoutes from './features/auth/auth.route.js';
import moduleRoutes from './features/modules/module.route.js';
import examRoutes from './features/exams/exam.route.js';
import questionRoutes from './features/questions/question.route.js';
import attemptRoutes from './features/attempts/attempt.route.js';
import monitoringRoutes from './features/monitoring/monitoring.route.js';
import cheatingRoutes from './features/cheatings/cheating.route.js';
import notificationRoutes from './features/notifications/notification.route.js';
import aiRoutes from './features/ai/ai.route.js';
import attendanceRoutes from './features/attendance/attendance.route.js';


const app = express();
const PORT = process.env.PORT

app.use(express.json({ limit: "10mb" }));
app.use(defaultBody);
app.use(cookieParser());
app.set("trust proxy", 1);
app.use(
  cors({
    // comma-separated for local dev, where admin and frontend run on different ports
    origin: process.env.CLIENT_URL?.split(',').map((url) => url.trim()),
    credentials: true,
  })
)
app.use(sameOrigin);

// health check for railway - only the db being reachable matters here
app.get("/health", async (req, res) => {
  try {
    const { error } = await database.from('users').select('id').limit(1);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) {
    // no auth on this route, so don't leak the error
    console.error('health check failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ success: false, message: 'database unreachable' });
  };
});
app.get("/docs.json", (req, res) => res.json(openapi));
app.use("/docs", apiReference({ content: openapi, theme: "purple", pageTitle: "MAGI API" }));

// responses are per-user (cookie), don't let a shared cache serve them to someone else
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/assignments", attemptRoutes);
app.use("/api/monitoring", monitoringRoutes);
app.use("/api/cheatings", cheatingRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/attendance", attendanceRoutes);


const server = app.listen(PORT, () => {
  console.log(`The server running on PORT:${PORT}`)
})

// let in-flight requests finish when the machine is stopped
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  });
};
