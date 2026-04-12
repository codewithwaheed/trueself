import { API_URL } from "@/lib/constants";
import { AcceptInviteForm } from "./accept-invite-form";
async function getInvitation(token) {
    const res = await fetch(`${API_URL}/api/auth/invitations/${token}`, {
        cache: "no-store",
    });
    if (!res.ok) {
        return null;
    }
    const data = await res.json();
    return data.invitation;
}
export default async function InvitePage({ params }) {
    const { token } = await params;
    const invitation = await getInvitation(token);
    if (!invitation) {
        return (<div className="animate-fade-in text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-critical/10 mb-5">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="text-critical">
            <path d="M12 9V11M12 15H12.01M5.07183 19H18.9282C20.4678 19 21.4301 17.3333 20.6603 16L13.7321 4C12.9623 2.66667 11.0377 2.66667 10.2679 4L3.33975 16C2.56995 17.3333 3.53223 19 5.07183 19Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Invalid invitation
        </h1>
        <p className="text-navy-400 text-sm mb-6">
          This invitation link is invalid, expired, or has already been used.
        </p>
        <a href="/login" className="text-trust hover:text-trust-light font-medium text-sm transition-colors">
          Go to sign in
        </a>
      </div>);
    }
    return (<div className="animate-fade-in">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-trust/10 mb-5 shield-pulse">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="text-trust">
            <path d="M16 21V19C16 17.9391 15.5786 16.9217 14.8284 16.1716C14.0783 15.4214 13.0609 15 12 15H6C4.93913 15 3.92172 15.4214 3.17157 16.1716C2.42143 16.9217 2 17.9391 2 19V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M19 8V14M16 11H22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Join {invitation.companyName}
        </h1>
        <p className="text-navy-400 text-sm">
          You&apos;ve been invited to join as an interviewer. Set up your
          account to get started.
        </p>
      </div>

      <AcceptInviteForm token={token} email={invitation.email} defaultName={invitation.name}/>
    </div>);
}
//# sourceMappingURL=page.js.map