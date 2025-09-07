import DoorLead from "../models/doorLead.js";
import nodemailer from 'nodemailer';
import { SendMail } from "../utils/sendmail.js";
import axios from "axios";
import User from "../models/User.js";
import { format } from "date-fns";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";
import PDFDocument from "pdfkit";
import { razorpay } from '../lib/razorpay.js';
import crypto from "crypto";

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SLA = {
    // Lead phases
    LEAD_NEW: 0,                           // immediate / auto‑thank you
    LEAD_QUALIFIED: 12 * 3600 * 1000,           // 12 hours
    MEASURE_BOOKED: 24 * 3600 * 1000,           // 24 hours to schedule
    MEASURE_DONE: 8 * 3600 * 1000,            // same‑day to prepare estimate

    // Quotation phases
    QUOTE_DRAFTED: 48 * 3600 * 1000,           // 48 hours to draft
    QUOTE_SENT: 24 * 3600 * 1000,           // 24 hours to share
    QUOTE_NEGOTIATE: 5 * 24 * 3600 * 1000,       // 5 days cycle

    // Order & production
    ORDER_CONFIRMED: 24 * 3600 * 1000,           // 24 hours to receive PO+advance
    PROD_READY: 3 * 24 * 3600 * 1000,       // 2–3 days for design freeze
    PROD_RUNNING: 30 * 24 * 3600 * 1000,      // 30 days manufacture

    // Delivery & installation
    DISPATCHED: 0,                          // immediate once QC done
    INSTALL_BOOKED: 48 * 3600 * 1000,           // 48 hours before install
    INSTALL_DONE: 0,                          // onsite completion immediate

    // Handover & warranty
    HANDOVER_DONE: 7 * 24 * 3600 * 1000,       // 7 days to close invoice
    WARRANTY_ACTIVE: 365 * 24 * 3600 * 1000      // 12 months warranty
};

function buildRefId(leadId, tag = "X") {
    const idPart = String(leadId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
    const ts = Date.now().toString(36);
    const rnd = Math.random().toString(36).slice(2, 6);
    return `${idPart}-${ts}-${rnd}-${tag}`; // tag: 'A'|'B'
}

const OUTCOME_STATUS_MAP = {
    Interested: "LEAD_QUALIFIED",
    "Call Back Later": "LEAD_CALLBACK",
    "Busy/Waiting": "LEAD_CALLBACK",
    "No Response": "LEAD_CALLBACK",
    "Not Reachable": "LEAD_CALLBACK",
    "Invalid Number": "DATA_FIX_NEEDED",
    "Not Interested": "LEAD_DISQUALIFIED",
    "Plan postponed": "LEAD_POSTPONED",
    "Already Purchased": "LEAD_CLOSED"
};

// ensure upload dir
const uploadDir = path.join(__dirname, "..", "uploads", "quotations");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// store PDF under uploads/quotations with a unique filename
const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadDir),
    filename: (_, file, cb) => {
        const ext = path.extname(file.originalname) || ".pdf";
        cb(null, `quote-${Date.now()}${ext}`);
    }
});
export const uploadQuotation = multer({ storage });

const THEME = {
    brand: "#FF4A10",
    text: "#111111",
    muted: "#666666",
    line: "#333",
    pageW: 595,
    margin: 40
};
const company = {
    name: "DoorCartenpter",
    addr: "Gravity COmmercial COmplex, C-wing, 2ns floor, Balewadi, Pune, Maharashtra, 4111045",
    tel: "8378960089",
    dealerCode: "166012",
    email: "info@doorcarpenter.in",
};

// helper: make sure lead has a tracking token and return a full frontend URL
async function ensureTrackingUrl(lead) {
    if (!lead.tracking || !lead.tracking.token || lead.tracking.revoked) {
        lead.tracking = {
            token: crypto.randomBytes(16).toString("hex"),
            createdAt: new Date(),
            revoked: false,
        };
        await lead.save();
    }
    const FE = "http://localhost:5173";
    return `${FE}/track/${lead.tracking.token}`;
}

// ===== Brand/email helpers =====
const BRAND = {
    name: "DoorCarpenter",
    color: "#FF4A10",
    supportEmail: "support@doorcarpenter.in",
    supportPhone: "+91 89834 36996",
    site: "https://doorcarpenter.in",
    logoLight: "https://yourcdn.com/logo-white.png", // white logo for colored bg
    logoDark: "https://yourcdn.com/logo.png"        // dark logo for light bg
};

