import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_DOMAIN = process.env.RESEND_FROM_DOMAIN || "trueself.io";
const FROM_ADDRESS = `TrueSelf Interviews <interviews@${FROM_DOMAIN}>`;

export interface CandidateInviteParams {
  to: string;
  candidateName: string;
  interviewerName: string;
  companyName: string;
  sessionCode: string;
  meetingLink: string;
  scheduledAt: Date;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendCandidateInvite(params: CandidateInviteParams): Promise<void> {
  const {
    to,
    sessionCode,
    meetingLink,
    scheduledAt,
  } = params;
  const candidateName = escapeHtml(params.candidateName);
  const interviewerName = escapeHtml(params.interviewerName);
  const companyName = escapeHtml(params.companyName);
  const companyNameRaw = params.companyName;

  const formattedDate = scheduledAt.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = scheduledAt.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  // Guard: only allow http(s) meeting links in email HTML
  const safeMeetingLink =
    meetingLink.startsWith("https://") || meetingLink.startsWith("http://")
      ? meetingLink
      : "#";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#d8dfe9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e1a;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0f1629;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
        <!-- Header -->
        <tr>
          <td style="background:#161d35;padding:24px 32px;border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="font-size:18px;font-weight:700;color:#f1f5f9;letter-spacing:-0.5px;">TrueSelf</span>
            <span style="font-size:12px;color:#3d4f7a;margin-left:8px;font-weight:500;">Interview Integrity</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:14px;color:#5a6e9a;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Interview Invitation</p>
            <h1 style="margin:0 0 24px;font-size:24px;font-weight:700;color:#f1f5f9;line-height:1.3;">Hi ${candidateName},</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#8494b8;line-height:1.6;">
              <strong style="color:#d8dfe9;">${interviewerName}</strong> from <strong style="color:#d8dfe9;">${companyName}</strong> has scheduled an interview with you.
            </p>
            <!-- Interview details -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#161d35;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid rgba(255,255,255,0.06);">
              <tr>
                <td style="padding:6px 0;">
                  <span style="font-size:12px;color:#3d4f7a;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Date &amp; Time</span><br>
                  <span style="font-size:15px;color:#f1f5f9;font-weight:500;">${formattedDate} at ${formattedTime}</span>
                </td>
              </tr>
            </table>
            <!-- Meeting link -->
            <p style="margin:0 0 12px;font-size:14px;color:#8494b8;">Join your interview:</p>
            <a href="${safeMeetingLink}" style="display:inline-block;background:#10b981;color:#0a0e1a;font-weight:600;font-size:15px;padding:12px 24px;border-radius:10px;text-decoration:none;margin-bottom:32px;">Join Meeting</a>
            <!-- Session code -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#161d35;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid rgba(16,185,129,0.2);">
              <tr>
                <td align="center">
                  <p style="margin:0 0 12px;font-size:12px;color:#3d4f7a;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Your TrueSelf Session Code</p>
                  <p style="margin:0 0 16px;font-size:36px;font-weight:700;color:#10b981;letter-spacing:0.15em;font-family:'Courier New',monospace;">${sessionCode}</p>
                  <p style="margin:0;font-size:13px;color:#5a6e9a;line-height:1.5;">
                    Download the TrueSelf Agent before your interview.<br>
                    Launch it and enter this code when prompted.
                  </p>
                </td>
              </tr>
            </table>
            <!-- Download CTA -->
            <p style="margin:0 0 12px;font-size:14px;color:#8494b8;">Download the TrueSelf Agent:</p>
            <a href="https://trueself.io/download" style="display:inline-block;background:transparent;color:#10b981;font-weight:600;font-size:14px;padding:10px 20px;border-radius:10px;text-decoration:none;border:1px solid rgba(16,185,129,0.3);">Download Agent</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0;font-size:12px;color:#2a3660;line-height:1.6;">
              TrueSelf only monitors activity during your scheduled interview window. It does not access personal files, browsing history, or data outside the session.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `;

  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === "re_your_key_here") {
    console.log("[email] No RESEND_API_KEY set — would have sent to:", to);
    console.log("[email] Session code:", sessionCode);
    return;
  }

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `Your interview with ${companyNameRaw} — session details`,
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
