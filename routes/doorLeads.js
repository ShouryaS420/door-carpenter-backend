// routes/doorLeads.js
import express from "express";
import { doorLead, getAllLeads, sendMail } from "../controllers/doorLead.js";
const router = express.Router();

router.post("/", doorLead);             // POST /api/door-leads
router.get("/getLeads", getAllLeads);             // POST /api/door-leads
router.post("/:id/email", sendMail);             // POST /api/door-leads

export default router;