function emailShell({ title, body }) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f6;font-family:Inter,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f6;padding:32px 0">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.07)">
        <tr>
          <td style="background:${BRAND.color};padding:22px;text-align:center">
            <img src="${BRAND.logoLight}" width="140" alt="${BRAND.name}" style="display:block;margin:0 auto" />
          </td>
        </tr>
        ${body}
        <tr>
          <td style="background:#fafafa;padding:18px 28px;text-align:center;font-size:13px;color:#888">
            © ${new Date().getFullYear()} ${BRAND.name} · Pune, India · 
            <a href="mailto:${BRAND.supportEmail}" style="color:#888;text-decoration:underline">${BRAND.supportEmail}</a> · 
            <a href="tel:${BRAND.supportPhone.replace(/\s+/g, '')}" style="color:#888;text-decoration:underline">${BRAND.supportPhone}</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function pill(label, value) {
    return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #eee;color:#666">${label}</td>
    <td style="padding:10px 0;border-bottom:1px solid #eee;color:#111;text-align:right;font-weight:600">${value}</td>
  </tr>`;
}

function renderDesignReviewEmail({ lead, version, link, fileCount }) {
    const title = `Please review your design v${version}`;
    const body = `
    <tr>
      <td style="padding:32px 40px">
        <h1 style="margin:0 0 10px;font-size:24px;color:#222;font-weight:700">Design v${version} is ready for your review</h1>
        <p style="margin:0;color:#555;font-size:15px;line-height:1.6">
          Hi ${lead.contact?.name || "there"},<br/>
          We’ve prepared your design drawings. Please review and approve, or request changes.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 8px;border-collapse:collapse;font-size:14px;">
          ${pill("Customer", lead.contact?.name || "—")}
          ${pill("Order ID", String(lead._id))}
          ${pill("Version", "v" + version)}
          ${pill("Files", String(fileCount))}
        </table>
        <p style="text-align:center;margin:22px 0 6px">
          <a href="${link}" 
             style="display:inline-block;background:${BRAND.color};color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 22px;border-radius:6px">
            Open Design Review
          </a>
        </p>
        <p style="margin:16px 0 0;color:#777;font-size:13px;line-height:1.6">
          Tip: You can leave notes with “Request Changes”, or click “Approve” to proceed to production prep.
        </p>
      </td>
    </tr>
  `;
    return emailShell({ title, body });
}

function renderDesignApprovedEmail({ lead, version, decidedAt, trackUrl }) {
    const title = `Design v${version} approved — moving to production prep`;
    const decided = decidedAt ? new Date(decidedAt).toLocaleString() : "now";
    const body = `
    <tr>
      <td style="padding:32px 40px">
        <h1 style="margin:0 0 10px;font-size:24px;color:#222;font-weight:700">Thanks! Your design is approved ✅</h1>
        <p style="margin:0 0 12px;color:#555;font-size:15px;line-height:1.6">
          Hi ${lead.contact?.name || "there"}, we’ve recorded your approval for <strong>v${version}</strong> (${decided}).
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 8px;border-collapse:collapse;font-size:14px;">
          ${pill("Order ID", String(lead._id))}
          ${pill("Current Stage", "Design Freeze")}
          ${pill("Next Step", "Start Production")}
        </table>
        <p style="margin:14px 0;color:#555;font-size:14px;line-height:1.6">
          Our team will finalize production scheduling shortly. You can track live progress anytime:
        </p>
        <p style="text-align:center;margin:18px 0 6px">
          <a href="${trackUrl}" 
             style="display:inline-block;background:${BRAND.color};color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 22px;border-radius:6px">
            Track Your Order
          </a>
        </p>
      </td>
    </tr>
  `;
    return emailShell({ title, body });
}

function renderProductionStartedEmail({ lead, trackUrl, etaDate }) {
    const title = "Production Started";
    const etaStr = etaDate ? new Date(etaDate).toLocaleDateString() : "—";
    const body = `
    <tr>
      <td style="padding:32px 40px">
        <h1 style="margin:0 0 10px;font-size:24px;color:#222;font-weight:700">Production has started 🏭</h1>
        <p style="margin:0 0 12px;color:#555;font-size:15px;line-height:1.6">
          Hi ${lead.contact?.name || "there"}, your order has entered manufacturing.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 8px;border-collapse:collapse;font-size:14px;">
          ${pill("Order ID", String(lead._id))}
          ${pill("Product", `${lead.category}`)}
          ${pill("Finish", `${lead.finish?.label || "—"}`)}
          ${pill("Quantity", String(lead.size?.quantity || 1))}
          ${pill("Estimated Completion", etaStr)}
        </table>
        <p style="margin:14px 0;color:#555;font-size:14px;line-height:1.6">
          We’ll keep you posted at each milestone. You can check status anytime:
        </p>
        <p style="text-align:center;margin:18px 0 6px">
          <a href="${trackUrl}" 
             style="display:inline-block;background:${BRAND.color};color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 22px;border-radius:6px">
            Track Production
          </a>
        </p>
      </td>
    </tr>
  `;
    return emailShell({ title, body });
}

function renderBalanceDueEmail({ lead, amountDue, payUrl, trackUrl }) {
    const body = `
    <tr><td style="padding:32px 40px">
      <h1 style="margin:0 0 10px;font-size:24px;color:#222;font-weight:700">Production Completed 🎉</h1>
      <p style="margin:0 0 12px;color:#555;font-size:15px;line-height:1.6">
        Hi ${lead.contact?.name || "there"}, your order has finished production.
        Please complete the remaining payment to proceed to dispatch & installation.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 18px;border-collapse:collapse;font-size:14px;">
        ${pill("Order ID", String(lead._id))}
        ${pill("Balance Due", "₹" + amountDue)}
      </table>
      <p style="text-align:center;margin:12px 0 0">
        <a href="${payUrl}" style="display:inline-block;background:${BRAND.color};color:#fff;text-decoration:none;
           font-size:15px;font-weight:700;padding:12px 22px;border-radius:6px">Pay Balance Now</a>
      </p>
      <p style="text-align:center;margin:10px 0 0">
        <a href="${trackUrl}" style="color:#666;text-decoration:underline;font-size:13px">Track your order</a>
      </p>
    </td></tr>`;
    return emailShell({ title: "Balance Payment Required", body });
}

export const STAGE_ORDER = [
    "LEAD_NEW",
    "LEAD_QUALIFIED",
    "MEASURE_BOOKED",
    "MEASURE_DONE",
    "QUOTE_DRAFTED",
    "QUOTE_SENT",
    "QUOTE_NEGOTIATE",
    "ORDER_CONFIRMED",
    "PROD_READY",
    "PROD_RUNNING",
    "PROD_COMPLETED",
    "INSTALL_BOOKED",
    "INSTALL_DONE",
];

const rank = s => Math.max(0, STAGE_ORDER.indexOf(s));

/** Promote lead.status to target if target is ahead; never demote. */
export function setStatusAtLeast(lead, target) {
    if (!lead.status) lead.status = "LEAD_NEW";
    if (rank(lead.status) < rank(target)) {
        lead.status = target;
        return true;
    }
    return false;
}

/** Push stageMeta only if this stage is >= latest recorded stage (no backward entries). */
export function pushStageForward(lead, target, meta = {}) {
    const last = (lead.stageMeta || []).slice(-1)[0];
    const lastCode = last?.status || lead.status || "LEAD_NEW";
    if (rank(target) >= rank(lastCode)) {
        lead.stageMeta.push({ status: target, ...meta });
        return true;
    }
    // don’t push a backward stageMeta row (it confuses UIs)
    return false;
}

async function createBalanceLinkAndPersist(lead, amountPaise, description, tag = 'B') {
    const reference = buildRefId(lead._id, tag);
    const paymentLink = await razorpay.paymentLink.create({
        amount: amountPaise,
        currency: "INR",
        accept_partial: false,
        reference_id: reference,
        description,
        customer: {
            name: lead.contact.name,
            email: lead.contact.email,
            contact: lead.contact.phone
        },
        reminder_enable: true,
        callback_url: `${process.env.FRONTEND_URL || "http://localhost:5173"}/payment-status`,
        callback_method: "get"
    });

    lead.payments = lead.payments || [];
    lead.payments.push({
        referenceId: reference,
        paymentLinkId: paymentLink.id,
        shortUrl: paymentLink.short_url,
        description: paymentLink.description,
        status: paymentLink.status,
        amount: paymentLink.amount,
        currency: paymentLink.currency,
        createdAt: new Date(paymentLink.created_at * 1000),
        expiresAt: paymentLink.expire_by ? new Date(paymentLink.expire_by * 1000) : null,
        raw: { paymentLink, kind: "BALANCE" }
    });
    await lead.save();
    return { reference, paymentLink };
}

function _normRzpParams(req) {
    const p = (req.body && Object.keys(req.body).length ? req.body : req.query) || {};
    return {
        payment_link_id: p.razorpay_payment_link_id || p.payment_link_id || p.plink || "",
        reference_id: p.razorpay_payment_link_reference_id || p.reference_id || p.ref || "",
        payment_id: p.razorpay_payment_id || p.payment_id || "",
        rawStatus: String(p.razorpay_payment_link_status || p.payment_link_status || p.status || "").toLowerCase(),
    };
}

async function _updatePaymentRecord(lead, { reference_id, payment_link_id, payment_id, status, req }) {
    const idx = (lead.payments || []).findIndex(
        x => x.referenceId === reference_id || (payment_link_id && x.paymentLinkId === payment_link_id)
    );
    if (idx === -1) return null;
    const prev = lead.payments[idx] || {};
    const paidAt = status === "paid" ? (prev.paidAt || new Date()) : prev.paidAt;

    lead.payments[idx] = {
        ...prev,
        status,
        paymentId: payment_id || prev.paymentId,
        paidAt,
        raw: { ...(prev.raw || {}), callbackQuery: { ...req.query, ...req.body } }
    };
    return { idx, rec: lead.payments[idx] };
}

/**
 * GET/POST /api/payments/callback/advance
 * Confirms order/production when the 50% ADVANCE link is paid.
 */
export const rzpAdvanceCallback = async (req, res) => {
    try {
        const { payment_link_id, reference_id, payment_id, rawStatus } = _normRzpParams(req);
        if (!reference_id) return res.status(400).send("Missing reference_id");

        const lead = await DoorLead.findOne({ "payments.referenceId": reference_id });
        if (!lead) return res.status(404).send("Lead not found for reference");

        // Best-effort verify with Razorpay
        let rzpLink = null;
        try { if (payment_link_id) rzpLink = await razorpay.paymentLink.fetch(payment_link_id); } catch { }
        const status = String(rzpLink?.status || rawStatus || "unknown").toLowerCase();

        const upd = await _updatePaymentRecord(lead, { reference_id, payment_link_id, payment_id, status, req });
        await lead.save();

        if (status === "paid" && upd) {
            // Detect ADVANCE: prefer explicit kind, fall back to ref tag or description
            const rec = upd.rec;
            const explicit = String(rec?.raw?.kind || "").toUpperCase(); // "ADVANCE" set when creating link
            const refTag = reference_id.split("-").pop();               // "...-A" or "...-B"
            const byDesc = /advance|upfront|deposit/i.test(rec?.description || "");
            const kind = explicit || (refTag === "A" ? "ADVANCE" : "") || (byDesc ? "ADVANCE" : "UNKNOWN");

            if (kind === "ADVANCE") {
                // Promote to ORDER_CONFIRMED only (production confirmation), timestamp = paidAt
                const paidAtTs = rec.paidAt || new Date();
                const changed = setStatusAtLeast(lead, "ORDER_CONFIRMED");
                if (changed) {
                    pushStageForward(lead, "ORDER_CONFIRMED", {
                        responsible: lead.assignee || "System",
                        uploadedBy: "Razorpay",
                        dueAt: paidAtTs
                    });
                    lead.activityLog.push({
                        type: "Advance Received (50%)",
                        actor: "Razorpay",
                        timestamp: paidAtTs,
                        details: { referenceId: reference_id, paymentId: rec.paymentId }
                    });
                }
                await lead.save();
            }
        }

        const FE = process.env.FRONTEND_URL || "http://localhost:5173";
        return res.redirect(`${FE}/payment-status?status=${encodeURIComponent(status)}&ref=${encodeURIComponent(reference_id)}`);
    } catch (err) {
        console.error("rzpAdvanceCallback error:", err);
        return res.status(500).send("Internal error");
    }
};

/**
 * GET/POST /api/payments/callback/balance
 * When BALANCE is paid and production is completed → auto-book installation.
 * If production isn't completed yet, it records the payment and waits.
 */
export const rzpBalanceCallback = async (req, res) => {
    try {
        const { payment_link_id, reference_id, payment_id, rawStatus } = _normRzpParams(req);
        if (!reference_id) return res.status(400).send("Missing reference_id");

        const lead = await DoorLead.findOne({ "payments.referenceId": reference_id });
        if (!lead) return res.status(404).send("Lead not found for reference");

        // Verify with Razorpay (best effort)
        let rzpLink = null;
        try { if (payment_link_id) rzpLink = await razorpay.paymentLink.fetch(payment_link_id); } catch { }
        const status = String(rzpLink?.status || rawStatus || "unknown").toLowerCase();

        const upd = await _updatePaymentRecord(lead, { reference_id, payment_link_id, payment_id, status, req });
        await lead.save();

        if (status === "paid" && upd) {
            const rec = upd.rec;
            const explicit = String(rec?.raw?.kind || "").toUpperCase(); // "BALANCE" set when creating link
            const refTag = reference_id.split("-").pop();               // "...-B"
            const byDesc = /balance|final|remaining|full/i.test(rec?.description || "");
            const kind = explicit || (refTag === "B" ? "BALANCE" : "") || (byDesc ? "BALANCE" : "UNKNOWN");

            if (kind === "BALANCE") {
                // If fully paid now, and production is completed → INSTALL_BOOKED
                const fullyPaid = isFullyPaid(lead); // uses computeTotalsINRPaise
                const prodDone = rank(lead.status) >= rank("PROD_COMPLETED");

                lead.activityLog.push({
                    type: "Balance Received (50%)",
                    actor: "Razorpay",
                    timestamp: rec.paidAt || new Date(),
                    details: { referenceId: reference_id, paymentId: rec.paymentId, fullyPaid }
                });

                if (fullyPaid && prodDone) {
                    const desired = lead.installation?.pending?.desiredAt
                        ? new Date(lead.installation.pending.desiredAt)
                        : undefined;
                    if (lead.installation?.pending) delete lead.installation.pending;

                    try {
                        await autoScheduleInstallation(lead, { actor: "Razorpay", when: desired });
                    } catch (e) {
                        // If dues unexpectedly calculated (race), just log
                        console.error("Auto-schedule failed:", e.message);
                    }
                } else {
                    // Not yet in PROD_COMPLETED → wait; installation will be scheduled by ops
                    lead.installation = lead.installation || {};
                    lead.installation.pending = {
                        ...(lead.installation.pending || {}),
                        fullyPaidAt: rec.paidAt || new Date(),
                    };
                }
                await lead.save();
            }
        }

        const FE = process.env.FRONTEND_URL || "http://localhost:5173";
        return res.redirect(`${FE}/payment-status?status=${encodeURIComponent(status)}&ref=${encodeURIComponent(reference_id)}`);
    } catch (err) {
        console.error("rzpBalanceCallback error:", err);
        return res.status(500).send("Internal error");
    }
};

// export const doorLead = async (req, res) => {
//     // console.log(req.body);
//     try {
//         // 1) create the new lead
//         const payload = {
//             ...req.body,
//             status:   "LEAD_NEW",
//             assignee: "Unassigned",   // or pick a queue‐owner
//             stageMeta: [],
//             tasks:     [],
//             calls:     [],
//             activityLog:[]
//         };

//         const lead = await DoorLead.create(payload); // 🚀 insert

//         // 2) immediately seed the first stageMeta entry
//         const FOUR_HOURS = 4*60*60*1000;
//         lead.stageMeta.push({
//             status:      "LEAD_NEW",
//             responsible: lead.assignee,
//             uploadedBy:  req.body.sessionId,
//             dueAt:       new Date(Date.now()+FOUR_HOURS)
//         });

//         lead.activityLog.push({
//             type:      "Lead Created",
//             timestamp: new Date(),
//             actor:     "Admin",
//             details:   { source: "Web Form" }
//         });

//         await lead.save();

//         const trackUrl = await ensureTrackingUrl(lead);

//         const WelcomeEmail = `<!DOCTYPE html>
//             <html lang="en">
//             <head>
//                 <meta charset="UTF-8" />
//                 <title>Welcome to DoorCarpenter</title>
//             </head>
//             <body style="margin:0;padding:0;background:#f2f4f6;font-family:Inter,Arial,sans-serif;">
//                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f6;padding:40px 0">
//                 <tr>
//                     <td align="center">
//                     <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05)">
//                         <!-- HEADER -->
//                         <tr>
//                         <td style="background:#FF4A10;padding:24px;text-align:center">
//                             <img src="https://yourcdn.com/logo-white.png" width="140" alt="DoorCarpenter" style="display:block;margin:0 auto" />
//                         </td>
//                         </tr>

//                         <!-- HERO -->
//                         <tr>
//                         <td style="padding:32px 40px;text-align:center">
//                             <h1 style="margin:0;font-size:28px;color:#333;font-weight:600">Welcome, ${lead.contact.name}!</h1>
//                             <p style="margin:16px 0 0;color:#555;font-size:16px;line-height:1.6">
//                             Thank you for choosing <strong>DoorCarpenter</strong>. We’ve received your custom 
//                             <strong>${lead.category}</strong> quote request (ID <strong>${lead._id}</strong>).
//                             </p>
//                         </td>
//                         </tr>

//                         <!-- NEXT STEPS -->
//                         <tr>
//                         <td style="padding:0 40px">
//                             <h2 style="font-size:18px;color:#333;margin:0 0 12px">What happens next?</h2>
//                             <ul style="margin:0 0 24px;padding-left:20px;color:#555;font-size:15px;line-height:1.6">
//                             <li>Our estimator will review your specs.</li>
//                             <li>We’ll reach out within <strong>24 hours</strong> to confirm measurements & finishes.</li>
//                             <li>You’ll receive a detailed quote via email/WhatsApp.</li>
//                             </ul>
//                         </td>
//                         </tr>

//                         <!-- ORDER SUMMARY -->
//                         <tr>
//                         <td style="padding:0 40px 32px">
//                             <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px;color:#555">
//                             <tr>
//                                 <td style="padding:8px 0;border-bottom:1px solid #ececec">Core Material:</td>
//                                 <td style="padding:8px 0;border-bottom:1px solid #ececec">${lead.core}</td>
//                             </tr>
//                             <tr>
//                                 <td style="padding:8px 0;border-bottom:1px solid #ececec">Finish:</td>
//                                 <td style="padding:8px 0;border-bottom:1px solid #ececec">${lead.finish.label}</td>
//                             </tr>
//                             <tr>
//                                 <td style="padding:8px 0;border-bottom:1px solid #ececec">Quantity:</td>
//                                 <td style="padding:8px 0;border-bottom:1px solid #ececec">${lead.size.quantity}</td>
//                             </tr>
//                             <tr>
//                                 <td style="padding:8px 0">Request Date:</td>
//                                 <td style="padding:8px 0">${new Date(lead.createdAt).toLocaleDateString()}</td>
//                             </tr>
//                             </table>
//                         </td>
//                         </tr>

//                         <!-- CTA BUTTON -->
//                         <tr>
//                         <td style="padding:0 40px 40px;text-align:center">
//                             <a 
//                             href="${trackUrl}"
//                             style="
//                                 display:inline-block;
//                                 background:#FF4A10;
//                                 color:#fff;
//                                 text-decoration:none;
//                                 font-size:16px;
//                                 font-weight:600;
//                                 padding:14px 32px;
//                                 border-radius:6px;
//                                 box-shadow:0 2px 6px rgba(0,0,0,0.15);
//                             "
//                             >
//                                 Track Your Request
//                             </a>
//                         </td>
//                         </tr>

//                         <!-- FOOTER -->
//                         <tr>
//                         <td style="background:#fafafa;padding:24px 40px;text-align:center;font-size:13px;color:#888">
//                             © ${new Date().getFullYear()} DoorCarpenter · Pune, India<br>
//                             You're receiving this because you requested a quote on our site.<br>
//                             <a href="mailto:support@doorcarpenter.in" style="color:#888;text-decoration:underline">Contact Support</a>
//                         </td>
//                         </tr>
//                     </table>
//                     </td>
//                 </tr>
//                 </table>
//             </body>
//             </html>`;

//         const interaktPayload = {
//             countryCode: "+91",                         // or whatever
//             phoneNumber: lead.contact.phone,            // no leading zero
//             type: "Template",
//             callbackData: lead._id.toString(),          // so you can match webhooks
//             template: {
//                 name: "new",            // your template codename
//                 languageCode: "en",
//                 // headerValues: [],                      // only if your header has variables
//                 bodyValues: [
//                     lead.contact.name,                     // {{1}}
//                     lead._id.toString(),                   // {{2}}
//                     "24"                                   // {{3}} hours until follow‑up
//                 ]
//                 // buttonValues: { … }                    // if your template has a dynamic URL button
//             }
//         };

//         await axios.post(
//             "https://api.interakt.ai/v1/public/message/",
//                 interaktPayload,
//                 {
//                     headers: {
//                         "Content-Type": "application/json",
//                         // <-- raw API key, no base64
//                         Authorization: `Basic ${process.env.INTERAKT_API_KEY}`
//                     }
//                 }
//             );

//         await SendMail(lead.contact.email, `Hi! ${lead.contact.name} welcome DoorCarpenter`, WelcomeEmail);
//         res.status(201).json({ id: lead._id });

//     } catch (e) {
//         console.log(e);
//         res.status(500).json({ error: "db‑insert‑failed" });
//     }
// }

export const doorLead = async (req, res) => {
    try {
        // --- Align new UI fields to your model shape (non-breaking) ---
        // Accepts: requirement, fullName, phone, email, message, city
        // Keeps legacy shape if it comes (category, contact: {name, phone, email, pin, notes})
        const hasNewForm =
            req.body &&
            (req.body.requirement ||
                req.body.fullName ||
                req.body.phone ||
                req.body.email ||
                req.body.message ||
                req.body.city);

        if (hasNewForm) {
            const notesParts = [
                req.body?.contact?.notes || null,
                req.body.city ? `City: ${req.body.city}` : null,
                req.body.message ? `Message: ${req.body.message}` : null,
            ].filter(Boolean);

            // Map requirement -> category
            if (!req.body.category && req.body.requirement) {
                req.body.category = req.body.requirement;
            }

            // Ensure nested contact block
            req.body.contact = {
                ...(req.body.contact || {}),
                name: req.body.contact?.name || req.body.fullName,
                phone: req.body.contact?.phone || req.body.phone,
                email: req.body.contact?.email || req.body.email,
                notes: notesParts.length ? notesParts.join("\n") : req.body?.contact?.notes,
            };

            // Your schema requires a sessionId. If missing, derive a stable one from phone/email.
            req.body.sessionId =
                req.body.sessionId ||
                req.body.session_id ||
                req.body.sid ||
                req.body.contact?.phone ||
                req.body.contact?.email;
        }

        // 1) create the new lead (unchanged)
        const payload = {
            ...req.body,
            status: "LEAD_NEW",
            assignee: "Unassigned",
            stageMeta: [],
            tasks: [],
            calls: [],
            activityLog: []
        };

        const lead = await DoorLead.create(payload); // 🚀 insert

        // 2) immediately seed the first stageMeta entry (unchanged)
        const FOUR_HOURS = 4 * 60 * 60 * 1000;
        lead.stageMeta.push({
            status: "LEAD_NEW",
            responsible: lead.assignee,
            uploadedBy: req.body.sessionId,
            dueAt: new Date(Date.now() + FOUR_HOURS)
        });

        lead.activityLog.push({
            type: "Lead Created",
            timestamp: new Date(),
            actor: "Admin",
            details: { source: "Web Form" }
        });

        await lead.save();

        const trackUrl = await ensureTrackingUrl(lead);

        // --- Extract new-form fields for email view (from mapped lead) ---
        const notes = (lead?.contact?.notes || "");
        const cityMatch = notes.match(/City:\s*(.*)/i);
        const msgMatch = notes.match(/Message:\s*([\s\S]*)/i);
        const cityText = cityMatch?.[1]?.trim() || "—";
        const messageText = (msgMatch?.[1] || "").trim() || "—";

        // Updated Welcome Email (aligned to new data)
        const WelcomeEmail = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Welcome to DoorCarpenter</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f6;font-family:Inter,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f6;padding:40px 0">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05)">

          <!-- HEADER -->
          <tr>
            <td style="background:#FF4A10;padding:24px;text-align:center">
              <img src="https://yourcdn.com/logo-white.png" width="140" alt="DoorCarpenter" style="display:block;margin:0 auto" />
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td style="padding:32px 40px;text-align:center">
              <h1 style="margin:0;font-size:28px;color:#333;font-weight:600">Welcome, ${lead?.contact?.name || "there"}!</h1>
              <p style="margin:16px 0 0;color:#555;font-size:16px;line-height:1.6">
                Thank you for choosing <strong>DoorCarpenter</strong>. We’ve received your
                <strong>${lead?.category || "Door"}</strong> enquiry (ID <strong>${lead._id}</strong>).
              </p>
            </td>
          </tr>

          <!-- NEXT STEPS -->
          <tr>
            <td style="padding:0 40px">
              <h2 style="font-size:18px;color:#333;margin:0 0 12px">What happens next?</h2>
              <ul style="margin:0 0 24px;padding-left:20px;color:#555;font-size:15px;line-height:1.6">
                <li>Our estimator will review your details.</li>
                <li>We’ll reach out within <strong>24&nbsp;hours</strong> to confirm measurements & finishes.</li>
                <li>You’ll receive a detailed quote via email/WhatsApp.</li>
              </ul>
            </td>
          </tr>

          <!-- SUMMARY (aligned to new fields) -->
          <tr>
            <td style="padding:0 40px 12px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px;color:#555">
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #ececec">Requirement:</td>
                  <td style="padding:8px 0;border-bottom:1px solid #ececec">${lead?.category || "—"}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #ececec">Full Name:</td>
                  <td style="padding:8px 0;border-bottom:1px solid #ececec">${lead?.contact?.name || "—"}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #ececec">Phone:</td>
                  <td style="padding:8px 0;border-bottom:1px solid #ececec">${lead?.contact?.phone || "—"}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #ececec">Email:</td>
                  <td style="padding:8px 0;border-bottom:1px solid #ececec">${lead?.contact?.email || "—"}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #ececec">City:</td>
                  <td style="padding:8px 0;border-bottom:1px solid #ececec">${cityText}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0">Request Date:</td>
                  <td style="padding:8px 0">${new Date(lead.createdAt).toLocaleDateString()}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- MESSAGE (pre-wrapped) -->
          <tr>
            <td style="padding:0 40px 24px">
              <h3 style="font-size:16px;color:#333;margin:16px 0 8px">Your Message</h3>
              <div style="padding:12px;border:1px solid #ececec;border-radius:6px;background:#fafafa;color:#555;white-space:pre-wrap;">
                ${messageText}
              </div>
            </td>
          </tr>

          <!-- CTA BUTTON -->
          <tr>
            <td style="padding:0 40px 40px;text-align:center">
              <a href="${trackUrl}"
                 style="display:inline-block;background:#FF4A10;color:#fff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 32px;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,0.15);">
                Track Your Request
              </a>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#fafafa;padding:24px 40px;text-align:center;font-size:13px;color:#888">
              © ${new Date().getFullYear()} DoorCarpenter · Pune, India<br>
              You're receiving this because you requested a quote on our site.<br>
              <a href="mailto:support@doorcarpenter.in" style="color:#888;text-decoration:underline">Contact Support</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

        // Interakt message (unchanged)
        const interaktPayload = {
            countryCode: "+91",
            phoneNumber: lead.contact.phone,
            type: "Template",
            callbackData: lead._id.toString(),
            template: {
                name: "new",
                languageCode: "en",
                bodyValues: [
                    lead.contact.name,
                    lead._id.toString(),
                    "24"
                ]
            }
        };

        // await axios.post(
        //     "https://api.interakt.ai/v1/public/message/",
        //     interaktPayload,
        //     {
        //         headers: {
        //             "Content-Type": "application/json",
        //             Authorization: `Basic ${process.env.INTERAKT_API_KEY}`
        //         }
        //     }
        // );

        await SendMail(
            lead.contact.email,
            `Hi ${lead.contact.name}, welcome to DoorCarpenter`,
            WelcomeEmail
        );

        res.status(201).json({ id: lead._id });

    } catch (e) {
        console.log(e);
        res.status(500).json({ error: "db-insert-failed" });
    }
};


export const getAllLeads = async (req, res) => {
    try {
        const leads = await DoorLead.find();
        res.json(leads);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e });
    }
}

