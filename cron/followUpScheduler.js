// services/followUpScheduler.js
import cron from "node-cron";
import DoorLead from "../models/doorLead.js";
import User from "../models/User.js";
import { SendMail } from "../utils/sendmail.js";
import axios from "axios";
import { renderEmployeeTemplate, renderAdminTemplate } from "../utils/emailTemplates.js";

function prettyStatus(raw) {
    return raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** send WhatsApp via Interakt */
async function sendWhatsApp(templateName, phone, bodyValues, callbackData) {
    if (!phone) return;
    const payload = {
        countryCode: "+91", // adjust if you have international leads/employees
        phoneNumber: phone, // strip plus/leading zero if needed
        type: "Template",
        callbackData: callbackData?.toString() || "",
        template: {
            name: templateName,
            languageCode: "en",
            bodyValues,
        },
    };
    try {
        await axios.post("https://api.interakt.ai/v1/public/message/", payload, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${process.env.INTERAKT_API_KEY}`,
            },
        });
    } catch (e) {
        console.error(`WhatsApp send failed (${templateName}) to ${phone}:`, e?.response?.data || e.message);
    }
}

async function sendEmployeeFollowupReminder(lead, lastOutcomeLog) {

    // Email to assigned employee (you need their email; assume you fetch user)
    const employee = await User.findOne({ _id: lead.assignee });
    if (!employee) {
        console.warn(`No employee found for lead ${lead._id}, skipping email reminder.`);
        return;
    }
    const employeeName = employee.assignee || "Unassigned";
    // Format due date for email/WhatsApp
    const dueAtStr = new Date(lastOutcomeLog?.details?.nextCallAt || lead.stageMeta.slice(-1)[0]?.dueAt || Date.now()).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });

    // Prepare variables for the template
    const vars = {
        leadId: lead._id,
        leadName: lead.contact.name,
        employeeName,
        dueAt: new Date(lastOutcomeLog?.details?.nextCallAt || lead.stageMeta.slice(-1)[0]?.dueAt || Date.now()).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
        }),
        humanStatus: prettyStatus(lead.status),
        lastOutcome: lastOutcomeLog?.details?.outcome || "N/A",
        lastNotes: lastOutcomeLog?.details?.notes || "None",
        phone: lead.contact.phone,
        leadLink: `https://yourdashboard.example.com/leads/${lead._id}`,
        retryAttempts: lead.retryAttempts || 0,
        threshold: 3
    };

    const html = renderEmployeeTemplate(vars);
    const subject = `Follow-up reminder: Lead ${vars.leadName} (${vars.leadId})`;

    // console.log(employee?.phone);
    // if (employee?.name) {
    await SendMail(employee.email, subject, html);
    // }

    // WhatsApp to employee
    // bodyValues must correspond to the template definition in Interakt
    await sendWhatsApp(
        "employee_followup_reminder",
        employee?.phone,
        [
            employeeName,
            lead.contact.name,
            lead._id.toString(),
            dueAtStr,
            prettyStatus(lead.status),
            lastOutcomeLog?.details?.outcome || "N/A",
            lastOutcomeLog?.details?.notes || "None",
            lead.contact.phone,
            `https://yourdashboard.example.com/leads/${lead._id}`,
        ],
        lead._id
    );
}

async function sendAdminEscalation(lead, lastOutcomeLog) {
    const vars = {
        leadId: lead._id,
        leadName: lead.contact.name,
        employeeName: lead.assignee || "Unassigned",
        dueAt: new Date(lastOutcomeLog?.details?.nextCallAt || lead.stageMeta.slice(-1)[0]?.dueAt || Date.now()).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
        }),
        humanStatus: prettyStatus(lead.status),
        lastOutcome: lastOutcomeLog?.details?.outcome || "N/A",
        lastNotes: lastOutcomeLog?.details?.notes || "None",
        phone: lead.contact.phone,
        email: lead.contact.email,
        category: lead.category,
        core: lead.core,
        size: lead.size || {},
        pin: lead.contact.pin,
        leadLink: `https://yourdashboard.example.com/leads/${lead._id}`
    };

    const html = renderAdminTemplate(vars);
    const subject = `Escalation: Lead ${vars.leadName} needs attention`;

    // Send to admin(s); you can hardcode or fetch from config
    await SendMail(process.env.ADMIN_ALERT_EMAIL, subject, html);

    // Optionally Slack/email summary elsewhere.
}


export function followUpScheduler() {
    // runs every minute
    cron.schedule('*/1 * * * *', async () => {
        const now = new Date();
        const leads = await DoorLead.find({
            status: { $in: ['LEAD_NEW', 'LEAD_CALLBACK', 'DATA_FIX_NEEDED', 'LEAD_POSTPONED'] }
        });

        for (const lead of leads) {
            // find latest call outcome
            const lastOutcomeLog = lead.activityLog
                .filter(l => l.type === 'Call Outcome')
                .sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

            const lastStageLog = lead.stageMeta.slice(-1)[0];

            // Retry follow-ups (callback family)
            if (lead.status === 'LEAD_CALLBACK') {
                const nextCallAt = new Date(lastOutcomeLog?.details?.nextCallAt || 0);
                // If we're past scheduled retry and not yet notified or escalated
                if (now >= nextCallAt && !lead.notified) {
                    // Notify employee
                    await sendEmployeeFollowupReminder(lead, lastOutcomeLog);
                    // Notify admin if attempts exceed threshold
                    if ((lead.retryAttempts || 0) >= 3) {
                        await sendAdminEscalation(lead, lastOutcomeLog);
                    }
                    lead.notified = true;
                    await lead.save();
                }
            }

            // Data fix needed or postponed, check dueAt
            if ((lead.status === 'DATA_FIX_NEEDED' || lead.status === 'LEAD_POSTPONED') && lastStageLog) {
                const due = new Date(lastStageLog.dueAt);
                if (now >= due && !lead.notified) {
                    // await sendAdminReminderForStale(lead, lastStageLog);
                    lead.notified = true;
                    await lead.save();
                }
            }
        }
    });
}
