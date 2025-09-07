import { createTransport } from "nodemailer";

export const SendMail = async (email, subject, htmlContent, attachments = []) => {
    const transport = createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: Number(process.env.SMTP_PORT) === 465,  // true only if port 465
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    await transport.sendMail({
        from: process.env.SMTP_USER,
        to: email,
        subject,
        html: htmlContent,
        attachments    // ← pass attachments here
    });
};