export const sendMail = async (req, res) => {
    try {
        const lead = await DoorLead.findById(req.params.id);
        if (!lead) return res.status(404).json({ error: "not-found" });
        await SendMail(lead.contact.email, "Your custom door quote", req.body.body);
        res.status(200).json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e });
    }
}

export const updateStatus = async (req, res) => {
    const { id } = req.params;
    const { newStatus, userId } = req.body;
    const lead = await DoorLead.findById(id);
    if (!lead) return res.status(404).end();

    const dueAt = new Date(Date.now() + (SLA[newStatus] || 24 * 3600 * 1000));

    lead.stageMeta.push({
        status: newStatus,
        responsible: lead.assignee,
        uploadedBy: userId,
        dueAt
    });
    lead.status = newStatus;
    // optionally pick next assignee here…
    await lead.save();

    res.json(lead);
};

// ————————————————————————————————————————————————————————————————
// 2) Place Call API
// ————————————————————————————————————————————————————————————————
export const placeCall = async (req, res) => {
    const { id } = req.params;
    const lead = await DoorLead.findById(id);
    if (!lead) return res.status(404).json({ error: "not-found" });

    const adminName = "admin";
    const now = new Date();

    // 1️⃣ record in calls[]
    lead.calls.push({
        outcome: null,
        details: {},
        loggedAt: now,
        loggedBy: "Admin",
        type: "CALL_PLACED"
    });

    // 2️⃣ record in activityLog[]
    lead.activityLog.push({
        type: "Call Placed",
        timestamp: now,
        actor: "Admin",
        details: { phone: lead.contact.phone }
    });

    await lead.save();
    res.json({ success: true, calls: lead.calls });
};

export const qualifyLead = async (req, res) => {
    const { outcome, details } = req.body;
    const actor = req.user?.name || req.user?.userId || "Admin";
    const userName = "Admin";   // however you store it
    const lead = await DoorLead.findById(req.params.id);
    if (!lead) return res.status(404).end();
    const now = new Date();

    // 1) log the call
    lead.calls.push({
        outcome,
        details,
        loggedAt: new Date(),
        loggedBy: userName,
        type: "CALL_OUTCOME"
    });

    const humanDesc = details.description || (() => {
        switch (outcome) {
            case "Interested":
                return `Lead Qualified`;
            case "Call Back Later":
            case "Busy/Waiting":
            case "No Response":
            case "Not Reachable":
                return `Call outcome: ${outcome}. Next best time to call: ${details.nextCallAt || "not set"}.`;
            case "Invalid Number":
                return `Corrected phone number to ${details.correctPhone || "N/A"}.`;
            case "Not Interested":
            case "Plan postponed":
            case "Already Purchased":
                return `${outcome}. Notes: ${details.notes || ""}.`;
            default:
                return `Call outcome recorded: ${outcome}.`;
        }
    })();

    // 2️⃣ append to activityLog[]
    lead.activityLog.push({
        type: "Call Outcome",
        actor,
        timestamp: new Date(),
        details: {
            outcome,
            ...details,
            description: humanDesc,
            // description: HUMAN_SENTENCE(outcome),
        }
    });


    // 3) determine next status and SLA/dueAt
    let nextStatus = OUTCOME_STATUS_MAP[outcome];
    let dueAt = null;
    switch (outcome) {
        case "Interested":
            dueAt = Date.now() + 8 * 3600 * 1000; // 8h to schedule measurement
            break;
        case "Call Back Later":
        case "Busy/Waiting":
        case "No Response":
        case "Not Reachable":
            // schedule retry based on provided nextCallAt or default 4h
            dueAt = details.nextCallAt
                ? new Date(details.nextCallAt)
                : new Date(Date.now() + 4 * 3600 * 1000);
            break;
        case "Invalid Number":
            // await data fix, no dueAt or maybe prompt within 12h
            dueAt = new Date(Date.now() + 12 * 3600 * 1000);
            break;
        case "Plan postponed":
            dueAt = details.nextCallAt
                ? new Date(details.nextCallAt)
                : new Date(Date.now() + 24 * 3600 * 1000);
            break;
        default:
            // disqualified / closed: no follow-up
            dueAt = null;
    }

    // 3) update stageMeta and status
    lead.status = nextStatus;
    lead.stageMeta.push({
        status: nextStatus,
        responsible: lead.assignee || actor,
        dueAt: dueAt || null,
        dueAt: dueAt ? new Date(dueAt) : null,
        updatedBy: userName
    });

    // for non-Interested, schedule follow-up
    if (outcome !== "Interested") {
        lead.status = nextStatus;
        lead.dueAt = new Date(details.nextCallAt || Date.now() + SLA[nextStatus] || 24 * 3600 * 1000);
        lead.notified = false;    // allow next reminder
    } else {
        lead.status = "LEAD_QUALIFIED";
    }

    // 5️⃣ log stage change
    lead.activityLog.push({
        type: `Stage → ${nextStatus}`,
        timestamp: new Date(),
        actor: "Admin",
        details: { dueAt: dueAt ? new Date(dueAt) : null }
    });

    await lead.save();
    res.json(lead);
};

export const scheduleMeasurement = async (req, res) => {
    const { id } = req.params;
    const { employeeId, datetime } = req.body;

    const lead = await DoorLead.findById(id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const technician = await User.findById(employeeId);
    console.log(technician);

    if (!technician || technician.role.includes("technician")) {
        return res.status(400).json({ error: "Invalid technician ID" });
    }

    const dueAt = new Date(datetime);
    const dateStr = format(dueAt, "dd MMM yyyy");     // e.g. 12 Aug 2025
    const timeStr = format(dueAt, "hh:mm a");         // e.g. 03:30 PM
    const year = new Date().getFullYear();

    // ✅ Update lead
    lead.status = "MEASURE_BOOKED";
    lead.assignee = employeeId;
    lead.stageMeta.push({
        status: "MEASURE_BOOKED",
        responsible: employeeId,
        uploadedBy: "admin",
        dueAt,
    });

    lead.activityLog.push({
        type: "Measurement Scheduled",
        timestamp: new Date(),
        actor: "Admin",
        details: { employeeId, datetime: dueAt },
    });

    await lead.save();

    const trackUrl = await ensureTrackingUrl(lead);

    // ——————————————————————————————————————————————
    // 1) EMAIL TO CUSTOMER
    // ——————————————————————————————————————————————
    const clientHtml = `
    <!doctype html>
    <html lang="en">
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#f2f4f6;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f6;padding:20px 0;">
        <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
            <!-- header -->
            <tr>
                <td align="center" style="background:#FF4A10;padding:24px;">
                <img src="https://yourcdn.com/logo-white.png"
                    width="120" alt="DoorCarpenter"
                    style="display:block;border:0;outline:none;text-decoration:none;">
                </td>
            </tr>
            <!-- content -->
            <tr>
                <td style="padding:30px 20px;">
                <h1 style="margin:0;font-size:22px;color:#333333;font-family:Arial,sans-serif;">
                    Hi ${lead.contact.name},
                </h1>
                <p style="margin:16px 0 24px;color:#555555;font-size:16px;line-height:1.5;font-family:Arial,sans-serif;">
                    Your free site measurement has been <strong>booked</strong>!
                </p>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:15px;color:#555555;">
                    <tr>
                    <td style="padding:8px;border-bottom:1px solid #ececec;font-weight:bold;">When:</td>
                    <td style="padding:8px;border-bottom:1px solid #ececec;">
                        ${dateStr} at ${timeStr} IST
                    </td>
                    </tr>
                    <tr>
                    <td style="padding:8px;border-bottom:1px solid #ececec;font-weight:bold;">Technician:</td>
                    <td style="padding:8px;border-bottom:1px solid #ececec;">
                        ${technician.name}
                    </td>
                    </tr>
                    <tr>
                    <td style="padding:8px;border-bottom:1px solid #ececec;font-weight:bold;">Contact:</td>
                    <td style="padding:8px;border-bottom:1px solid #ececec;">
                        ${technician.phone}
                    </td>
                    </tr>
                    <tr>
                    <td style="padding:8px;font-weight:bold;">Request ID:</td>
                    <td style="padding:8px;">${lead._id}</td>
                    </tr>
                </table>
                <p style="margin:24px 0;font-size:16px;color:#555555;line-height:1.5;font-family:Arial,sans-serif;">
                    Please ensure someone is available at the site during this time.  
                    If you need to reschedule, simply reply to this email or call us at <strong>+91-123-456-7890</strong>.
                </p>
                <p style="text-align:center;">
                    <a href="${trackUrl}"
                    style="display:inline-block;padding:12px 24px;background:#FF4A10;color:#ffffff;
                            text-decoration:none;font-size:16px;border-radius:4px;font-family:Arial,sans-serif;">
                    View Your Request
                    </a>
                </p>
                </td>
            </tr>
            <!-- footer -->
            <tr>
                <td align="center" style="background:#fafafa;padding:20px;font-family:Arial,sans-serif;
                                        font-size:12px;color:#888888;">
                © ${year} DoorCarpenter · Pune, India<br>
                <a href="mailto:support@doorcarpenter.in"
                    style="color:#888888;text-decoration:underline;">Contact Support</a>
                </td>
            </tr>
            </table>
        </td></tr>
        </table>
    </body>
    </html>`;

    await SendMail(
        lead.contact.email,
        "✅ Your Site Measurement Is Confirmed",
        clientHtml
    );

    // ——————————————————————————————————————————————
    // 2) EMAIL TO TECHNICIAN
    // ——————————————————————————————————————————————
    const techHtml = `
    <!doctype html>
    <html lang="en">
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#f2f4f6;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f6;padding:20px 0;">
        <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
            <!-- header -->
            <tr>
                <td align="center" style="background:#007ACC;padding:24px;">
                <img src="https://yourcdn.com/logo.png"
                    width="120" alt="DoorCarpenter"
                    style="display:block;border:0;outline:none;text-decoration:none;">
                </td>
            </tr>
            <!-- content -->
            <tr>
                <td style="padding:30px 20px;">
                <h1 style="margin:0;font-size:22px;color:#333333;font-family:Arial,sans-serif;">
                    Hello ${technician.name},
                </h1>
                <p style="margin:16px 0 24px;color:#555555;font-size:16px;line-height:1.5;font-family:Arial,sans-serif;">
                    You have a new site measurement assignment:
                </p>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:15px;color:#555555;">
                    <tr>
                    <td style="padding:8px;border-bottom:1px solid #ececec;font-weight:bold;">Client Name:</td>
                    <td style="padding:8px;border-bottom:1px solid #ececec;">${lead.contact.name}</td>
                    </tr>
                    <tr>
                    <td style="padding:8px;border-bottom:1px solid #ececec;font-weight:bold;">Client Phone:</td>
                    <td style="padding:8px;border-bottom:1px solid #ececec;">${lead.contact.phone}</td>
                    </tr>
                    <tr>
                    <td style="padding:8px;border-bottom:1px solid #ececec;font-weight:bold;">When:</td>
                    <td style="padding:8px;border-bottom:1px solid #ececec;">${dateStr} at ${timeStr} IST</td>
                    </tr>
                    <tr>
                    <td style="padding:8px;border-bottom:1px solid #ececec;font-weight:bold;">PIN:</td>
                    <td style="padding:8px;border-bottom:1px solid #ececec;">${lead.contact.pin}</td>
                    </tr>
                    <tr>
                    <td style="padding:8px;font-weight:bold;">Request ID:</td>
                    <td style="padding:8px;">${lead._id}</td>
                    </tr>
                </table>
                <p style="margin:24px 0;font-size:16px;color:#555555;line-height:1.5;font-family:Arial,sans-serif;">
                    Please arrive on time with all necessary tools, and upload your measurement report to the portal immediately after the visit.
                </p>
                </td>
            </tr>
            <!-- footer -->
            <tr>
                <td align="center" style="background:#fafafa;padding:20px;font-family:Arial,sans-serif;
                                        font-size:12px;color:#888888;">
                © ${year} DoorCarpenter · Pune, India
                </td>
            </tr>
            </table>
        </td></tr>
        </table>
    </body>
    </html>`;

    await SendMail(
        technician.email,
        "📐 New Measurement Scheduled",
        techHtml
    );

    // ✅ WhatsApp Template – using Interakt
    const interaktPayload = {
        countryCode: "+91",
        phoneNumber: lead.contact.phone,
        type: "Template",
        callbackData: lead._id.toString(),
        template: {
            name: "schedule_site_visit_meeting",
            languageCode: "en",
            bodyValues: [
                lead.contact.name,            // {{1}}
                dateStr,                      // {{2}}
                timeStr,                      // {{3}}
                technician.name,              // {{4}}
                technician.phone,             // {{5}}
                lead._id.toString()           // {{6}}
            ]
        }
    };

    try {
        await axios.post(
            "https://api.interakt.ai/v1/public/message/",
            interaktPayload,
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Basic ${process.env.INTERAKT_API_KEY}`
                }
            }
        );
    } catch (err) {
        console.error("WhatsApp send failed", err.response?.data || err.message);
    }

    // ✅ Optionally send same template to technician
    try {
        await axios.post(
            "https://api.interakt.ai/v1/public/message/",
            {
                countryCode: "+91",
                phoneNumber: technician.phone,
                type: "Template",
                callbackData: lead._id.toString(),
                template: {
                    name: "schedule_site_visit_meeting",
                    languageCode: "en",
                    bodyValues: [
                        technician.name,
                        dateStr,
                        timeStr,
                        lead.contact.name,
                        lead.contact.phone,
                        lead._id.toString()
                    ]
                }
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Basic ${process.env.INTERAKT_API_KEY}`
                }
            }
        );
    } catch (err) {
        console.error("Technician WhatsApp send failed", err.response?.data || err.message);
    }

    return res.json({ success: true, lead });
};

