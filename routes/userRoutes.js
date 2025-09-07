// routes/userRoutes.js
import express from "express";
import { createUser, getAllTechnicians, listUsers, loginUser } from "../controllers/userController.js";
const router = express.Router();

// public
router.post("/login",  loginUser);
router.post("/createUser", createUser);
router.get("/technicians", getAllTechnicians);
router.get("/listUsers", listUsers);

export default router;
