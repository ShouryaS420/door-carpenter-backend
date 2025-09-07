// routes/payments.js
import express from "express";
import Razorpay from "razorpay";
import DoorLead from "../models/doorLead.js";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { razorpay } from "../lib/razorpay.js";

const router = express.Router();

const RAZORPAY_KEY_ID = "rzp_test_eMzUqt9wdPSwA3"
const RAZORPAY_KEY_SECRET = "IMhZ8dC5IAeGGKVGgIShqBrE"

const rzp = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

function inr(n) {
    if (n == null) return "—";
    return `₹ ${(Number(n) / 100).toFixed(2)}`; // for paise inputs
}
function inrRs(n) {
    if (n == null) return "—";
    return `₹ ${Number(n).toLocaleString()}`; // for rupee inputs
}

export async function createPaymentReceiptPdf({
    lead, payment, totals, outPath, company
}) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: "A4", margin: 40 });
        const stream = fs.createWriteStream(outPath);
        doc.pipe(stream);

        const stamp = new Date(payment.paidAt || Date.now());
        const receiptNo =
        payment.receiptNo ||
        `RCPT-${stamp.getFullYear().toString().slice(-2)}${String(
            stamp.getMonth() + 1
        ).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}-${(payment.paymentId || "").slice(-6)}`;

        // Header
        doc
        .fontSize(18)
        .text(company?.name || "DoorCarpenter", { align: "left" })
        .moveDown(0.2)
        .fontSize(10)
        .fillColor("#555")
        .text(company?.addr || "—")
        .text(`Phone: ${company?.tel || "—"} · Email: ${company?.email || "—"}`)
        .moveDown(0.5)
        .fillColor("#111")
        .fontSize(16)
        .text("Payment Receipt", { align: "right" })
        .fontSize(10)
        .text(`Receipt No: ${receiptNo}`, { align: "right" })
        .text(`Date: ${stamp.toLocaleString()}`, { align: "right" })
        .moveDown();

        // Bill To
        doc
        .fontSize(12)
        .text("Billed To", { underline: true })
        .moveDown(0.25)
        .fontSize(11)
        .text(`${lead?.contact?.name || "—"}`)
        .text(`${lead?.contact?.email || "—"}`)
        .text(`${lead?.contact?.phone || lead?.contact?.contact || "—"}`)
        .moveDown();

        // Payment meta
        const meta = [
        ["Lead ID", String(lead?._id || "—")],
        ["Reference ID", payment.referenceId || "—"],
        ["Payment Link ID", payment.paymentLinkId || "—"],
        ["Payment ID", payment.paymentId || "—"],
        ["Status", (payment.status || "—").toUpperCase()],
        ["Method", payment.instrument || "—"],
        ];
        meta.forEach(([k, v]) => {
        doc.font("Helvetica-Bold").text(`${k}: `, { continued: true });
        doc.font("Helvetica").text(v);
        });
        doc.moveDown(0.5);

        // Amounts (use your proposal totals)
        // totals = { subtotal, transportCost, leadLiftCost, gstAmount, grandTotal, advance }
        doc.font("Helvetica-Bold").text("Amount Summary", { underline: true });
        doc.moveDown(0.25);
        const rows = [
        ["Service Subtotal", inrRs(totals.subtotal)],
        ["Transport Cost", inrRs(totals.transportCost)],
        ["Lead & Lift", inrRs(totals.leadLiftCost)],
        ["GST (18%)", inrRs(totals.gstAmount)],
        ["Grand Total", inrRs(totals.grandTotal)],
        ["Amount Paid (this txn)", inr(payment.amount)], // payment.amount is paise
        ["Balance Due", inrRs(Math.max(totals.grandTotal * 100 - (payment.totalPaidPaise || payment.amount || 0), 0) / 100)],
        ];
        rows.forEach(([k, v]) => {
        doc.font("Helvetica").text(`${k}`, { continued: true });
        doc.text(`  ${v}`, { align: "right" });
        });

        doc.moveDown(1);

        doc
        .fontSize(9)
        .fillColor("#666")
        .text(
            "Note: This is a system-generated receipt for your payment. For GST invoice, please contact accounting if not received automatically.",
            { align: "left" }
        );

        // Footer / signature
        doc.moveDown(1.2).fillColor("#111").fontSize(11);
        doc.text("For DoorCarpenter");
        doc.moveDown(1.5);
        doc.text("Authorized Signatory");
        doc.end();

        stream.on("finish", () => resolve({ receiptNo }));
        stream.on("error", reject);
    });
}