export const completeMeasurement = async (req, res) => {
    const { id } = req.params;
    const { measurements } = req.body;

    // measurements may arrive as JSON-string—parse if needed
    if (typeof measurements === "string") {
        try { measurements = JSON.parse(measurements); }
        catch { return res.status(400).json({ error: "Invalid measurements JSON" }); }
    }

    if (!Array.isArray(measurements) || !measurements.length) {
        return res.status(400).json({ error: "Provide at least one measurement." });
    }

    try {
        const lead = await DoorLead.findById(id);
        if (!lead) return res.status(404).json({ error: "Lead not found" });

        const technician = await User.findById(lead.assignee);
        if (!technician) return res.status(400).json({ error: "Invalid technician" });

        // ensure upload folder exists
        const uploadDir = path.join(__dirname, "..", "uploads", "frames");
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // decode & save each framePhoto
        measurements.forEach(m => {
            if (m.framePhoto && m.framePhoto.data) {
                const buffer = Buffer.from(m.framePhoto.data, "base64");
                const unique = `${lead._id}-${Date.now()}-${m.framePhoto.filename}`;
                const outPath = path.join(uploadDir, unique);
                fs.writeFileSync(outPath, buffer);
                m.framePhoto = unique;  // now just the filename
            }
        });

        const completedAt = new Date();
        // 1) update lead
        lead.status = "MEASURE_DONE";
        lead.measurements = measurements.map(m => ({ ...m, completedAt }));

        // 2) Log in stageMeta + activityLog
        lead.stageMeta.push({
            status: "MEASURE_DONE",
            responsible: technician._id,
            uploadedBy: technician._id,
            dueAt: completedAt
        });
        lead.activityLog.push({
            type: "Measurement Completed",
            timestamp: completedAt,
            actor: technician.name,
            details: { measurements }
        });

        await lead.save();

        const trackUrl = await ensureTrackingUrl(lead);

        // 3) Build table rows for email
        const rowsHtml = measurements.map(m => `
        <tr>
            <td>${m.label}</td>
            <td>${m.width} mm</td>
            <td>${m.height} mm</td>
            <td>${m.thickness} mm</td>
            <td>${m.quantity}</td>
            <td>${m.notes || "–"}</td>
        </tr>
        `).join("");

        const dateStr = format(completedAt, "dd MMM yyyy");
        const timeStr = format(completedAt, "hh:mm a");

        // 4) Customer email
        const customerHtml = `
        <!DOCTYPE html><html lang="en">
        <head><meta charset="UTF-8"><title>Measurement Completed</title>
        <style>
            body{margin:0;background:#f2f4f6;font-family:Arial,sans-serif}
            .container{max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05)}
            .header{background:#FF4A10;padding:24px;text-align:center;color:#fff;font-size:24px}
            .content{padding:32px 40px;color:#333}
            table{width:100%;border-collapse:collapse;margin:24px 0}
            th,td{padding:8px;border-bottom:1px solid #ececec;text-align:left}
            th{background:#fafafa;font-weight:600}
            .footer{background:#fafafa;padding:16px;text-align:center;font-size:12px;color:#888}
        </style>
        </head><body>
        <div class="container">
            <div class="header">DoorCarpenter</div>
            <div class="content">
            <p>Hi ${lead.contact.name},</p>
            <p>Your site measurement is complete (<strong>${dateStr} at ${timeStr} IST</strong>). Here are the final specs:</p>
            <table>
                <thead>
                <tr>
                    <th>Door</th><th>W</th><th>H</th><th>T</th><th>Qty</th><th>Notes</th>
                </tr>
                </thead>
                <tbody>
                ${rowsHtml}
                </tbody>
            </table>
            <p>Technician: ${technician.name} (📞 ${technician.phone})</p>
            <p>Next up: your quote will be ready within 48 hours. You can track your request <a href="${trackUrl}">here</a>.</p>
            </div>
            <div class="footer">
            © ${new Date().getFullYear()} DoorCarpenter · Pune, India<br>
            <a href="mailto:support@doorcarpenter.in">support@doorcarpenter.in</a>
            </div>
        </div>
        </body></html>`;

        await SendMail(
            lead.contact.email,
            "📐 Site Measurement Completed",
            customerHtml
        );

        // 5) Technician email
        const techHtml = `
        <!DOCTYPE html><html lang="en">
        <head><meta charset="UTF-8"><title>Measurement Logged</title>
        <style>
            body{margin:0;background:#f2f4f6;font-family:Arial,sans-serif}
            .container{max-width:600px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05)}
            .header{background:#007ACC;padding:24px;text-align:center;color:#fff;font-size:24px}
            .content{padding:32px 40px;color:#333}
            table{width:100%;border-collapse:collapse;margin:24px 0}
            th,td{padding:8px;border-bottom:1px solid #ececec;text-align:left}
            th{background:#fafafa;font-weight:600}
            .footer{background:#fafafa;padding:16px;text-align:center;font-size:12px;color:#888}
        </style>
        </head><body>
        <div class="container">
            <div class="header">DoorCarpenter</div>
            <div class="content">
            <p>Hello ${technician.name},</p>
            <p>You’ve logged these measurements at <strong>${dateStr} at ${timeStr}</strong>:</p>
            <table>
                <thead>
                <tr>
                    <th>Door</th><th>W</th><th>H</th><th>T</th><th>Qty</th><th>Notes</th>
                </tr>
                </thead>
                <tbody>
                ${rowsHtml}
                </tbody>
            </table>
            <p>Client: ${lead.contact.name} (📞 ${lead.contact.phone})</p>
            <p>Please upload any photos or sketches to the portal when you have a moment.</p>
            </div>
            <div class="footer">
            © ${new Date().getFullYear()} DoorCarpenter
            </div>
        </div>
        </body></html>`;

        await SendMail(
            technician.email,
            "✅ Measurement Logged",
            techHtml
        );

        // // 6) WhatsApp templates
        // const wa = (toName, toPhone, tpl) => ({
        // countryCode: "+91",
        // phoneNumber: toPhone,
        // type: "Template",
        // callbackData: lead._id.toString(),
        // template: {
        //     name: tpl,
        //     languageCode: "en",
        //     bodyValues: [
        //     toName,
        //     dateStr,
        //     timeStr,
        //     measurements.map(m => `${m.label}: ${m.width}×${m.height}×${m.thickness} (x${m.quantity})`).join("; "),
        //     technician.name,
        //     technician.phone,
        //     lead._id.toString()
        //     ]
        // }
        // });

        // await Promise.all([
        //     axios.post("https://api.interakt.ai/v1/public/message/", wa(lead.contact.name, lead.contact.phone, "measurement_completed_customer"), {
        //         headers: { Authorization: `Basic ${process.env.INTERAKT_API_KEY}` }
        //     }),
        //     axios.post("https://api.interakt.ai/v1/public/message/", wa(technician.name, technician.phone, "measurement_completed_technician"), {
        //         headers: { Authorization: `Basic ${process.env.INTERAKT_API_KEY}` }
        //     })
        // ]);

        return res.json({ success: true, lead });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ error: "measurement-error" });
    }
};

// POST /api/door-leads/:id/quotation
export const uploadQuotationAndPrepare = [
    uploadQuotation.single("file"),
    async (req, res) => {
        try {
            const lead = await DoorLead.findById(req.params.id);
            if (!lead) return res.status(404).json({ error: "not-found" });

            // 1) Save the quotation record
            const meta = JSON.parse(req.body.metadata || "{}");
            const newQuote = {
                quoteNo: meta.quoteMeta?.quoteNo
                    || path.basename(req.file.filename, ".pdf"),
                validUpto: meta.quoteMeta?.validUpto
                    && new Date(meta.quoteMeta.validUpto.split("/").reverse().join("-")),
                fileName: req.file.filename,
                metadata: meta
            };
            lead.quotations.push(newQuote);

            // 2) Move lead into QUOTE_DRAFTED
            lead.status = "QUOTE_DRAFTED";
            lead.stageMeta.push({
                status: "QUOTE_DRAFTED",
                responsible: lead.assignee,
                uploadedBy: req.user?.id || "system",
                dueAt: new Date(Date.now() + (SLA.QUOTE_DRAFTED || 0))
            });
            lead.activityLog.push({
                type: "Quote Prepared",
                actor: req.user?.id || "system",
                timestamp: new Date(),
                details: { quoteNo: newQuote.quoteNo }
            });

            await lead.save();

            res.json({
                success: true,
                quotation: newQuote,
                status: lead.status,
                stageMeta: lead.stageMeta,
                activityLog: lead.activityLog.slice(-1)[0]
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "quotation-failed" });
        }
    }
];

