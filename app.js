import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";

import doorLeads from "./routes/doorLeads.js";
import uploadRoute from './routes/upload.js';
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/userRoutes.js";
import paymentsRoutes from './routes/payments.js';
import { startAutoAssign } from "./cron/autoAssign.js";
import { followUpScheduler } from "./cron/followUpScheduler.js";


export const app = express();

// cron jobs
// startAutoAssign();
followUpScheduler();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors());
app.use("/uploads", express.static(path.resolve("uploads")));

app.use("/api/door-leads", doorLeads);
app.use("/api/uploads", uploadRoute);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/payments", paymentsRoutes);

/* 2️⃣ attach guard = protects everything *below* this line */
// app.use(verify);