/** Build a “Proposal & Agreement” PDF */
export async function createProposalPdf(lead, filePath) {
    return new Promise((resolve, reject) => {
        const doc    = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // --- 1) compute amounts ---
        const latestQuote = lead.quotations.slice(-1)[0];
        const total = latestQuote.metadata.rows.reduce((sum, r) => {
        const price = (r.discRate > 0 ? r.discRate : Number(r.rate));
            return sum + price * Number(r.qty);
        }, 0);
        const transportCost  = 10000;
        const leadLiftCost   = 1200;
        const gstAmount      = Number(((total + transportCost + leadLiftCost) * 0.18).toFixed(2));
        const grandTotal     = total + transportCost + leadLiftCost + gstAmount;
        const halfGrandTotal = Number((grandTotal/2).toFixed(2));

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
        ["Transport Cost",   `₹${transportCost.toLocaleString()}`],
        ["Lead & Lift",      `₹${leadLiftCost.toLocaleString()}`],
        ["GST (18%)",        `₹${gstAmount.toLocaleString()}`],
        ["Grand Total",      `₹${grandTotal.toLocaleString()}`]
        ].forEach(([label, amt]) => {
        doc.text(label+":" ,{ continued: true }).text(amt, { align: "right" }).moveDown(0.3);
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
        doc.font("Helvetica-Bold").text(step+":", { continued: true })
            .font("Helvetica").text(" "+desc)
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
        doc.circle(doc.x+5, doc.y+5, 3).fill("#000").fillColor("#000")
            .text(" "+att, doc.x+12, doc.y-3)
            .moveDown(0.5);
        });

        // doc.addPage();
        // --- AGREEMENT SECTION ---
        doc.fontSize(16).font("Helvetica-Bold").text("AMC SERVICE AGREEMENT", { align: "center" }).moveDown();
        const clauses = [
        { title: "1. Definitions",
            text: "“We/Us” means DoorCarpenter; “You” means the Client." },
        { title: "2. Scope of Work",
            text: "We shall provide annual maintenance for doors & windows plus ROC, Accounting & Tax filings per Attachment B." },
        { title: "3. Fees & Payment",
            text:
            `Service Subtotal: ₹${total.toLocaleString()}\n` +
            `Transport Cost:   ₹${transportCost.toLocaleString()}\n` +
            `Lead & Lift:      ₹${leadLiftCost.toLocaleString()}\n` +
            `GST (18%):        ₹${gstAmount}\n\n` +
            `Grand Total:      ₹${grandTotal.toLocaleString()}\n\n` +
            `• 50% (₹${halfGrandTotal.toLocaleString()}) due upfront on signing.\n` +
            `• 50% (₹${halfGrandTotal.toLocaleString()}) due upon completion.` },
        { title: "4. Term & Termination",
            text: "Commences on payment of the upfront 50% and continues for 12 months. Either party may terminate with 30 days’ written notice." },
        { title: "5. Confidentiality",
            text: "Both parties agree to keep each other’s data confidential." },
        { title: "6. Liability",
            text: "Our liability is limited to the fees paid under this Agreement." },
        { title: "7. Governing Law",
            text: "This Agreement is governed by the laws of India, Pune jurisdiction." }
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

router.get("/verify/:referenceId/:paymentLinkId/:paymentId", async (req, res) => {
    try {
        const { referenceId, paymentLinkId, paymentId } = req.params;

        // 0) Resolve leadId from referenceId (format <leadId>-<rand>)
        const [leadId] = referenceId.split("-");
        const lead = await DoorLead.findOne({ "payments.referenceId": referenceId });

        console.log(lead.status);

        // if (lead.status !== 'PROPOSAL_SENT') return res.status(404).json({ ok: false, error: "lead-not-found" });

        if (!lead) return res.status(404).json({ ok: false, error: "lead-not-found" });

        // 1) Fetch payment details from Razorpay (for instrument, fees, etc.)
        let rzpPayment = null;
        if (paymentId) {
            rzpPayment = await razorpay.payments.fetch(paymentId);
        }

        // 2) Find your payment record on this lead (by referenceId or paymentLinkId)
        const p = lead.payments?.find(
        x => x.referenceId === referenceId || x.paymentLinkId === paymentLinkId
        ) || {};

        // 3) Update fields you want to persist
        p.referenceId = p.referenceId || referenceId;
        p.paymentLinkId = p.paymentLinkId || paymentLinkId;
        p.paymentId = paymentId || p.paymentId;
        p.status = (rzpPayment?.status || req.query.status || "created").toLowerCase(); // paid/captured/failed/cancelled
        p.amount = p.amount || rzpPayment?.amount; // paise
        p.currency = p.currency || rzpPayment?.currency || "INR";
        p.paidAt = rzpPayment?.created_at ? new Date(rzpPayment.created_at * 1000) : new Date();
        p.fees = rzpPayment?.fee ?? null;
        p.tax = rzpPayment?.tax ?? null;

        // pretty instrument string
        let instrument = null;
        if (rzpPayment?.method === "card") {
            instrument = `CARD • ${rzpPayment.card?.network || ""} • **** ${rzpPayment.card?.last4 || ""}`.trim();
        } else if (rzpPayment?.method === "upi") {
            instrument = `UPI • ${rzpPayment.vpa || ""}`.trim();
        } else if (rzpPayment?.method === "netbanking") {
            instrument = `NetBanking • ${rzpPayment.bank || ""}`.trim();
        } else if (rzpPayment?.method) {
            instrument = rzpPayment.method.toUpperCase();
        }
        p.instrument = instrument;

        // 4) Recompute proposal totals (mirror your proposal logic)
        const latestQuote   = lead.quotations.slice(-1)[0];
        const subtotal      = latestQuote.metadata.rows.reduce((s, r) => s + (r.discRate > 0 ? r.discRate : Number(r.rate)) * Number(r.qty), 0);
        const transportCost = 10000;
        const leadLiftCost  = 1200;
        const gstAmount     = Math.round((subtotal + transportCost + leadLiftCost) * 0.18);
        const grandTotal    = subtotal + transportCost + leadLiftCost + gstAmount;
        const advance       = Math.round(grandTotal / 2);

        // You may track cumulative paid if you support multiple payments:
        p.totalPaidPaise = (p.totalPaidPaise || 0) + (p.status === "paid" || p.status === "captured" ? (rzpPayment?.amount || 0) : 0);

        // 5) Save back to lead
        // (either replace existing record or push if missing)
        if (!lead.payments) lead.payments = [];
        const idx = lead.payments.findIndex(x => x === p || x.referenceId === p.referenceId);
        if (idx >= 0) lead.payments[idx] = p;
        else lead.payments.push(p);

        // Optionally bump lead status
        if (["paid", "captured"].includes(p.status)) {
            lead.status = "ORDER_CONFIRMED";
            lead.stageMeta.push({
                status: "ORDER_CONFIRMED",
                responsible: lead.assignee,
                uploadedBy: "system",
                dueAt: new Date()
            });
            lead.activityLog.push({
                type: "Payment Received",
                actor: "Razorpay",
                timestamp: new Date(),
                details: { paymentId: p.paymentId, amount: p.amount, method: p.instrument }
            });
        } else if (["failed", "cancelled"].includes(p.status)) {
            lead.stageMeta.push({
                status: "PAYMENT_FAILED",
                responsible: lead.assignee,
                uploadedBy: "system",
                dueAt: new Date()
            });
            lead.activityLog.push({
                type: "Payment Failed",
                actor: "Razorpay",
                timestamp: new Date(),
                details: { paymentId: p.paymentId }
            });
        }

        // 6) Ensure receipt PDF
        const RECEIPTS_DIR = path.join(process.cwd(), "uploads", "receipts");
        if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
        const fileName = `receipt-${lead._id}-${Date.now()}.pdf`;
        const outPath  = path.join(RECEIPTS_DIR, fileName);

        await createPaymentReceiptPdf({
            lead,
            payment: p,
            totals: { subtotal, transportCost, leadLiftCost, gstAmount, grandTotal, advance },
            outPath,
            company: {
                name: "DoorCarpenter",
                addr: "Gravity Commercial Complex, Pune, MH 411045",
                tel: "8378960089",
                email: "info@doorcarpenter.in",
            }
        });

        p.receiptFile = fileName;
        await lead.save();

        const receiptUrl = `${process.env.BACKEND_PUBLIC_URL || "http://localhost:4000"}/uploads/receipts/${fileName}`;

        // 7) Respond in the shape your React expects (flat)
        return res.json({
            ok: true,
            leadId: String(lead._id),
            referenceId,
            leadStatus: lead.status,
            paymentLinkId: p.paymentLinkId,
            paymentId: p.paymentId,
            status: p.status,                   // paid / failed / cancelled / created
            amount: p.amount,                   // paise
            currency: p.currency || "INR",
            paidAt: p.paidAt,
            fees: p.fees,
            tax: p.tax,
            customer: {
                name: lead?.contact?.name,
                email: lead?.contact?.email,
                contact: lead?.contact?.phone
            },
            instrument: p.instrument,
            quotationUrl: latestQuote?.fileName
                ? `${process.env.BACKEND_PUBLIC_URL || "http://localhost:4000"}/uploads/quotations/${latestQuote.fileName}`
                : null,
            agreementUrl: null,
            receiptUrl,                         // <-- FRONTEND will use this
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ ok: false, error: "verify-failed" });
    }
});

// POST /api/payments/links  { leadId, type: "advance_50" }
router.post("/links", async (req, res) => {
    try {
        const { leadId } = req.body;
        const lead = await DoorLead.findById(leadId);
        if (!lead) return res.status(404).json({ ok:false, error:"lead-not-found" });

        // compute your half-grand-total the same way you did when emailing:
        const latestQuote = lead.quotations.at(-1);
        const total = latestQuote.metadata.rows.reduce((sum, r) => (sum + (Number(r.discRate || r.rate) * Number(r.qty))), 0);
        const transport = 10000, lift = 1200;
        const gst = Math.round((total + transport + lift) * 0.18);
        const grand = total + transport + lift + gst;
        const advance = Math.round(grand / 2);

        // generate truly unique reference for new link
        const ref = `${lead._id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        const paymentLink = await rzp.paymentLink.create({
        amount: advance * 100,
        currency: "INR",
        accept_partial: false,
        reference_id: ref,
        description: `50% advance for ${latestQuote?.quoteNo || "order"}`,
        customer: {
            name: lead.contact.name,
            email: lead.contact.email,
            contact: lead.contact.phone,
        },
        notify: { sms: true, email: true },
        reminder_enable: true,
        callback_url: `${process.env.FRONTEND_URL}/payment-status`,
        callback_method: "get",
        notes: {
            lead_id: lead._id.toString(),
            quote_no: latestQuote?.quoteNo || "",
        }
        });

        res.json({ ok:true, paymentLink });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok:false, error:"create-link-failed", message: e.message });
    }
});

router.get("/by-ref/:referenceId", async (req, res) => {
    try {
        const { referenceId } = req.params;
        const lead = await DoorLead.findOne(
            { "payments.referenceId": referenceId },
            // pick only what the page needs; avoid leaking secrets
            {
                contact: 1,
                quotations: { $slice: -1 },
                payments: 1,
                status: 1,
                category: 1,
                core: 1,
                finish: 1,
                size: 1
            }
        ).lean();

        if (!lead) return res.status(404).json({ error: "not-found" });

        const payment = lead.payments.find(p => p.referenceId === referenceId);
        if (!payment) return res.status(404).json({ error: "payment-not-found" });

        // recompute totals (same as proposal)
        const latestQuote = lead.quotations?.slice(-1)[0];
        const rows = latestQuote?.metadata?.rows || [];
        const subtotal = rows.reduce((s, r) => s + (r.discRate > 0 ? r.discRate : Number(r.rate)) * Number(r.qty), 0);
        const transportCost = 10000;
        const leadLiftCost  = 1200;
        const gstAmount     = Number(((subtotal + transportCost + leadLiftCost) * 0.18).toFixed(2));
        const grandTotal    = subtotal + transportCost + leadLiftCost + gstAmount;

        res.json({
        leadId: String(lead._id),
        referenceId,
        status: lead.status,
        payment: {
            status: payment.status,
            amount: payment.amount / 100, // convert paise to INR
            currency: payment.currency,
            paymentId: payment.paymentId,
            paymentLinkId: payment.paymentLinkId,
            shortUrl: payment.shortUrl,
            paidAt: payment.paidAt,
        },
        customer: lead.contact,
        totals: {
            subtotal, transportCost, leadLiftCost, gstAmount, grandTotal, advance: Math.round(grandTotal / 2)
        }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "server-error" });
    }
});


export default router;
