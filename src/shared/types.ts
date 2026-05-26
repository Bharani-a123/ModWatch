import type { JsonObject } from '@devvit/web/shared';

export interface ModShift {
  shiftId: string;
  date: string;
  slotIndex: number;
  modUsername: string;
  claimedAt: number;
  notes?: string;
}

export interface HandoverNote {
  shiftId: string;
  fromMod: string;
  toMod?: string;
  writtenAt: number;
  openIncidents: string | string[];
  warnings: string[];
  freeText: string;
  usersToWatch?: string[];
  urgentNote?: string;
}

export interface Incident {
  id: string;
  title: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  createdBy: string;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  status: 'open' | 'resolved';
  linkedPostId?: string;
}

export interface PlaybookEntry {
  tag: string;
  title: string;
  body: string;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

export interface ModStats {
  modUsername: string;
  weekKey: string;
  removes: number;
  approvals: number;
  bans: number;
  warnings: number;
  handovers: number;
  lastActive: number;
  timeWorked?: number;
}

export interface WarningEntry {
  warnedBy: string;
  warnedAt: number;
  reason: string;
  linkedPostId?: string;
  shiftId?: string;
}

export type StatName =
  | 'removes'
  | 'approvals'
  | 'bans'
  | 'warnings'
  | 'handovers';

export interface OnlineModStatus {
  username: string;
  sessionStart: number;
  currentShift?: string;
  currentShiftSlotIndex?: number;
  currentShiftDate?: string;
}

export interface ChatMessage {
  id: string;
  fromMod: string;
  text: string;
  sentAt: number;
}

export type DashboardSnapshot = {
  subredditName: string;
  currentMod?: string;
  isHeadMod: boolean;
  headMod?: string;
  currentDate: string;
  currentSlotIndex: number;
  shifts: ModShift[];
  latestHandover: HandoverNote | null;
  incidents: Incident[];
  playbook: PlaybookEntry[];
  onlineMods: OnlineModStatus[];
  stats: ModStats[];
  warningsDirectory: Array<{
    username: string;
    count: number;
    latestAt?: number;
  }>;
  moderators: string[];
  expiredShiftId?: string;
};

export type DashboardEvent =
  | { type: 'refresh'; source: string; at: number }
  | { type: 'presence'; modUsername: string; online: boolean; at: number };

export type ApiResponse<T extends JsonObject> = T & { ok: true };
export type ApiError = { ok: false; error: string };
