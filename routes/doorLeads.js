// routes/doorLeads.js
import express from "express";
import { addTask, completeMeasurement, doorLead, emailQuotation, sendOrderConfirmation, sendProposal, uploadQuotationAndPrepare, sendPreparedQuotation, getAllLeads, placeCall, qualifyLead, scheduleMeasurement, sendMail, updateStatus, updateTask, trackingLink, track, requestDesignApproval, decideDesign, startProduction, uploadDesign, getDesignReview, listRevisions, completeProduction, scheduleInstallationByLead, scheduleInstallationByRef, rzpAdvanceCallback, rzpBalanceCallback, completeInstallation } from "../controllers/doorLead.js";
import { uploadFrames } from "../middleware/uploadFrames.js";
const router = express.Router();

router.post("/", doorLead);             // POST /api/door-leads
router.get("/getLeads", getAllLeads);             // POST /api/door-leads
router.post("/:id/email", sendMail);             // POST /api/door-leads
router.patch("/:id/status", updateStatus);
router.post("/:id/place-call", placeCall);
router.post("/:id/qualify", qualifyLead);
router.post("/:id/schedule-measurement", scheduleMeasurement);
router.post("/:id/complete-measurement", express.json({ limit: "25mb" }), completeMeasurement);
router.post("/:id/email-quotation", emailQuotation);
router.post("/:id/quotation", uploadQuotationAndPrepare);
router.post("/:id/send-quotation",sendPreparedQuotation);
router.post('/:id/order-confirmation',sendOrderConfirmation);
router.post("/:id/send-proposal", sendProposal);
// router.post("/:id/payment-callback", paymentCallback);
router.post("/:id/tracking-link", trackingLink);
router.post("/track/:token", track);
router.post("/:id/design/upload", uploadDesign);
// router.post("/:id/design/request-approval", requestDesignApproval);
router.post("/:id/design/request-approval", express.json({ limit: "2mb" }), requestDesignApproval);
router.get("/design/review/:token", getDesignReview);
router.post("/design/decide", decideDesign);
router.get("/:id/design/revisions", listRevisions);
router.post("/:id/production/start", startProduction);
router.post("/:id/production/complete", completeProduction);
router.post("/:id/installation/schedule", scheduleInstallationByLead);
router.post("/installation/schedule-by-ref", scheduleInstallationByRef);
router.get("/payments/callback/advance", rzpAdvanceCallback);
router.get("/payments/callback/balance", rzpBalanceCallback);
router.post("/:id/installation/complete", completeInstallation);
// /:id/design/request-approval
// /design/decide
// /:id/production/start
router.post("/:id/tasks", addTask);
router.patch("/:id/tasks/:taskId", updateTask);

export default router;
