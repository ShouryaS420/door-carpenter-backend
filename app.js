import express from "express";
import doorLeads from "./routes/doorLeads.js";
import uploadRoute from './routes/upload.js';
import authRoutes from "./routes/auth.js";

import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import {verify} from "./middleware/auth.js";

export const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors());
app.use("/uploads", express.static(path.resolve("uploads")));

app.use("/api/door-leads", doorLeads);
app.use("/api/uploads", uploadRoute);
app.use("/api/auth", authRoutes);

/* 2️⃣ attach guard = protects everything *below* this line */
// app.use(verify);