export const emailQuotation = [
    uploadQuotation.single("attachment"),
    async (req, res) => {
        try {
            const lead = await DoorLead.findById(req.params.id);
            if (!lead) return res.status(404).json({ error: "not-found" });

            // 1) Save quotation record in Mongo
            let meta = {};
            if (req.body.metadata) {
                try { meta = JSON.parse(req.body.metadata); }
                catch { /* ignore malformed JSON */ }
            }
            const newQuote = {
                quoteNo: meta.quoteMeta?.quoteNo || path.basename(req.file.filename, ".pdf"),
                validUpto: meta.quoteMeta?.validUpto && new Date(meta.quoteMeta.validUpto.split("/").reverse().join("-")),
                fileName: req.file.filename,
                metadata: meta
            };
            lead.quotations.push(newQuote);
            await lead.save();

            const trackUrl = await ensureTrackingUrl(lead);

            // 2) Build a branded HTML template
            const html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8" />
                    <title>Your DoorCarpenter Quotation</title>
                </head>
                <body style="margin:0;padding:0;background:#f2f4f6;font-family:Inter,Arial,sans-serif;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f6;padding:40px 0">
                    <tr>
                        <td align="center">
                        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05)">
                            <tr>
                                <td style="background:#FF4A10;padding:24px;text-align:center">
                                    <img src="https://yourcdn.com/logo-white.png" width="140" alt="DoorCarpenter" style="display:block;margin:0 auto" />
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:32px 40px;text-align:center">
                                    <h1 style="margin:0;font-size:28px;color:#333;font-weight:600">Your Quotation is Ready!</h1>
                                    <p style="margin:16px 0 0;color:#555;font-size:16px;line-height:1.6">
                                        Please find your quotation attached.<br>
                                        Quote No: <strong>${newQuote.quoteNo}</strong><br>
                                        Valid Upto: <strong>${newQuote.validUpto ? new Date(newQuote.validUpto).toLocaleDateString() : "N/A"}</strong>
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:0 40px 40px;text-align:center">
                                    <a 
                                    href="${trackUrl}"
                                    style="
                                        display:inline-block;
                                        background:#FF4A10;
                                        color:#fff;
                                        text-decoration:none;
                                        font-size:16px;
                                        font-weight:600;
                                        padding:14px 32px;
                                        border-radius:6px;
                                        box-shadow:0 2px 6px rgba(0,0,0,0.15);
                                    "
                                    >
                                    Track Your Request
                                    </a>
                                </td>
                            </tr>
                            <tr>
                                <td style="background:#fafafa;padding:24px 40px;text-align:center;font-size:13px;color:#888">
                                    © ${new Date().getFullYear()} DoorCarpenter · Pune, India<br>
                                    <a href="mailto:support@doorcarpenter.in" style="color:#888;text-decoration:underline">Contact Support</a>
                                </td>
                            </tr>
                        </table>
                        </td>
                    </tr>
                    </table>
                </body>
                </html>
            `;

            await SendMail(
                req.body.to,
                req.body.subject,
                html,
                [{
                    filename: "http://localhost:4000/uploads/quotations" + req.file.filename,
                    content: fs.readFileSync(req.file.path),
                    contentType: "application/pdf"
                }]
            );

            lead.status = "QUOTE_SENT";
            lead.stageMeta.push({
                status: "QUOTE_SENT",
                responsible: lead.assignee,
                uploadedBy: req.user && req.user.id ? req.user.id : undefined,
                dueAt: new Date(Date.now() + SLA.QUOTE_SENT)
            });

            lead.activityLog.push({
                type: "Quotation Sent",
                actor: req.user?.id || "system",
                timestamp: new Date(),
                details: {
                    quoteNo: newQuote.quoteNo,
                    fileName: newQuote.fileName,
                    validUpto: newQuote.validUpto
                }
            });
            await lead.save();

            return res.json({
                success: true,
                quotation: newQuote,
                lead,
            });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: "email-failed" });
        }
    }
];

export const sendPreparedQuotation = async (req, res) => {
    try {
        const lead = await DoorLead.findById(req.params.id);
        if (!lead) return res.status(404).json({ error: "not-found" });

        // pick the most recent quotation record
        const quote = lead.quotations[lead.quotations.length - 1];
        if (!quote) return res.status(400).json({ error: "no-quotation" });

        const trackUrl = await ensureTrackingUrl(lead);

        // build email HTML (you can customize this)
        const html = `
            <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8" />
                    <title>Your DoorCarpenter Quotation</title>
                </head>
                <body style="margin:0;padding:0;background:#f2f4f6;font-family:Inter,Arial,sans-serif;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f6;padding:40px 0">
                    <tr>
                        <td align="center">
                        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05)">
                            <tr>
                                <td style="background:#FF4A10;padding:24px;text-align:center">
                                    <img src="https://yourcdn.com/logo-white.png" width="140" alt="DoorCarpenter" style="display:block;margin:0 auto" />
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:32px 40px;text-align:center">
                                    <h1 style="margin:0;font-size:28px;color:#333;font-weight:600">Your Quotation is Ready!</h1>
                                    <p style="margin:16px 0 0;color:#555;font-size:16px;line-height:1.6">
                                        Please find your quotation attached.<br>
                                        Quote No: <strong>${quote.quoteNo}</strong><br>
                                        Valid Upto: <strong>${quote.validUpto ? new Date(quote.validUpto).toLocaleDateString() : "N/A"}</strong>
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:0 40px 40px;text-align:center">
                                    <a 
                                    href="${trackUrl}"
                                    style="
                                        display:inline-block;
                                        background:#FF4A10;
                                        color:#fff;
                                        text-decoration:none;
                                        font-size:16px;
                                        font-weight:600;
                                        padding:14px 32px;
                                        border-radius:6px;
                                        box-shadow:0 2px 6px rgba(0,0,0,0.15);
                                    "
                                    >
                                    Track Your Request
                                    </a>
                                </td>
                            </tr>
                            <tr>
                                <td style="background:#fafafa;padding:24px 40px;text-align:center;font-size:13px;color:#888">
                                    © ${new Date().getFullYear()} DoorCarpenter · Pune, India<br>
                                    <a href="mailto:support@doorcarpenter.in" style="color:#888;text-decoration:underline">Contact Support</a>
                                </td>
                            </tr>
                        </table>
                        </td>
                    </tr>
                    </table>
                </body>
            </html>
        `;

        // filesystem path to the PDF
        const pdfPath = path.join(
            __dirname,
            "..",
            "uploads",
            "quotations",
            quote.fileName
        );

        // send mail with attachment
        await SendMail(
            lead.contact.email,
            `Your quotation ${quote.quoteNo}`,
            html,
            [
                {
                    filename: 'http://localhost:4000/uploads/quotations/' + quote.fileName,
                    content: fs.readFileSync(pdfPath),
                    contentType: "application/pdf"
                }
            ]
        );

        // 1) Move lead into QUOTE_SENT
        lead.status = "QUOTE_SENT";
        lead.stageMeta.push({
            status: "QUOTE_SENT",
            responsible: req.user?.id || "system",
            uploadedBy: req.user?.id || "system",
            dueAt: new Date(Date.now() + (SLA.QUOTE_SENT || 0))
        });

        // 2) Log the activity
        lead.activityLog.push({
            type: "Quote Shared",
            actor: req.user?.id || "system",
            timestamp: new Date(),
            details: { quoteNo: quote.quoteNo }
        });

        await lead.save();

        res.json({
            success: true,
            status: lead.status,
            activityLog: lead.activityLog.slice(-1)[0]
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "send-quotation-failed" });
    }
};

export const sendOrderConfirmation = async (req, res) => {
    try {
        const lead = await DoorLead.findById(req.params.id);
        if (!lead) return res.status(404).json({ error: "not-found" });

        // 1) Update status & stageMeta + activityLog
        // lead.status = "ORDER_CONFIRMED";
        setStatusAtLeast(lead, "ORDER_CONFIRMED");
        pushStageForward(lead, "ORDER_CONFIRMED", {
            status: "ORDER_CONFIRMED",
            responsible: lead.assignee || "System",
            uploadedBy: req.user?.userId || "System",
            dueAt: new Date()
        });
        // lead.stageMeta.push({
        //     status:      "ORDER_CONFIRMED",
        //     responsible: lead.assignee || "System",
        //     uploadedBy:  req.user?.userId || "System",
        //     dueAt:       new Date()
        // });
        lead.activityLog.push({
            type: "Order Confirmed",
            timestamp: new Date(),
            actor: req.user?.name || "System",
            details: {}
        });
        await lead.save();

        const trackUrl = await ensureTrackingUrl(lead);

        // 2) Fetch latest quotation
        const latest = lead.quotations.slice(-1)[0];
        if (!latest) throw new Error("No quotation to attach");

        const filePath = path.join(__dirname, "..", "uploads", "quotations", latest.fileName);

        // 3) Build HTML email
        const html = `
        <!doctype html>
        <html>
        <head><meta charset="utf-8"><title>Order Confirmed</title></head>
        <body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f2f4f6;">
            <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:40px 0">
            <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;">
                <tr>
                <td style="background:#FF4A10;padding:24px;text-align:center">
                    <img src="https://yourcdn.com/logo-white.png" width="140" alt="DoorCarpenter" />
                </td>
                </tr>
                <tr>
                <td style="padding:32px 40px;">
                    <h1 style="margin:0;font-size:24px;color:#333;">Hi ${lead.contact.name},</h1>
                    <p style="font-size:16px;color:#555;line-height:1.5;">
                    We’re delighted to confirm your order <strong>${lead._id}</strong> with DoorCarpenter.
                    Attached is your final quotation for <strong>₹${latest.metadata.rows.reduce((sum, r) => sum + (r.discRate || r.rate) * r.qty, 0)}</strong>.
                    </p>
                    <p style="font-size:16px;color:#555;line-height:1.5;">
                    <strong>Next Steps:</strong><br/>
                    • Our production team will start manufacturing immediately.<br/>
                    • You’ll receive shipment details shortly.<br/>
                    • For any questions, reply to this email or call us at <strong>+91-8983436996</strong>.
                    </p>
                    <p style="text-align:center;margin:32px 0;">
                    <a href="${trackUrl}"
                        style="background:#FF4A10;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-size:16px;">
                        View Your Order
                    </a>
                    </p>
                </td>
                </tr>
                <tr>
                <td style="background:#fafafa;padding:24px;text-align:center;font-size:12px;color:#888;">
                    © ${new Date().getFullYear()} DoorCarpenter · Pune, India
                </td>
                </tr>
            </table>
            </td></tr>
            </table>
        </body>
        </html>
        `;

        // 4) Send with attachment
        await SendMail(
            lead.contact.email,
            `Your DoorCarpenter Order #${lead._id} Is Confirmed`,
            html,
            [{
                filename: "http://localhost:4000/api/uploads/quotations/" + latest.fileName,
                path: filePath,
                contentType: "application/pdf"
            }]
        );

        res.json({ status: lead.status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

/** Build a “Proposal & Agreement” PDF */
export async function createProposalPdf(lead, filePath) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // --- 1) compute amounts ---
        const latestQuote = lead.quotations.slice(-1)[0];
        const total = latestQuote.metadata.rows.reduce((sum, r) => {
            const price = (r.discRate > 0 ? r.discRate : Number(r.rate));
            return sum + price * Number(r.qty);
        }, 0);
        const transportCost = 10000;
        const leadLiftCost = 1200;
        const gstAmount = Number(((total + transportCost + leadLiftCost) * 0.18).toFixed(2));
        const grandTotal = total + transportCost + leadLiftCost + gstAmount;
        const halfGrandTotal = Number((grandTotal / 2).toFixed(2));

        // --- Cover Page ---
        doc
            .fontSize(20).text("Proposal & Service Agreement", { align: "center" })
            .moveDown()
            .fontSize(12).text(`Date: ${new Date().toLocaleDateString()}`, { align: "right" })
            .moveDown()
            .text(`To: Mr. ${lead.contact.name}   |   Company: ${lead.companyName}`)
            .moveDown()
            .text("Thank you for incorporating your company with us. Below is our AMC proposal, followed by the formal agreement.")
        // .addPage();

        // --- Cost Breakdown ---
        doc
            .fontSize(14).font("Helvetica-Bold").text("COST BREAKDOWN", { underline: true })
            .moveDown(0.5).font("Helvetica");
        [
            ["Service Subtotal", `₹${total.toLocaleString()}`],
            ["Transport Cost", `₹${transportCost.toLocaleString()}`],
            ["Lead & Lift", `₹${leadLiftCost.toLocaleString()}`],
            ["GST (18%)", `₹${gstAmount.toLocaleString()}`],
            ["Grand Total", `₹${grandTotal.toLocaleString()}`]
        ].forEach(([label, amt]) => {
            doc.text(label + ":", { continued: true }).text(amt, { align: "right" }).moveDown(0.3);
        });
        // doc.addPage();

        // --- 3 SIMPLE STEPS & ATTACHMENTS ---
        doc
            .fontSize(14).font("Helvetica-Bold").text("3 SIMPLE STEPS & ATTACHMENTS", { underline: true })
            .moveDown(0.5).font("Helvetica");
        [
            ["STEP 1", "Review Compliance Calendar (Attachment A)"],
            ["STEP 2", "Pay 50% upfront (Attachment B: AMC Quote)"],
            ["STEP 3", "Receive FREE ADD-ONS & balance on completion (Attachment C: Client Reviews)"]
        ].forEach(([step, desc]) => {
            doc.font("Helvetica-Bold").text(step + ":", { continued: true })
                .font("Helvetica").text(" " + desc)
                .moveDown(0.5);
        });
        // doc.moveDown();

        doc.fontSize(12).font("Helvetica-Bold").text("Attachments:")
            .moveDown(0.5).font("Helvetica");
        ["A) Compliance Calendar & Penalty",
            "B) AMC Quote – Doors & Windows",
            "C) Client Reviews & Profile",
            "D) This Agreement"
        ].forEach(att => {
            doc.circle(doc.x + 5, doc.y + 5, 3).fill("#000").fillColor("#000")
                .text(" " + att, doc.x + 12, doc.y - 3)
                .moveDown(0.5);
        });

        // doc.addPage();
        // --- AGREEMENT SECTION ---
        doc.fontSize(16).font("Helvetica-Bold").text("AMC SERVICE AGREEMENT", { align: "center" }).moveDown();
        const clauses = [
            {
                title: "1. Definitions",
                text: "“We/Us” means DoorCarpenter; “You” means the Client."
            },
            {
                title: "2. Scope of Work",
                text: "We shall provide annual maintenance for doors & windows plus ROC, Accounting & Tax filings per Attachment B."
            },
            {
                title: "3. Fees & Payment",
                text:
                    `Service Subtotal: ₹${total.toLocaleString()}\n` +
                    `Transport Cost:   ₹${transportCost.toLocaleString()}\n` +
                    `Lead & Lift:      ₹${leadLiftCost.toLocaleString()}\n` +
                    `GST (18%):        ₹${gstAmount}\n\n` +
                    `Grand Total:      ₹${grandTotal.toLocaleString()}\n\n` +
                    `• 50% (₹${halfGrandTotal.toLocaleString()}) due upfront on signing.\n` +
                    `• 50% (₹${halfGrandTotal.toLocaleString()}) due upon completion.`
            },
            {
                title: "4. Term & Termination",
                text: "Commences on payment of the upfront 50% and continues for 12 months. Either party may terminate with 30 days’ written notice."
            },
            {
                title: "5. Confidentiality",
                text: "Both parties agree to keep each other’s data confidential."
            },
            {
                title: "6. Liability",
                text: "Our liability is limited to the fees paid under this Agreement."
            },
            {
                title: "7. Governing Law",
                text: "This Agreement is governed by the laws of India, Pune jurisdiction."
            }
        ];
        clauses.forEach(c => {
            doc.fontSize(12).font("Helvetica-Bold").text(c.title).moveDown(0.25)
                .font("Helvetica").text(c.text, { indent: 20, align: "justify", lineGap: 4 }).moveDown(0.75);
        });

        // --- Signatures ---
        const y = doc.y + 40;
        doc.text("For DoorCarpenter:", 40, y).text("__________________", 300, y)
            .moveDown().text("Name: ____________________", 40).text("Date: ____________", 300)
            .moveDown(2).text(`Client: ${lead.contact.name}`, 40).text("__________________", 300)
            .moveDown().text("Date: ____________", 40);

        doc.end();
        stream.on("finish", resolve);
        stream.on("error", reject);
    });
}

