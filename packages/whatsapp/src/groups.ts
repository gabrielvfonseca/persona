import type { WASocket } from "baileys";

export interface GroupSummary {
  id: string;
  participants: number;
  subject: string;
}

export async function listGroups(sock: WASocket): Promise<GroupSummary[]> {
  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups).map((group) => ({
    id: group.id,
    participants: group.participants.length,
    subject: group.subject,
  }));
}
