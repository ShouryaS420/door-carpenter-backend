// utils/sendWhatsApp.js
import fetch from "node-fetch";

const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY;

export const sendWhatsApp = async (phone, message) => {
    const payload = {
        countryCode: "91",
        phoneNumber: phone.replace("+91", ""),
        callbackData: "site-measurement",
        type: "text",
        text: {
            body: message,
        },
    };

    try {
        const res = await fetch("https://api.interakt.ai/v1/public/message/", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${INTERAKT_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) {
            console.error("WhatsApp error:", data);
        }
    } catch (err) {
        console.error("WhatsApp send failed:", err.message);
    }
};
