// cron/autoAssign.js
import cron from "node-cron";
import DoorLead from "../models/doorLead.js";
import User     from "../models/User.js";

// maintain a pointer in memory (or DB) to rotate assignments
let lastIndex = 0;

export function startAutoAssign(){
    // runs every 5 minutes
    cron.schedule("* * * * * *", async ()=> {
        try {
            const un = await DoorLead.find({ status:"LEAD_NEW", assignee:"Unassigned" });
            // console.log(un);

            if (!un.length) return;

            const sales = await User.find({ role:"Sales" });
            if (!sales.length) return;

            for (const lead of un) {
                // pick next sales user
                const assignee = sales[lastIndex % sales.length];
                lastIndex++;

                lead.assignee = assignee._id;
                lead.stageMeta.push({
                    status:       lead.status,
                    responsible:  assignee._id,
                    uploadedBy:   lead.sessionId,
                    dueAt:        new Date(Date.now() + 4*3600*1000)  // 4h SLA
                });
                await lead.save();

                console.log(`Assigned lead ${lead._id} → ${assignee.name}`);
            }
        } catch(err){
            console.error("Auto‑assign error:", err);
        }
    });
}
