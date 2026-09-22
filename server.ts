import 'dotenv/config';
import './lib/env-check.js';
import express from "express";
import cookieParser from 'cookie-parser';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { openapi } from './docs/openapi.js';
import { defaultBody } from './middleware/body.middleware.js';
import { sameOrigin } from './middleware/origin.middleware.js';
import authRoutes from './features/auth/auth.route.js';
import moduleRoutes from './features/modules/module.route.js';
import examRoutes from './features/exams/exam.route.js';
import questionRoutes from './features/questions/question.route.js';
import attemptRoutes from './features/attempts/attempt.route.js';
import monitoringRoutes from './features/monitoring/monitoring.route.js';
import cheatingRoutes from './features/cheatings/cheating.route.js';


const app = express();
const PORT = process.env.PORT

app.use(express.json({ limit: "10mb" }));
app.use(defaultBody);
app.use(cookieParser());
app.set("trust proxy", 1);
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
)
app.use(sameOrigin);

app.get("/health", (req, res) => res.json({ success: true }));
app.get("/docs.json", (req, res) => res.json(openapi));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "MAGI API" }));

app.use("/api/auth", authRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/assignments", attemptRoutes);
app.use("/api/monitoring", monitoringRoutes);
app.use("/api/cheatings", cheatingRoutes);


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
