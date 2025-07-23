// routes/auth.js
import express from "express";
import { login } from "../controllers/auth.js";
import { verify } from "../middleware/auth.js";
const router = express.Router();

router.post("/login", login);

export default router;