export const sendProposal = async (req, res) => {
    // ensure the upload directory exists
    const PROPOSAL_DIR = path.join(__dirname, "..", "uploads", "proposals");
    if (!fs.existsSync(PROPOSAL_DIR)) fs.mkdirSync(PROPOSAL_DIR, { recursive: true });

    try {
        const lead = await DoorLead.findById(req.params.id);
        if (!lead) return res.status(404).json({ error: "not-found" });

        // recompute amounts here too
        const latestQuote = lead.quotations.slice(-1)[0];
        const total = latestQuote.metadata.rows.reduce((s, r) => s + (r.discRate > 0 ? r.discRate : Number(r.rate)) * r.qty, 0);
        const transportCost = 10000;
        const leadLiftCost = 1200;
        const gstAmount = Number(((total + transportCost + leadLiftCost) * 0.18).toFixed(2));
        const grandTotal = total + transportCost + leadLiftCost + gstAmount;
        const halfGrand = Number((grandTotal / 2).toFixed(2));
        const advance = Math.round(grandTotal / 2);

        // 1) Generate PDF
        const fileName = `proposal-${lead._id}-${Date.now()}.pdf`;
        const filePath = path.join(PROPOSAL_DIR, fileName);
        await createProposalPdf(lead, filePath);

        // 2) Send email with both attachments
        const quotationPDFPath = path.join(__dirname, "..", "uploads", "quotations", latestQuote.fileName);

        const FRONTEND_URL = "http://localhost:5173"
        const paymentReference = buildRefId(lead._id);
        // const paymentReference = `${lead._id}-${Date.now()}-${Math.random().toString(5)}`;

        // 2) Create a Razorpay Payment Link
        const paymentLink = await razorpay.paymentLink.create({
            amount: advance * 100,         // in paise
            currency: "INR",
            accept_partial: false,
            reference_id: paymentReference,
            description: `50% advance for Proposal`,
            customer: {
                name: lead.contact.name,
                email: lead.contact.email,
                contact: lead.contact.phone
            },
            // notify: {
            //     sms:   true,
            //     email: true
            // },
            reminder_enable: true,
            callback_url: `${FRONTEND_URL}/payment-status`,
            callback_method: "get"
        });

        // 2) Send email with exactly the layout you showed
        const html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
            <meta charset="UTF-8">
            <title>Your DoorCarpenter AMC Proposal & Service Agreement</title>
            </head>
            <body>
            <table>
                <tr><td >
                <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">

                    <!-- GREETING -->
                    <tr>
                    <td style="color:#333333;">
                        <p style="margin:0 0 16px;">
                        Dear Mr. ${lead.contact.name},
                        </p>
                        <p style="margin:0 0 16px;">
                        Congratulations on your successful incorporation of <strong>Door Cartenpter</strong>.  
                        To kick off your post-incorporation AMC for doors & windows, please follow the 3 SIMPLE STEPS below.
                        </p>
                    </td>
                    </tr>
                    
                    <!-- 3 STEPS TABLE -->
                    <tr>
                    <td style="">
                        <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #ccc;">
                        <tr style="background:#f5f5f5;">
                            <th style="width:80px;text-align:left;border-bottom:1px solid #ccc;">STEP 1:</th>
                            <td style="border-bottom:1px solid #ccc;">
                            Review the attached Compliance Calendar to know scope, timelines & penalties.
                            </td>
                            <td style="width:150px;background:#f0f0f0;border-bottom:1px solid #ccc;">
                            <strong>A) Compliance Calendar & Penalty</strong>
                            </td>
                        </tr>
                        <tr>
                            <th style="text-align:left;border-bottom:1px solid #ccc;">STEP 2:</th>
                            <td style="border-bottom:1px solid #ccc;">
                            Make payment of <strong>₹${grandTotal}</strong>
                            </td>
                            <td style="background:#f0f0f0;border-bottom:1px solid #ccc;">
                            <strong>B) AMC Quote – Doors & Windows</strong>
                            </td>
                        </tr>
                        <tr>
                            <th style="text-align:left;">STEP 3:</th>
                            <td>
                            ✓ You’ll receive FREE add-ons<br>
                            ✓ We handle ROC, Tax & filings<br>
                            ✓ You focus on selling doors!
                            </td>
                            <td style="background:#f0f0f0;">
                            <strong>C) Client Reviews & Profile</strong>
                            </td>
                        </tr>
                        </table>
                    </td>
                    </tr>
                    
                    <!-- YOUR DOOR DETAILS -->
                    <tr>
                    <td style="color:#333;">
                        <h4 style="margin:0 0 8px;color:#111;">Your Door Specifications:</h4>
                        <ul style="margin:0 0 0 20px;padding:0;color:#555;">
                        <li>Category: ${lead?.category}</li>
                        <li>Core Material: ${lead?.core}</li>
                        <li>Finish: ${lead?.finish?.label}</li>
                        <li>Hardware: ${lead?.hardware?.label}</li>
                        <li>Quantity: ${lead?.size?.quantity}</li>
                        <li>Dimensions: ${lead?.size?.w}×${lead?.size?.h}×${lead?.size?.t} mm</li>
                        </ul>
                    </td>
                    </tr>
                    
                    <!-- NEXT STEPS CTA -->
                    <tr>
                    <td style="color:#333;">
                        <p style="margin:0 0 16px;"><strong>NEXT STEPS:</strong> Click any button below to complete payment.</p>
                        <table width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                                <!-- PAY 50% of ₹10,999 = ₹5,499.50 (example) -->
                                <td align="center">
                                <a href="${paymentLink.short_url}" style="display:inline-block;background:#1a4df6;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:4px;width:150px;text-align:center;">
                                    PAY ₹${halfGrand.toLocaleString()}
                                </a>
                                <p style="margin:8px 0 0;font-size:12px;color:#555;">50% of ₹${grandTotal.toLocaleString()}</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                    </tr>
                    
                    <!-- FREE ADD-ONS -->
                    <tr>
                    <td style="">
                        <table width="100%" cellpadding="8" cellspacing="0" style="border:1px solid #ccc;">
                        <tr style="background:#f0f0f0;">
                            <th style="text-align:left;">PAY NOW and <strong>GET FREE ADD-ONS</strong>:</th>
                        </tr>
                        <tr>
                            <td>
                            1) Zero-balance Company Bank Account<br>
                            2) Share Certificate Booklet<br>
                            3) DoorCarpenter Cloud Software License<br>
                            4) Online Accounting Dashboard
                            </td>
                        </tr>
                        </table>
                    </td>
                    </tr>
                    
                    <!-- BANK DETAILS -->
                    <tr>
                    <td style="color:#333;">
                        <p style="margin:0 0 8px;"><strong>You may also pay via bank transfer:</strong></p>
                        <table cellpadding="6" cellspacing="0" style="border:1px solid #ccc;width:100%;font-size:13px;color:#555;">
                        <tr style="background:#f5f5f5;"><th colspan="2">ICICI BANK</th></tr>
                        <tr><td width="150">Account Name:</td><td>DoorCarpenter Technologies Pvt. Ltd.</td></tr>
                        <tr><td>Account No.:</td><td>003905016581</td></tr>
                        <tr><td>IFSC:</td><td>ICIC0000039</td></tr>
                        <tr><td>Branch:</td><td>Pune – Shivajinagar</td></tr>
                        </table>
                        <p style="margin:16px 0 0;font-size:13px;color:#555;">
                        After payment, please email your receipt to <a href="mailto:nitin.suryawanshi@doorcarpenter.in">nitin.suryawanshi@doorcarpenter.in</a>.
                        </p>
                    </td>
                    </tr>
                    
                    <!-- FOOTER -->
                    <tr>
                    <td style="background:#fafafa;font-size:12px;color:#888888;">
                        Warm regards,<br>
                        <strong>Nitin Suryawanshi</strong> – Business Consultant, BSS Operations<br>
                        Mob: +91 8983436996  |  <a href="https://doorcarpenter.in/" style="color:#888;text-decoration:underline;">doorcarpenter.in</a><br>
                        © ${new Date().getFullYear()} DoorCarpenter · Pune, India
                    </td>
                    </tr>
                    
                </table>
                </td></tr>
            </table>
            </body>
            </html>
        `;

        await SendMail(
            lead.contact.email,
            `Proposal & Service Agreement for ${lead.companyName}`,
            html,
            [
                // { filename: fileName,                path: filePath,            contentType: "application/pdf" },
                { filename: 'http://localhost:4000/uploads/quotations/' + latestQuote.fileName, path: quotationPDFPath, contentType: "application/pdf" },
                {
                    filename: fileName,
                    path: filePath,
                    contentType: "application/pdf"
                }
            ]
        );

        lead.payments = lead.payments || []; // in case old docs don't have it

        lead.payments.push({
            referenceId: paymentReference,
            paymentLinkId: paymentLink.id,
            shortUrl: paymentLink.short_url,
            description: paymentLink.description,
            status: paymentLink.status,
            amount: paymentLink.amount,
            currency: paymentLink.currency,
            customer: {
                name: lead.contact.name,
                email: lead.contact.email,
                contact: lead.contact.phone
            },
            createdAt: new Date(paymentLink.created_at * 1000),
            expiresAt: paymentLink.expire_by ? new Date(paymentLink.expire_by * 1000) : null,
            notes: paymentLink.notes,
            // raw: { paymentLink }
            raw: { paymentLink, kind: "ADVANCE" }
        });

        // 3) Move into “Proposal Sent”
        lead.status = "PROPOSAL_SENT";
        lead.stageMeta.push({
            status: "PROPOSAL_SENT",
            responsible: req.user?.id || "system",
            uploadedBy: req.user?.id || "system",
            dueAt: new Date()
        });
        lead.activityLog.push({
            type: "Payment Link Created",
            actor: "System",
            timestamp: new Date(),
            details: {
                referenceId: paymentReference,
                paymentLinkId: paymentLink.id,
                shortUrl: paymentLink.short_url,
                amount: paymentLink.amount
            }
        });
        await lead.save();

        res.json({ success: true, status: lead.status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "proposal-failed" });
    }
};

// export const paymentCallback = async (req, res) => {
//     try {
//         const p = req.query;

//         const payment_link_id = p.razorpay_payment_link_id || p.payment_link_id || p.plink || "";
//         const reference_id    = p.razorpay_payment_link_reference_id || p.reference_id || p.ref || "";
//         const payment_id      = p.razorpay_payment_id || p.payment_id || "";
//         const rawStatus       = String(p.razorpay_payment_link_status || p.payment_link_status || "").toLowerCase();

//         if (!reference_id) return res.status(400).send("Missing reference_id");

//         const lead = await DoorLead.findOne({ "payments.referenceId": reference_id });
//         if (!lead) return res.status(404).send("Lead not found for reference");

//         // Best-effort fetch
//         let rzpLink = null;
//         try { if (payment_link_id) rzpLink = await razorpay.paymentLink.fetch(payment_link_id); } catch {}

//         const status = String(rzpLink?.status || rawStatus || "unknown").toLowerCase();

//         // Update the payment record, don’t touch stages yet
//         const payIdx = (lead.payments || []).findIndex(
//         x => x.referenceId === reference_id || (payment_link_id && x.paymentLinkId === payment_link_id)
//         );
//         if (payIdx !== -1) {
//         const prev = lead.payments[payIdx] || {};
//         lead.payments[payIdx] = {
//             ...prev,
//             status,
//             paymentId: payment_id || prev.paymentId,
//             paidAt: status === "paid" ? (prev.paidAt || new Date()) : prev.paidAt,
//             raw: { ...(prev.raw || {}), callbackQuery: req.query, rzpLink }
//         };
//         }

//         // Early save of payment update
//         await lead.save();

//         if (status === "paid") {
//         // Decide kind safely (explicit > description > unknown)
//         const rec  = lead.payments?.[payIdx];
//         const kindExplicit = String(rec?.raw?.kind || "").toUpperCase();
//         const desc = String(rec?.description || rzpLink?.description || "");
//         const kindFromText = /balance|final|remaining|full/i.test(desc) ? "BALANCE"
//                             : /advance|upfront|deposit/i.test(desc)     ? "ADVANCE"
//                             : "UNKNOWN";
//         const kind = kindExplicit || kindFromText;

//         // Never allow regression: ADVANCE can only promote up to ORDER_CONFIRMED
//         if (kind === "ADVANCE") {
//             const changed = setStatusAtLeast(lead, "ORDER_CONFIRMED");
//             if (changed) {
//             pushStageForward(lead, "ORDER_CONFIRMED", {
//                 responsible: lead.assignee || "System",
//                 uploadedBy:  "Razorpay",
//                 dueAt:       new Date()
//             });
//             }
//         }

//         if (kind === "BALANCE" || kind === "FULL") {
//             const { duePaise } = computeTotalsINRPaise(lead);
//             // Prefer the user's chosen date if we stored it during scheduling request
//             const desired = lead.installation?.pending?.desiredAt
//             ? new Date(lead.installation.pending.desiredAt)
//             : null;
//             if (duePaise === 0) {
//             await autoScheduleInstallation(lead, { actor: "Razorpay", when: desired || undefined });
//             if (lead.installation?.pending) {
//                 delete lead.installation.pending;
//             }
//             }
//         }

//         await lead.save();
//         }

//         const dest = `${process.env.FRONTEND_URL}/payment-status?status=${encodeURIComponent(status)}&ref=${encodeURIComponent(reference_id)}`;
//         return res.redirect(dest);
//     } catch (err) {
//         console.error("Callback error:", err);
//         return res.status(500).send("Internal server error");
//     }
// };

function nextVersion(lead) {
    const revs = lead.design?.revisions || [];
    return (revs.at(-1)?.version || 0) + 1;
}
function newToken() {
    return crypto.randomBytes(16).toString("hex");
}

// POST /api/door-leads/:id/design/upload
const designStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, "..", "uploads", "designs", String(req.params.id));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`)
});
const uploadDesignFiles = multer({
    storage: designStorage,
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB per file
});
export const uploadDesign = [
    uploadDesignFiles.array("files", 10),
    async (req, res) => {
        const lead = await DoorLead.findById(req.params.id);
        if (!lead) return res.status(404).json({ error: "not-found" });

        lead.design = lead.design || { revisions: [], currentVersion: 0 };
        const version = (lead.design.currentVersion || 0) + 1;

        const base = process.env.BACKEND_PUBLIC_URL || "http://localhost:4000";
        const files = (req.files || []).map(f => ({
            filename: f.filename,
            url: `${base}/uploads/designs/${lead._id}/${f.filename}`,
            mimetype: f.mimetype,
            size: f.size
        }));

        const notes = req.body.notes || "";

        lead.design.revisions.push({
            version,
            notes,
            files,
            createdBy: req.user?.id,
            createdAt: new Date(),
            approval: { status: "draft" }  // <- important: not yet sent for client
        });
        lead.design.currentVersion = version;

        lead.activityLog.push({
            type: "Design Uploaded",
            actor: req.user?.name || "System",
            timestamp: new Date(),
            details: { version, files: files.map(x => x.filename) }
        });

        // Stay in ORDER_CONFIRMED until approval happens
        await lead.save();
        res.json({ ok: true, lead });
    }
];

