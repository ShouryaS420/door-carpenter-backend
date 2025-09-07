/**
 * Renders the follow-up reminder e-mail for the assigned employee.
 * @param {Object} vars
 *   { leadId, leadName, employeeName, dueAt, humanStatus,
 *     lastOutcome, lastNotes, phone }
 */
function renderEmployeeTemplate(vars) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Follow-Up Reminder</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:#FF4A10;padding:20px;text-align:center;color:#fff;font-size:20px;">
            Follow-Up Reminder
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:30px 40px;color:#333;">
            <p style="font-size:16px;">Hi <strong>${vars.employeeName}</strong>,</p>
            <p style="font-size:15px;line-height:1.5">
              This is a friendly reminder that <strong>Lead ${vars.leadName}</strong>
              (ID <strong>${vars.leadId}</strong>) is due for follow-up as of
              <strong>${vars.dueAt}</strong>.
            </p>

            <!-- Details -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;font-size:15px;color:#555;line-height:1.4">
              <tr>
                <td style="padding:8px 0;"><strong>Current status:</strong></td>
                <td style="padding:8px 0;">${vars.humanStatus}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;"><strong>Last call outcome:</strong></td>
                <td style="padding:8px 0;">${vars.lastOutcome}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;"><strong>Notes:</strong></td>
                <td style="padding:8px 0;">${vars.lastNotes}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;"><strong>Call number:</strong></td>
                <td style="padding:8px 0;">${vars.phone}</td>
              </tr>
            </table>

            <p style="font-size:15px;line-height:1.5">
              <strong>Next steps:</strong><br/>
              1. Reach out at the earliest convenience.<br/>
              2. Log your call outcome in the dashboard.<br/>
              3. If they’re still unavailable or need a new slot, update “Next Call” time.
            </p>

            <p style="margin-top:30px;font-size:15px;">
              Thank you for keeping our pipeline moving!<br/>
              — DoorCarpenter System
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#fafafa;padding:20px;text-align:center;color:#888;font-size:13px;">
            © ${new Date().getFullYear()} DoorCarpenter · Pune, India
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Renders the follow-up alert e-mail for the admin.
 * @param {Object} vars
 *   { leadId, leadName, employeeName, dueAt, humanStatus,
 *     lastOutcome, lastNotes, phone,
 *     category, core, size:{w,h,t,quantity}, pin, email }
 */
function renderAdminTemplate(vars) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Follow-Up Alert</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:#333;padding:20px;text-align:center;color:#fff;font-size:20px;">
            Follow-Up Alert for Admin
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:30px 40px;color:#333;">
            <p style="font-size:16px;">Hi Admin,</p>
            <p style="font-size:15px;line-height:1.5">
              A follow-up reminder has been triggered for <strong>Lead ${vars.leadName}</strong>
              (ID <strong>${vars.leadId}</strong>), assigned to <strong>${vars.employeeName}</strong>.
            </p>

            <!-- Summary table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;font-size:15px;color:#555;line-height:1.4">
              <tr><td style="padding:6px 0;"><strong>Scheduled at:</strong></td><td style="padding:6px 0;">${vars.dueAt}</td></tr>
              <tr><td style="padding:6px 0;"><strong>Status:</strong></td><td style="padding:6px 0;">${vars.humanStatus}</td></tr>
              <tr><td style="padding:6px 0;"><strong>Last outcome:</strong></td><td style="padding:6px 0;">${vars.lastOutcome}</td></tr>
              <tr><td style="padding:6px 0;"><strong>Notes:</strong></td><td style="padding:6px 0;">${vars.lastNotes}</td></tr>
            </table>

            <h3 style="margin:20px 0 8px;color:#333;font-size:17px;">Full Lead Details</h3>
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;color:#555;line-height:1.4">
              <tr><td style="padding:4px 0;"><strong>Category:</strong></td><td style="padding:4px 0;">${vars.category}</td></tr>
              <tr><td style="padding:4px 0;"><strong>Core:</strong></td><td style="padding:4px 0;">${vars.core}</td></tr>
              <tr>
                <td style="padding:4px 0;"><strong>Size:</strong></td>
                <td style="padding:4px 0;">
                  ${vars.size.w}×${vars.size.h}×${vars.size.t} mm (×${vars.size.quantity})
                </td>
              </tr>
              <tr><td style="padding:4px 0;"><strong>PIN:</strong></td><td style="padding:4px 0;">${vars.pin}</td></tr>
              <tr><td style="padding:4px 0;"><strong>Email:</strong></td><td style="padding:4px 0;">${vars.email}</td></tr>
              <tr><td style="padding:4px 0;"><strong>Phone:</strong></td><td style="padding:4px 0;">${vars.phone}</td></tr>
            </table>

            <p style="margin-top:30px;font-size:15px;line-height:1.5">
              Please review the lead’s pipeline in the dashboard and ensure the follow-up is completed.
            </p>

            <p style="margin-top:20px;font-size:15px;">
              — DoorCarpenter System
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#fafafa;padding:20px;text-align:center;color:#888;font-size:13px;">
            © ${new Date().getFullYear()} DoorCarpenter · Pune, India
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
export { renderEmployeeTemplate, renderAdminTemplate };