export interface CandidateInviteParams {
    to: string;
    candidateName: string;
    interviewerName: string;
    companyName: string;
    sessionCode: string;
    meetingLink: string;
    scheduledAt: Date;
}
export declare function sendCandidateInvite(params: CandidateInviteParams): Promise<void>;
//# sourceMappingURL=email.d.ts.map