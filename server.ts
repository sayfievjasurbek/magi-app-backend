import 'dotenv/config';
import express from "express";
import cookieParser from 'cookie-parser';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { openapi } from './docs/openapi.js';
import { defaultBody } from './middleware/body.middleware.js';
import authRoutes from './routes/auth.route.js';
import moduleRoutes from './routes/module.route.js';
import examRoutes from './routes/exam.route.js';
import questionRoutes from './routes/question.route.js';
import attemptRoutes from './routes/attempt.route.js';
import monitoringRoutes from './routes/monitoring.route.js';
import cheatingRoutes from './routes/cheating.route.js';


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

app.get("/docs.json", (req, res) => res.json(openapi));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "MAGI API" }));

app.use("/api/auth", authRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/assignments", attemptRoutes);
app.use("/api/monitoring", monitoringRoutes);
app.use("/api/cheatings", cheatingRoutes);


app.listen(PORT, () => {
  console.log(`The server running on PORT:${PORT}`)
})