// POST /api/door-leads/:id/design/request-approval
export const requestDesignApproval = async (req, res) => {
    try {
        const { id } = req.params;
        const lead = await DoorLead.findById(id);
        if (!lead) return res.status(404).json({ ok: false, error: "not-found" });

        const revs = lead.design?.revisions || [];
        const latest = revs.at(-1);
        if (!latest || !latest.files?.length) {
            return res.status(400).json({ ok: false, error: "no-files", message: "Upload design files first." });
        }

        let rev = latest;
        // If latest already pending/approved/changes, clone it as a new version
        if (latest.approval && latest.approval.status !== "draft") {
            rev = {
                version: nextVersion(lead),
                files: [...latest.files],     // reuse uploaded files
                notesFromOps: req.body?.notesFromOps || "",
                createdAt: new Date(),
                token: newToken(),
                approval: { status: "pending" }
            };
            lead.design.revisions.push(rev);
        } else {
            // turn draft into pending
            latest.token = newToken();
            latest.createdAt = new Date();
            latest.approval = { status: "pending" };
        }

        await lead.save();

        // email link
        const FE = process.env.FRONTEND_URL || "http://localhost:5173";
        const link = `${FE}/approve-design/${rev.token}`;
        // await SendMail(
        //     lead.contact.email,
        //     `Please review design v${rev.version}`,
        //     `<p>Hi ${lead.contact.name},</p>
        //     <p>Your design (v${rev.version}) is ready for review.</p>
        //     <p><a href="${link}">Open Design Review</a></p>`
        // );
        const html = renderDesignReviewEmail({
            lead, version: (rev.version || latest.version),
            link, fileCount: (rev.files || latest.files || []).length
        });
        await SendMail(lead.contact.email, `Please review your design v${rev.version || latest.version}`, html);

        res.json({ ok: true, version: (rev.version || latest.version), token: (rev.token || latest.token), link });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: "send-failed" });
    }
};

async function ensureDesignToken(lead) {
    lead.design = lead.design || {};
    lead.design.approval = lead.design.approval || {};
    if (!lead.design.approval.token || lead.design.approval.revoked) {
        lead.design.approval = {
            token: crypto.randomBytes(16).toString("hex"),
            status: "pending",               // "pending" | "approved" | "changes"
            createdAt: new Date(),
            revoked: false
        };
        await lead.save();
    }
    return lead.design.approval.token;
}

/**
 * GET /api/design/review/:token
 * Public – returns the design files & metadata for client viewing
 */
export const getDesignReview = async (req, res) => {
    try {
        const { token } = req.params;
        const lead = await DoorLead.findOne({ "design.revisions.token": token });
        if (!lead) return res.status(404).json({ ok: false, error: "invalid-token" });

        const revs = lead.design?.revisions || [];
        const rev = revs.find(r => r.token === token);
        if (!rev) return res.status(404).json({ ok: false, error: "invalid-token" });

        const latest = revs.at(-1);
        const isLatest = String(latest._id) === String(rev._id);

        res.json({
            ok: true,
            lead: {
                id: lead._id,
                name: lead.contact?.name,
            },
            revision: {
                version: rev.version,
                token: rev.token,
                status: rev.approval?.status || "pending",
                decidedAt: rev.approval?.decidedAt || null,
                files: (rev.files || []).map(f => ({ url: f.url, filename: f.filename, mime: f.mime || null })),
            },
            isLatest,
            latest: {
                version: latest.version,
                token: latest.token
            },
            history: revs.map(r => ({
                version: r.version,
                status: r.approval?.status || "pending",
                createdAt: r.createdAt,
                decidedAt: r.approval?.decidedAt || null,
                isThis: String(r._id) === String(rev._id)
            }))
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: "server-error" });
    }
};

export const decideDesign = async (req, res) => {
    try {
        const { token, decision, notes } = req.body || {};
        if (!token || !["approve", "changes"].includes(decision)) {
            return res.status(400).json({ ok: false, error: "bad-request" });
        }

        const lead = await DoorLead.findOne({ "design.revisions.token": token });
        if (!lead) return res.status(404).json({ ok: false, error: "invalid-token" });

        const revs = lead.design?.revisions || [];
        const rev = revs.find(r => r.token === token);
        const latest = revs.at(-1);

        const isLatest = String(latest._id) === String(rev._id);

        // block approving an older revision
        if (decision === "approve" && !isLatest) {
            return res.status(409).json({
                ok: false,
                error: "stale-revision",
                message: `A newer revision (v${latest.version}) exists. Please review the latest.`
            });
        }

        // idempotency
        if (rev.approval?.status === "approved" && decision === "approve") {
            return res.json({ ok: true, already: true });
        }
        if (rev.approval?.status === "changes" && decision === "changes" && (notes ?? "") === (rev.approval?.notes ?? ""))
            return res.json({ ok: true, already: true });

        // save decision on that revision
        rev.approval = {
            status: decision === "approve" ? "approved" : "changes",
            notes: decision === "changes" ? (notes || "") : undefined,
            decidedAt: new Date()
        };

        lead.activityLog.push({
            type: decision === "approve" ? "Design Approved" : "Design Changes Requested",
            actor: lead.contact?.name || "Client",
            timestamp: new Date(),
            details: { version: rev.version, notes: notes || "" }
        });

        if (decision === "approve") {
            const trackUrl = await ensureTrackingUrl(lead);
            const html = renderDesignApprovedEmail({
                lead, version: rev.version, decidedAt: rev.approval.decidedAt, trackUrl
            });
            await SendMail(lead.contact.email, `Design v${rev.version} Approved — Next: Production`, html);

            // Move to Design Freeze
            lead.status = "PROD_READY";
            lead.stageMeta.push({
                status: "PROD_READY",
                responsible: lead.assignee || "System",
                uploadedBy: "Client",
                dueAt: new Date()
            });
            // record frozen revision
            lead.design.frozen = { revisionId: rev._id, version: rev.version, at: new Date() };
        } else {
            // remain in ORDER_CONFIRMED, just log
            lead.stageMeta.push({
                status: "ORDER_CONFIRMED",
                responsible: lead.assignee || "System",
                uploadedBy: "Client",
                dueAt: new Date()
            });
        }

        await lead.save();
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: "server-error" });
    }
};

// GET /api/door-leads/:id/design/revisions
export const listRevisions = async (req, res) => {
    try {
        const lead = await DoorLead.findById(req.params.id);
        if (!lead) return res.status(404).json({ ok: false, error: "not-found" });
        const revs = lead.design?.revisions || [];
        res.json({
            ok: true,
            frozen: lead.design?.frozen || null,
            revisions: revs.map(r => ({
                version: r.version,
                token: r.token,
                status: r.approval?.status || "pending",
                createdAt: r.createdAt,
                decidedAt: r.approval?.decidedAt || null,
                files: (r.files || []).map(f => ({ url: f.url, filename: f.filename }))
            }))
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: "server-error" });
    }
};

// POST /api/door-leads/:id/production/start
export const startProduction = async (req, res) => {
    const lead = await DoorLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: "not-found" });

    // sanity: only allow if design is frozen
    if (lead.status !== "PROD_READY") {
        return res.status(400).json({ error: "not-in-design-freeze" });
    }

    const trackUrl = await ensureTrackingUrl(lead);
    const eta = new Date(Date.now() + (SLA.PROD_RUNNING || 30 * 24 * 3600 * 1000));
    const html = renderProductionStartedEmail({ lead, trackUrl, etaDate: eta });
    await SendMail(lead.contact.email, "🏭 Production Started", html);

    // lead.status = "PROD_RUNNING";
    // lead.stageMeta.push({
    //     status: "PROD_RUNNING",
    //     responsible: lead.assignee || "System",
    //     uploadedBy: req.user?.id || "System",
    //     dueAt: new Date(Date.now() + (SLA.PROD_RUNNING || 0))
    // });
    setStatusAtLeast(lead, "PROD_RUNNING");
    pushStageForward(lead, "PROD_RUNNING", {
        status: "PROD_RUNNING",
        responsible: lead.assignee || "System",
        uploadedBy: req.user?.id || "System",
        dueAt: new Date(Date.now() + (SLA.PROD_RUNNING || 0))
    });
    lead.activityLog.push({
        type: "Production Started",
        actor: req.user?.name || "System",
        timestamp: new Date(),
    });

    await lead.save();
    res.json({ ok: true, lead });
};

// —— helpers we’ll use for money + auto-scheduling ——
function computeTotalsINRPaise(lead) {
    const latestQuote = lead.quotations?.at(-1);
    const rows = latestQuote?.metadata?.rows || [];
    const subtotalR = rows.reduce((s, r) => s + (r.discRate > 0 ? Number(r.discRate) : Number(r.rate)) * Number(r.qty), 0);
    // rupees → paise
    const subtotalP = Math.round(subtotalR * 100);
    const transportP = 10000 * 100; // rupees → paise
    const leadLiftP = 1200 * 100;
    // GST 18% in paise (0.18 * rupees * 100 = rupees * 18)
    const gstP = Math.round(((subtotalP + transportP + leadLiftP) * 18) / 100);
    const grandP = subtotalP + transportP + leadLiftP + gstP;

    // scope payments to current order cycle (after latest PROPOSAL_SENT/ORDER_CONFIRMED)
    // Count only payments from the current order cycle: start at the *last* PROPOSAL_SENT.
    const lastProposal = (lead.stageMeta || []).slice().reverse()
        .find(s => s.status === "PROPOSAL_SENT");
    const cutoffTs = lastProposal?.dueAt ? new Date(lastProposal.dueAt).getTime() : 0;

    const paidP = (lead.payments || [])
        .filter(p => ["paid", "captured"].includes(String(p.status || "").toLowerCase()))
        .filter(p => !cutoffTs || new Date(p.paidAt || p.createdAt || 0).getTime() >= cutoffTs)
        .reduce((s, p) => s + (p.amount || 0), 0);

    const duePaise = Math.max(grandP - paidP, 0);
    return {
        subtotal: Math.round(subtotalP / 100),
        transportCost: 10000,
        leadLiftCost: 1200,
        gstAmount: Math.round(gstP / 100),
        grandTotal: Math.round(grandP / 100),
        paidPaise: paidP,
        duePaise
    };
}

async function autoScheduleInstallation(lead, { actor = "System", when } = {}) {

    // 🚧 Safety guard — do not schedule if dues exist
    const { duePaise } = computeTotalsINRPaise(lead);
    if (duePaise > 0) {
        const err = new Error("balance-due");
        err.code = "BALANCE_DUE";
        err.duePaise = duePaise;
        throw err;
    }

    // idempotent
    // if (lead.status === "INSTALL_BOOKED" || lead.status === "INSTALL_DONE") return lead.installation?.scheduledAt;
    // ✅ idempotent
    // if (lead.status === "INSTALL_BOOKED" || lead.status === "INSTALL_DONE") {
    //     return lead.installation?.scheduledAt;
    // }

    const now = new Date();
    const date = when || new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 10, 0, 0); // +2 days, 10:00

    lead.installation = lead.installation || {};
    lead.installation.scheduledAt = date;

    lead.status = "INSTALL_BOOKED";
    lead.stageMeta.push({
        status: "INSTALL_BOOKED",
        responsible: lead.assignee || "System",
        uploadedBy: actor,
        dueAt: date
    });
    setStatusAtLeast(lead, "INSTALL_BOOKED");
    pushStageForward(lead, "INSTALL_BOOKED", {
        status: "INSTALL_BOOKED",
        responsible: lead.assignee || "System",
        uploadedBy: actor,
        dueAt: date
    });
    lead.activityLog.push({
        type: "Installation Scheduled",
        actor,
        timestamp: new Date(),
        details: { scheduledAt: date }
    });
    await lead.save();

    const trackUrl = await ensureTrackingUrl(lead);
    try {
        await SendMail(
            lead.contact.email,
            "🛠️ Installation Scheduled",
            `<p>Hi ${lead.contact.name},</p>
        <p>Your installation is scheduled for <strong>${date.toLocaleString()}</strong>.</p>
        <p><a href="${trackUrl}">Track your order</a></p>`
        );
    } catch (e) { console.error("Install email failed:", e.message); }

    return date;
}

function isPaid(p) {
    return ["paid", "captured"].includes(String(p?.status || "").toLowerCase());
}

function hasPaidBalanceForRef(lead, referenceId) {
    if (!referenceId) return false;
    const p = (lead.payments || []).find(x => x.referenceId === referenceId);
    const kind = String(p?.raw?.kind || "").toUpperCase(); // "BALANCE" from your code
    return !!p && isPaid(p) && kind === "BALANCE";
}

function isFullyPaid(lead) {
    const { duePaise } = computeTotalsINRPaise(lead);
    return duePaise === 0;
}

async function buildInstallAPIResponse(lead, {
    scheduledAt = null,
    requirePayment = false,
    referenceId = null,
    redirectTo = null,
    alreadyBooked = false
} = {}) {
    const trackUrl = await ensureTrackingUrl(lead);
    const totals = computeTotalsINRPaise(lead);

    return {
        ok: true,
        leadId: String(lead._id),
        status: lead.status,                         // INSTALL_BOOKED / INSTALL_DONE / etc.
        scheduledAt: scheduledAt || lead.installation?.scheduledAt || null,
        scheduledAtISO: (scheduledAt || lead.installation?.scheduledAt || null)?.toISOString?.() || null,

        trackingUrl: trackUrl,
        customer: {
            name: lead?.contact?.name || "",
            email: lead?.contact?.email || "",
            contact: lead?.contact?.phone || ""
        },

        totals: {
            subtotal: totals.subtotal,
            transportCost: totals.transportCost,
            leadLiftCost: totals.leadLiftCost,
            gstAmount: totals.gstAmount,
            grandTotal: totals.grandTotal,
            paid: Math.round((totals.paidPaise || 0) / 100),
            due: Math.round((totals.duePaise || 0) / 100),
            currency: "INR"
        },

        payment: {
            requirePayment,
            referenceId,
            redirectTo
        },

        alreadyBooked
    };
}

