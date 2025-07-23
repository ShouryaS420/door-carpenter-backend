import DoorLead from "../models/doorlead.js";
import nodemailer from 'nodemailer';
import { SendMail } from "../utils/sendmail.js";

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

export const doorLead = async (req, res) => {
    console.log(req.body);
    try {
        const doc = await DoorLead.create(req.body); // 🚀 insert

        console.log(doc.contact.email);

        const WelcomeEmail = `<!doctype html>
            <html>
            <body style="margin:0;padding:0;font-family:Inter,Arial,sans-serif;background:#f6f7f8">
                <table width="100%" cellpadding="0" cellspacing="0">
                    <tr><td align="center">
                    <table width="600" style="background:#ffffff;border-radius:8px;margin:32px 0">
                    <!-- header -->
                    <tr>
                        <td style="padding:24px;text-align:center;background:#FF4A10;border-top-left-radius:8px;border-top-right-radius:8px;">
                        <img src="https://yourcdn.com/logo-white.png" width="120" alt="DoorCarpenter"/>
                        </td>
                    </tr>
                    <!-- hero -->
                    <tr><td style="padding:32px 40px;text-align:center">
                        <h2 style="margin:0;font-size:24px;color:#111">Thank you, %NAME%!</h2>
                        <p style="color:#555;font-size:15px;line-height:1.55">
                        We’ve logged your custom <strong>%CATEGORY%</strong> request (ID %ID%). <br>
                        Our quotation team will review the specifications and contact you within <strong>24 hours</strong>.
                        </p>
                    </td></tr>
                    <!-- order summary -->
                    <tr><td style="padding:0 40px 32px">
                        <table width="100%" style="border-collapse:collapse">
                        <tr><td style="padding:8px 0;color:#777">Core</td><td style="padding:8px 0">%CORE%</td></tr>
                        <tr><td style="padding:8px 0;color:#777">Finish</td><td style="padding:8px 0">%FINISH%</td></tr>
                        <tr><td style="padding:8px 0;color:#777">Quantity</td><td style="padding:8px 0">%QTY%</td></tr>
                        </table>
                    </td></tr>
                    <!-- CTA -->
                    <tr><td style="padding:0 40px 40px;text-align:center">
                        <a href="https://doorcarpenter.in/doors/builder/%ID%" style="background:#FF4A10;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;display:inline-block">
                        View your request
                        </a>
                    </td></tr>
                    <!-- footer -->
                    <tr>
                        <td style="background:#fafafa;padding:24px 40px;text-align:center;font-size:12px;color:#888;border-bottom-left-radius:8px;border-bottom-right-radius:8px">
                        © %signedyear% DoorCarpenter · Pune, India<br>
                        You’re receiving this e‑mail because you requested a quote on our site.
                        </td>
                    </tr>
                </table>
            </td></tr>
        </table>
        </body>
        </html>`;
        
        await SendMail(doc.contact.email, `Hi! ${doc.contact.name} welcome DoorCarpenter`, WelcomeEmail);
        res.status(201).json({ id: doc._id });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "db‑insert‑failed" });
    }
}

export const getAllLeads = async (req, res) => {
    try {
        res.json(await DoorLead.find().sort({createdAt:-1}))
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e });
    }
}

export const sendMail = async (req, res) => {
    try {
        const lead = await DoorLead.findById(req.params.id);
        if(!lead) return res.status(404).json({error:"not-found"});
        await SendMail(lead.contact.email, "Your custom door quote", req.body.body);
        res.status(200).json({ ok:true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e });
    }
}