export const scheduleInstallationByLead = async (req, res) => {
    try {
        const { id } = req.params;
        const { referenceId } = req.body || {};

        const lead = await DoorLead.findById(id);
        if (!lead) return res.status(404).json({ ok: false, error: "lead-not-found" });

        if (lead.status === "PROD_COMPLETED") {
            // const when = scheduledAt ? new Date(scheduledAt) : undefined;
            const { duePaise } = computeTotalsINRPaise(lead);

            // If balance still due and we don't have a paid BALANCE ref, create one *now*
            if (duePaise > 0) {
                if (referenceId && hasPaidBalanceForRef(lead, referenceId)) {
                    const date = await autoScheduleInstallation(lead, { actor: req.user?.id || "System" });
                    return res.json({ ok: true, status: lead.status, scheduledAt: date });
                }

                const { reference, paymentLink } =
                    await createBalanceLinkAndPersist(lead, duePaise, `Balance payment for Order ${lead._id}`, 'B');

                // remember desired schedule to be applied after payment callback
                lead.installation = lead.installation || {};
                lead.installation.pending = { desiredAt: new Date(Date.now() + 2 * 24 * 3600 * 1000), referenceId: reference };
                await lead.save();

                return res.json({
                    ok: true,
                    requirePayment: true,
                    referenceId: reference,
                    redirectTo: paymentLink.short_url
                });
            }

            // No balance due → schedule immediately
            const date = await autoScheduleInstallation(lead, { actor: req.user?.id || "System" });
            return res.json({ ok: true, status: lead.status, scheduledAt: date });
        }

    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: "server-error" });
    }
};

export const scheduleInstallationByRef = async (req, res) => {
    try {
        const referenceId = req.body?.referenceId || req.query?.ref;
        // const scheduledAt = req.body?.scheduledAt;

        if (!referenceId) return res.status(400).json({ ok: false, error: "missing-referenceId" });

        const lead = await DoorLead.findOne({ "payments.referenceId": referenceId });
        if (!lead) return res.status(404).json({ ok: false, error: "lead-not-found-for-reference" });

        console.log('lead', lead);

        const date = new Date(Date.now() + 2 * 24 * 3600 * 1000)

        lead.installation = lead.installation || {};
        lead.installation.scheduledAt = date;

        lead.status = "INSTALL_BOOKED";
        lead.stageMeta.push({
            status: "INSTALL_BOOKED",
            responsible: lead.assignee || "System",
            uploadedBy: "Admin",
            dueAt: date
        });
        setStatusAtLeast(lead, "INSTALL_BOOKED");
        pushStageForward(lead, "INSTALL_BOOKED", {
            status: "INSTALL_BOOKED",
            responsible: lead.assignee || "System",
            uploadedBy: "Admin",
            dueAt: date
        });
        lead.activityLog.push({
            type: "Installation Scheduled",
            actor: "Admin",
            timestamp: new Date(),
            details: { scheduledAt: date }
        });
        await lead.save();

        // // If not paid yet, return the payment link so FE can redirect again
        // const rec = (lead.payments||[]).find(p => p.referenceId === referenceId);
        // if (!hasPaidBalanceForRef(lead, referenceId)) {
        //   return res.status(409).json({
        //     ok:false,
        //     error:"reference-not-paid-or-not-balance",
        //     redirectTo: rec?.shortUrl || null
        //   });
        // }

        // const when = scheduledAt ? new Date(scheduledAt) : undefined;
        // const date = await autoScheduleInstallation(lead, { actor: "System", when });
        return res.json(await buildInstallAPIResponse(lead, { scheduledAt: date }));
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: "server-error" });
    }
};

export const completeProduction = async (req, res) => {
    try {
        const lead = await DoorLead.findById(req.params.id);
        if (!lead) return res.status(404).json({ error: "not-found" });

        // Only allow if in production
        if (lead.status !== "PROD_RUNNING") {
            return res.status(400).json({ error: "not-in-production" });
        }

        // lead.status = "PROD_COMPLETED";
        // lead.stageMeta.push({
        //     status: "PROD_COMPLETED",
        //     responsible: lead.assignee || "System",
        //     uploadedBy: req.user?.id || "System",
        //     dueAt: new Date()
        // });
        setStatusAtLeast(lead, "PROD_COMPLETED");
        pushStageForward(lead, "PROD_COMPLETED", {
            status: "PROD_COMPLETED",
            responsible: lead.assignee || "System",
            uploadedBy: req.user?.id || "System",
            dueAt: new Date()
        });
        lead.activityLog.push({
            type: "Production Completed",
            actor: req.user?.name || "System",
            timestamp: new Date(),
            details: {}
        });

        const { duePaise } = computeTotalsINRPaise(lead);

        console.log(duePaise);

        // If something is due, create a BALANCE link and return it so FE can redirect the user there
        if (duePaise > 0) {
            // const reference   = `BALANCE-${lead._id}-${Date.now().toString(36)}`;
            const reference = buildRefId(lead._id, "B");
            const paymentLink = await razorpay.paymentLink.create({
                amount: duePaise,
                currency: "INR",
                accept_partial: false,
                reference_id: reference,
                description: `Balance payment for Order ${lead._id}`,
                customer: {
                    name: lead.contact.name,
                    email: lead.contact.email,
                    contact: lead.contact.phone
                },
                reminder_enable: true,
                callback_url: `http://localhost:5173/payment-status/balance`,
                callback_method: "get"
            });

            // persist payment link
            lead.payments = lead.payments || [];
            lead.payments.push({
                referenceId: reference,
                paymentLinkId: paymentLink.id,
                shortUrl: paymentLink.short_url,
                description: paymentLink.description,
                status: paymentLink.status,
                amount: paymentLink.amount,
                currency: paymentLink.currency,
                createdAt: new Date(paymentLink.created_at * 1000),
                expiresAt: paymentLink.expire_by ? new Date(paymentLink.expire_by * 1000) : null,
                raw: { paymentLink, kind: "BALANCE" }
            });

            await lead.save();

            // Optional courtesy email (keep if you like)
            try {
                const trackUrl = await ensureTrackingUrl(lead);
                const html = renderBalanceDueEmail({
                    lead,
                    amountDue: (duePaise / 100).toLocaleString("en-IN"),
                    payUrl: paymentLink.short_url,
                    trackUrl
                });
                await SendMail(lead.contact.email, "🧾 Balance Payment — Action Required", html);
            } catch (e) { console.error("Balance email failed:", e.message); }

            // 👉 Frontend should redirect user to this URL immediately
            return res.json({
                ok: true,
                status: lead.status,
                requirePayment: true,
                redirectTo: paymentLink.short_url,
                referenceId: reference
            });
        } else {
            const okToSchedule = (lead.payments || []).some(p =>
                ["paid", "captured"].includes(String(p.status || "").toLowerCase()) &&
                ["BALANCE", "FULL"].includes(String(p.raw?.kind || "").toUpperCase())
            );
            if (!okToSchedule) {
                // Fully-paid *by math*, but no explicit BALANCE/FULL marker → do NOT auto-book
                await lead.save();
                return res.json({ ok: true, status: lead.status, requirePayment: false, waitingFor: "balance-proof" });
            }
            const when = await autoScheduleInstallation(lead, { actor: req.user?.id || "System" });
            return res.json({ ok: true, status: lead.status, requirePayment: false, scheduledAt: when });
        }

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "server-error" });
    }
};

export const trackingLink = async (req, res) => {
    try {
        const { id } = req.params; // could be leadId or payment reference
        let lead = await DoorLead.findOne({ "payments.referenceId": id });
        // if (!lead) {
        //     lead = await DoorLead.findOne({ "payments.referenceId": id });
        // }
        if (!lead) return res.status(404).json({ ok: false, error: "not-found" });

        const url = await ensureTrackingUrl(lead);
        res.json({ ok: true, url: new URL(url).pathname }); // or send full url if you prefer
    } catch (error) {
        console.log(error);
    }
}

const STAGE_META = {
    LEAD_NEW: { label: "Lead Created", eta: 0, tip: "We received your request." },
    LEAD_QUALIFIED: { label: "Qualified", eta: 12, tip: "Our team validated your requirements." },
    MEASURE_BOOKED: { label: "Measurement Booked", eta: 24, tip: "Site visit scheduled." },
    MEASURE_DONE: { label: "Measurement Done", eta: 8, tip: "Dimensions captured; preparing estimate." },
    QUOTE_DRAFTED: { label: "Quote Drafted", eta: 48, tip: "Internal review." },
    QUOTE_SENT: { label: "Quote Sent", eta: 24, tip: "Awaiting your confirmation/advance." },
    QUOTE_NEGOTIATE: { label: "Negotiation", eta: 120, tip: "Discussion on scope/pricing." },
    ORDER_CONFIRMED: { label: "Order Confirmed", eta: 24, tip: "Advance received; kicking off production prep." },
    PROD_READY: { label: "Design Freeze", eta: 72, tip: "Final design confirmation." },
    PROD_RUNNING: { label: "Production Running", eta: 720, tip: "Manufacturing in progress." },
    PROD_COMPLETED: { label: "Dispatched", eta: 0, tip: "Shipped from factory." },
    INSTALL_BOOKED: { label: "Installation Booked", eta: 48, tip: "Team assigned with schedule." },
    INSTALL_DONE: { label: "Installation Done", eta: 0, tip: "Installed at site." },
};
export const track = async (req, res) => {
    try {
        const lead = await DoorLead.findOne({ "tracking.token": req.params.token, "tracking.revoked": false });
        if (!lead) return res.status(404).json({ ok: false, error: "invalid-or-revoked" });

        const current = lead.status || "LEAD_NEW";
        const progressIndex = Math.max(0, STAGE_ORDER.indexOf(current));

        // build timeline from stageMeta
        const timeline = STAGE_ORDER.map((code, i) => {
            const hit = (lead.stageMeta || []).slice().reverse().find(s => s.status === code);
            return {
                code,
                label: STAGE_META[code]?.label || code,
                tip: STAGE_META[code]?.tip || "",
                reached: !!hit,
                reachedAt: hit?.updatedAt || hit?.dueAt || hit?.updatedAt || null,
                isCurrent: code === current,
                etaHours: STAGE_META[code]?.eta ?? null
            };
        });

        // amounts (same calc you use everywhere)
        const latestQuote = lead.quotations?.at(-1);
        const rows = latestQuote?.metadata?.rows || [];
        const subtotal = rows.reduce((s, r) => s + (r.discRate > 0 ? Number(r.discRate) : Number(r.rate)) * Number(r.qty), 0);
        const transportCost = 10000, leadLiftCost = 1200;
        const gstAmount = Math.round((subtotal + transportCost + leadLiftCost) * 0.18);
        const grandTotal = subtotal + transportCost + leadLiftCost + gstAmount;

        // payment summary
        const paidPaise = (lead.payments || [])
            .filter(p => ["paid", "captured"].includes((p.status || "").toLowerCase()))
            .reduce((s, p) => s + (p.amount || 0), 0);
        const duePaise = Math.max(grandTotal * 100 - paidPaise, 0);

        res.json({
            ok: true,
            leadId: lead._id,
            customer: { name: lead.contact?.name || "Customer" },
            current,
            progressIndex,
            timeline,
            totals: {
                subtotal, transportCost, leadLiftCost, gstAmount, grandTotal,
                paid: paidPaise / 100, due: duePaise / 100, currency: "INR"
            },
            files: {
                quotationUrl: latestQuote?.fileName ? `${process.env.BACKEND_PUBLIC_URL || "http://localhost:4000"}/uploads/quotations/${latestQuote.fileName}` : null,
                // add your proposal if you want:
                // proposalUrl: ...
            },
            // show next suggested action for client
            nextAction: (() => {
                switch (current) {
                    case "QUOTE_SENT": return "Review quotation & pay 50% advance to confirm order.";
                    case "ORDER_CONFIRMED": return "We’ll share production updates and installation date.";
                    case "DISPATCHED": return "Get ready for installation. Our team will contact you.";
                    default: return null;
                }
            })()
        });
    } catch (error) {
        console.log(error);
    }
};

// POST /api/door-leads/:id/installation/complete
export const completeInstallation = async (req, res) => {
    try {
        const { id } = req.params;
        const { completedAt, installerName, installerPhone, notes } = req.body || {};
        const lead = await DoorLead.findById(id);
        if (!lead) return res.status(404).json({ ok: false, error: "not-found" });

        // Only allow if it was booked
        if (lead.status !== "INSTALL_BOOKED") {
            // idempotent: if already done just return
            if (lead.status === "INSTALL_DONE") return res.json({ ok: true, lead });
            return res.status(400).json({ ok: false, error: "not-in-installation" });
        }

        const when = completedAt ? new Date(completedAt) : new Date();

        // persist install info
        lead.installation = lead.installation || {};
        lead.installation.completedAt = when;
        if (installerName) lead.installation.installerName = installerName;
        if (installerPhone) lead.installation.installerPhone = installerPhone;
        if (notes) lead.installation.notes = notes;

        // advance stage
        setStatusAtLeast(lead, "INSTALL_DONE");
        pushStageForward(lead, "INSTALL_DONE", {
            status: "INSTALL_DONE",
            responsible: lead.assignee || "System",
            uploadedBy: req.user?.id || "System",
            dueAt: when
        });

        // log
        lead.activityLog.push({
            type: "Installation Completed",
            actor: req.user?.name || "System",
            timestamp: new Date(),
            details: { completedAt: when, installerName, installerPhone, notes }
        });

        // (optional) move to HANDOVER_DONE in 7 days, or create a task — your call
        await lead.save();

        // courtesy email
        try {
            const trackUrl = await ensureTrackingUrl(lead);
            await SendMail(
                lead.contact.email,
                "✅ Installation Complete",
                `<p>Hi ${lead.contact.name},</p>
            <p>Your installation was completed on <strong>${when.toLocaleString()}</strong>.</p>
            <p>You can view your order timeline here: <a href="${trackUrl}">Track Order</a></p>`
            );
        } catch (e) { /* non-blocking */ }

        return res.json({ ok: true, lead });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, error: "server-error" });
    }
};

export const addTask = async (req, res) => {
    const { id } = req.params;
    const { title, role, assignedTo, dueAt } = req.body;
    const lead = await DoorLead.findById(id);
    if (!lead) return res.status(404).end();

    lead.tasks.push({ title, role, assignedTo, dueAt });
    await lead.save();
    res.json(lead.tasks.at(-1));
};

export const updateTask = async (req, res) => {
    const { id, taskId } = req.params;
    const { status, completedAt } = req.body;
    const lead = await DoorLead.findById(id);
    if (!lead) return res.status(404).end();

    const task = lead.tasks.id(taskId);
    if (!task) return res.status(404).end();

    task.status = status;
    task.completedAt = completedAt || task.completedAt;
    await lead.save();
    res.json(task);
};