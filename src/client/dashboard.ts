import { connectRealtime, context, showToast } from '@devvit/web/client';
import type {
  ApiError,
  DashboardEvent,
  DashboardSnapshot,
  WarningEntry,
  ChatMessage,
} from '../shared/types.js';
import {
  addDays,
  getCurrentDateAndSlot,
} from '../shared/time.js';

function initTheme(): void {
  const saved = localStorage.getItem('modwatch-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  }
}

function toggleTheme(): void {
  const isDark = document.documentElement.classList.contains('dark');
  if (isDark) {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    localStorage.setItem('modwatch-theme', 'light');
  } else {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
    localStorage.setItem('modwatch-theme', 'dark');
  }
  render();
}

initTheme();

type TabKey =
  | 'schedule'
  | 'handover'
  | 'incidents'
  | 'playbook'
  | 'stats'
  | 'warnings';

type State = {
  snapshot?: DashboardSnapshot;
  activeTab: TabKey;
  loading: boolean;
  modal?: string;
  warningHistory: { username: string; warnings: WarningEntry[] } | undefined;
  date: string;
  chatMessages?: ChatMessage[];
  skippedHandoverShiftId?: string;
  autoHandoverPopupOpen?: boolean;
};

const appRoot = document.querySelector<HTMLDivElement>('#app');

if (!appRoot) {
  throw new Error('App root missing.');
}
const root = appRoot;

const state: State = {
  activeTab: 'schedule',
  loading: true,
  warningHistory: undefined,
  date: getCurrentDateAndSlot(new Date()).date,
};

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json()) as ({ ok: true } & T) | ApiError;
  if (!payload.ok) {
    throw new Error(payload.error);
  }
  return payload as T;
}

function slotIndexToLocalTime(dateStr: string, slotIndex: number): string {
  const startMinutes = slotIndex * 30;
  const startHour = Math.floor(startMinutes / 60);
  const startMin = startMinutes % 60;
  
  const parts = dateStr.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  
  const utcDate = new Date(Date.UTC(year, month, day, startHour, startMin));
  const localStartHour = utcDate.getHours();
  const localStartMin = utcDate.getMinutes();
  
  const utcEndDate = new Date(utcDate.getTime() + 30 * 60 * 1000);
  const localEndHour = utcEndDate.getHours();
  const localEndMin = utcEndDate.getMinutes();
  
  const padNum = (num: number) => num.toString().padStart(2, '0');
  
  return `${padNum(localStartHour)}:${padNum(localStartMin)}-${padNum(localEndHour)}:${padNum(localEndMin)}`;
}

function renderActiveModsStrip(snapshot: DashboardSnapshot): string {
  const onlineMap = new Map(snapshot.onlineMods.map((m) => [m.username, m]));
  
  const cards = snapshot.moderators
    .map((username) => {
      const onlineMod = onlineMap.get(username);
      if (onlineMod) {
        const durationMin = Math.max(0, Math.floor((Date.now() - onlineMod.sessionStart) / 60000));
        const shiftText = onlineMod.currentShiftSlotIndex !== undefined && onlineMod.currentShiftDate !== undefined
          ? `On shift ${slotIndexToLocalTime(onlineMod.currentShiftDate, onlineMod.currentShiftSlotIndex)}`
          : 'Browsing';
        return `
          <div class="mod-card online">
            <div class="pulsing-dot"></div>
            <div>
              <strong>u/${username}</strong>
              <div class="muted" style="font-size: 11px; margin-top: 2px;">${shiftText} • Online ${durationMin}m</div>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="mod-card offline" style="opacity: 0.6;">
            <div class="gray-dot"></div>
            <div>
              <strong>u/${username}</strong>
              <div class="muted" style="font-size: 11px; margin-top: 2px;">Offline</div>
            </div>
          </div>
        `;
      }
    })
    .join('');

  const warningBar = snapshot.onlineMods.length === 0
    ? `<div class="active-mods-strip warning" style="margin-top: 8px;">No mods currently online — subreddit is unwatched</div>`
    : '';

  return `
    <div style="font-weight: bold; margin-bottom: 8px; font-size: 14px;">Team Presence</div>
    <div class="active-mods-strip" style="margin-bottom: 0;">${cards}</div>
    ${warningBar}
  `;
}

function render(): void {
  if (state.loading) {
    root.innerHTML = `<div class="app"><div class="hero"><h1>ModWatch</h1><p class="muted">Loading dashboard...</p></div></div>`;
    return;
  }

  if (!state.snapshot) {
    root.innerHTML = `<div class="app"><div class="hero"><h1>ModWatch</h1><p class="muted">No data available.</p></div></div>`;
    return;
  }

  const snapshot = state.snapshot;
  const tabs: Array<{ key: TabKey; label: string; hidden?: boolean }> = [
    { key: 'schedule', label: 'Schedule' },
    { key: 'handover', label: 'Handover' },
    { key: 'incidents', label: 'Incidents' },
    { key: 'playbook', label: 'Playbook' },
    { key: 'stats', label: 'Stats', hidden: !snapshot.isHeadMod },
    { key: 'warnings', label: 'Warnings', hidden: !snapshot.isHeadMod },
  ];

  const chatInput = document.querySelector<HTMLInputElement>('#chat-input');
  const isChatInputFocused = chatInput === document.activeElement;
  const chatValue = chatInput ? chatInput.value : '';

  const isDark = document.documentElement.classList.contains('dark');
  const themeLabel = isDark ? '☀️ Light' : '🌙 Dark';

  root.innerHTML = `
    <div class="app">
      <div class="hero">
        <div class="hero-meta">
          <span class="pill">r/${snapshot.subredditName}</span>
          <span class="pill">${snapshot.currentMod ? `u/${snapshot.currentMod}` : 'Guest view'}</span>
          <span class="pill">${snapshot.headMod ? `Head mod: u/${snapshot.headMod}` : 'Head mod unknown'}</span>
          <span class="pill">${state.date}</span>
          <button class="btn secondary" id="theme-toggle-btn" style="padding: 4px 8px; font-size: 11px; border-radius: 8px; cursor: pointer;">${themeLabel}</button>
        </div>
        <div>
          <h1>ModWatch</h1>
          <p class="muted">Shift coverage, handovers, incidents, warnings, and team memory in one place.</p>
        </div>
        ${renderActiveModsStrip(snapshot)}
        <div class="tabs">
          ${tabs
            .filter((tab) => !tab.hidden)
            .map(
              (tab) => `
                <button class="tab ${state.activeTab === tab.key ? 'active' : ''}" data-tab="${tab.key}">
                  ${tab.label}
                </button>
              `
            )
            .join('')}
        </div>
      </div>
      <div class="grid">
        <div class="panel">${renderMain(snapshot)}</div>
        <div class="panel">${renderSidebar(snapshot)}</div>
      </div>
      <div class="modal-backdrop" id="modal"></div>
    </div>

    <div class="handover-overlay ${state.autoHandoverPopupOpen ? 'open' : ''}" id="auto-handover-popup-overlay">
      <div class="handover-popup-box">
        <h2>Your shift just ended — leave a handover note</h2>
        <p class="muted" style="margin-bottom: 20px;">Please provide a quick summary to keep the mod team coordinated.</p>
        
        <div class="field">
          <label style="font-weight: bold; margin-bottom: 4px; display: block;">What happened this shift? *</label>
          <textarea id="auto-handover-text" rows="4" placeholder="Describe key events, bans, appeals..."></textarea>
        </div>
        
        <div class="field" style="margin-top: 14px;">
          <label style="font-weight: bold; margin-bottom: 4px; display: block;">Any users to watch? (comma-separated)</label>
          <input id="auto-handover-warnings" placeholder="username1, username2" />
        </div>
        
        <div class="field" style="margin-top: 14px;">
          <label style="font-weight: bold; margin-bottom: 4px; display: block;">Open incidents? (describe briefly)</label>
          <textarea id="auto-handover-incidents" rows="2" placeholder="Any unresolved issues..."></textarea>
        </div>

        <div class="field" style="margin-top: 14px;">
          <label style="font-weight: bold; margin-bottom: 4px; display: block;">Anything urgent for the next mod?</label>
          <textarea id="auto-handover-urgent" rows="2" placeholder="Immediate attention needed..."></textarea>
        </div>

        <div class="toolbar" style="margin-top: 24px; justify-content: flex-end; gap: 12px;">
          <button class="btn warn" id="auto-handover-submit-btn">Submit handover</button>
          <button class="btn secondary" id="auto-handover-skip-btn" style="color: var(--muted); background: var(--btn-secondary-bg);">Skip (not recommended)</button>
        </div>
      </div>
    </div>
  `;

  wireEvents();

  if (isChatInputFocused) {
    const newChatInput = document.querySelector<HTMLInputElement>('#chat-input');
    if (newChatInput) {
      newChatInput.value = chatValue;
      newChatInput.focus();
      newChatInput.setSelectionRange(chatValue.length, chatValue.length);
    }
  }

  const chatMessagesBox = document.getElementById('chat-messages-box');
  if (chatMessagesBox) {
    chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;
  }
}

function renderMain(snapshot: DashboardSnapshot): string {
  switch (state.activeTab) {
    case 'schedule':
      return renderSchedule(snapshot);
    case 'handover':
      return renderHandover(snapshot);
    case 'incidents':
      return renderIncidents(snapshot);
    case 'playbook':
      return renderPlaybook(snapshot);
    case 'stats':
      return renderStats(snapshot);
    case 'warnings':
      return renderWarnings(snapshot);
    default:
      return '';
  }
}

function renderChatPanel(snapshot: DashboardSnapshot): string {
  const messagesHtml = (state.chatMessages ?? [])
    .map((msg) => {
      const isSelf = msg.fromMod === snapshot.currentMod;
      const sentTime = new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="chat-message ${isSelf ? 'self' : ''}">
          <div style="font-weight: bold; font-size: 11px; margin-bottom: 2px;">u/${msg.fromMod}</div>
          <div>${escapeHtml(msg.text)}</div>
          <div class="chat-message-meta">${sentTime}</div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="chat-panel">
      <h3>Mod Chat</h3>
      <div class="chat-messages" id="chat-messages-box">
        ${messagesHtml}
      </div>
      <div class="chat-input-wrapper">
        <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off" />
        <button class="btn" id="chat-send-btn">Send</button>
      </div>
    </div>
  `;
}

function updateChatMessagesUI(messages: ChatMessage[], currentMod: string): void {
  const container = document.getElementById('chat-messages-box');
  if (!container) return;

  const shouldScroll = container.scrollHeight - container.scrollTop <= container.clientHeight + 40;

  const html = messages
    .map((msg) => {
      const isSelf = msg.fromMod === currentMod;
      const sentTime = new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="chat-message ${isSelf ? 'self' : ''}">
          <div style="font-weight: bold; font-size: 11px; margin-bottom: 2px;">u/${msg.fromMod}</div>
          <div>${escapeHtml(msg.text)}</div>
          <div class="chat-message-meta">${sentTime}</div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = html;

  if (shouldScroll) {
    container.scrollTop = container.scrollHeight;
  }
}

function renderSidebar(snapshot: DashboardSnapshot): string {
  const currentShift = snapshot.currentMod
    ? snapshot.shifts.find((shift) => shift.modUsername === snapshot.currentMod)
    : undefined;
  
  const chatHtml = renderChatPanel(snapshot);

  return `
    <section>
      <h2>Shift controls</h2>
      <p class="muted">Use heartbeat while active and leave a handover when wrapping up.</p>
      <div class="toolbar">
        <button class="btn secondary" data-action="heartbeat">Refresh heartbeat</button>
        <button class="btn warn" data-action="handover-modal" ${!currentShift ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>End shift</button>
      </div>
      ${
        currentShift
          ? `<p class="muted">Current claimed shift: ${slotIndexToLocalTime(currentShift.date, currentShift.slotIndex)} on ${currentShift.date}</p>`
          : `<p class="muted">You do not currently hold a claimed shift on the selected date.</p>`
      }
    </section>
    <section>
      <h3>Open incidents</h3>
      <div class="list">
        ${
          snapshot.incidents
            .filter((incident) => incident.status === 'open')
            .slice(0, 5)
            .map(
              (incident) => `
              <div class="incident-card">
                <div>
                  <strong>${escapeHtml(incident.title)}</strong>
                  <div class="muted">${escapeHtml(incident.detail)}</div>
                </div>
                <span class="severity ${incident.severity}">${incident.severity}</span>
              </div>
            `
            )
            .join('') || '<p class="muted">No open incidents.</p>'
        }
      </div>
    </section>
    ${chatHtml}
  `;
}

function renderSchedule(snapshot: DashboardSnapshot): string {
  const current = getCurrentDateAndSlot(new Date());
  
  // Disable previous day button if we are on the current day
  const isToday = state.date === current.date;
  const prevDisabled = isToday ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : '';

  // Generate 48 slots depending on whether we are on today (rolling queue) or a future day.
  interface ScheduleSlot {
    date: string;
    slotIndex: number;
    label: string;
  }
  
  const slots: ScheduleSlot[] = [];
  if (isToday) {
    const S = current.slotIndex;
    const tomorrow = addDays(current.date, 1);
    for (let i = S; i < 48; i++) {
      slots.push({ date: current.date, slotIndex: i, label: slotIndexToLocalTime(current.date, i) });
    }
    for (let i = 0; i < S; i++) {
      slots.push({ date: tomorrow, slotIndex: i, label: slotIndexToLocalTime(tomorrow, i) });
    }
  } else {
    for (let i = 0; i < 48; i++) {
      slots.push({ date: state.date, slotIndex: i, label: slotIndexToLocalTime(state.date, i) });
    }
  }

  // Create a shift lookup map keyed by date:slotIndex
  const shiftByKey = new Map<string, typeof snapshot.shifts[0]>();
  for (const shift of snapshot.shifts) {
    shiftByKey.set(`${shift.date}:${shift.slotIndex}`, shift);
  }

  const rows = slots.map((slot) => {
    const shift = shiftByKey.get(`${slot.date}:${slot.slotIndex}`);
    const isCurrent = current.date === slot.date && current.slotIndex === slot.slotIndex;
    
    // Format timezone/date label context if the slot wraps to tomorrow
    const dateLabel = slot.date !== state.date ? ' (Tomorrow)' : '';
    
    return `
      <div class="slot-row ${isCurrent ? 'current' : ''}">
        <div>
          <strong>${slot.label}${dateLabel}</strong>
          <div class="muted">${shift ? `Claimed by u/${shift.modUsername}` : 'Available'}</div>
        </div>
        <div class="item-actions">
          ${
            shift
              ? shift.modUsername === snapshot.currentMod || snapshot.isHeadMod
                ? `<button class="btn secondary" data-release-date="${slot.date}" data-release-slot="${slot.slotIndex}">Release</button>`
                : ''
              : `<button class="btn" data-claim-date="${slot.date}" data-claim-slot="${slot.slotIndex}">Claim</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  return `
    <h2>Shift schedule</h2>
    <div class="toolbar">
      <button class="btn secondary" data-nav-date="-1" ${prevDisabled}>Previous day</button>
      <button class="btn secondary" data-nav-date="1">Next day</button>
      <button class="btn secondary" data-nav-date="0">Today</button>
    </div>
    <div class="list">${rows}</div>
  `;
}

function renderHandover(snapshot: DashboardSnapshot): string {
  const note = snapshot.latestHandover;
  return `
    <h2>Latest handover</h2>
    ${
      note
        ? `
          <div class="incident-card">
            <strong>From u/${note.fromMod}</strong>
            <div class="muted">${new Date(note.writtenAt).toLocaleString()}</div>
            <p>${escapeHtml(note.freeText)}</p>
            <p class="muted">Warnings: ${note.warnings.join(', ') || 'None logged'}</p>
            <p class="muted">Open incidents: ${(Array.isArray(note.openIncidents) ? note.openIncidents : [note.openIncidents]).join(', ') || 'None referenced'}</p>
          </div>
        `
        : '<p class="muted">No handover note found in the last three shifts.</p>'
    }
  `;
}

function renderIncidents(snapshot: DashboardSnapshot): string {
  const incidents = snapshot.incidents;
  return `
    <h2>Incident tracker</h2>
    <div class="toolbar">
      <button class="btn" data-action="incident-modal">Add incident</button>
    </div>
    <div class="list">
      ${incidents
        .map(
          (incident) => `
            <div class="incident-card">
              <div>
                <strong>${escapeHtml(incident.title)}</strong>
                <div class="muted">${escapeHtml(incident.detail)}</div>
                <div class="muted">Opened by u/${incident.createdBy}</div>
              </div>
              <div class="item-actions" style="display: flex; gap: 8px; align-items: center;">
                <span class="severity ${incident.severity}">${incident.severity}</span>
                <button class="btn secondary" data-edit-incident="${incident.id}">Edit</button>
                <button class="btn danger" data-delete-incident="${incident.id}">Delete</button>
                ${
                  incident.status === 'open'
                    ? `<button class="btn secondary" data-resolve-incident="${incident.id}">Resolve</button>`
                    : `<span class="muted">Resolved</span>`
                }
              </div>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function renderPlaybook(snapshot: DashboardSnapshot): string {
  return `
    <h2>Playbook</h2>
    <div class="toolbar">
      <button class="btn" data-action="playbook-modal">Add entry</button>
    </div>
    <div class="list">
      ${
        snapshot.playbook
          .map(
            (entry) => `
            <div class="playbook-card">
              <div>
                <strong>${escapeHtml(entry.title)}</strong>
                <div class="muted">#${escapeHtml(entry.tag)}</div>
                <p>${escapeHtml(entry.body)}</p>
              </div>
              <div class="item-actions">
                <button class="btn secondary" data-edit-playbook="${entry.tag}">Edit</button>
                <button class="btn danger" data-delete-playbook="${entry.tag}">Delete</button>
              </div>
            </div>
          `
          )
          .join('') || '<p class="muted">No playbook entries yet.</p>'
      }
    </div>
  `;
}

function renderStats(snapshot: DashboardSnapshot): string {
  const stats = snapshot.stats;
  
  if (stats.length === 0) {
    return `
      <h2>Weekly mod stats</h2>
      <p class="muted">No stats recorded for this week yet.</p>
    `;
  }
  
  // Calculate totals
  const totalRemoves = stats.reduce((sum, s) => sum + s.removes, 0);
  const totalApprovals = stats.reduce((sum, s) => sum + s.approvals, 0);
  const totalBans = stats.reduce((sum, s) => sum + s.bans, 0);
  const totalWarnings = stats.reduce((sum, s) => sum + s.warnings, 0);
  const totalHandovers = stats.reduce((sum, s) => sum + s.handovers, 0);
  const totalActions = totalRemoves + totalApprovals + totalBans + totalWarnings;
  
  const totalTimeWorkedMs = stats.reduce((sum, s) => sum + (s.timeWorked ?? 0), 0);
  const totalHoursWorked = (totalTimeWorkedMs / (1000 * 60 * 60)).toFixed(1);
  
  // Find top contributors
  const maxActions = Math.max(...stats.map(s => s.removes + s.approvals + s.bans + s.warnings), 1);

  // Render stats cards
  const cardsHtml = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 14px; margin-bottom: 24px;">
      <div class="panel-strong" style="padding: 14px; border-radius: 16px; border: 1px solid var(--line); background: var(--card-bg); text-align: center;">
        <div class="muted" style="font-size: 12px; font-weight: bold; text-transform: uppercase;">Total Hours</div>
        <div style="font-size: 24px; font-weight: bold; color: var(--brand); margin-top: 6px;">${totalHoursWorked}h</div>
      </div>
      <div class="panel-strong" style="padding: 14px; border-radius: 16px; border: 1px solid var(--line); background: var(--card-bg); text-align: center;">
        <div class="muted" style="font-size: 12px; font-weight: bold; text-transform: uppercase;">Mod Actions</div>
        <div style="font-size: 24px; font-weight: bold; color: var(--brand); margin-top: 6px;">${totalActions}</div>
      </div>
      <div class="panel-strong" style="padding: 14px; border-radius: 16px; border: 1px solid var(--line); background: var(--card-bg); text-align: center;">
        <div class="muted" style="font-size: 12px; font-weight: bold; text-transform: uppercase;">Handovers</div>
        <div style="font-size: 24px; font-weight: bold; color: var(--brand); margin-top: 6px;">${totalHandovers}</div>
      </div>
    </div>
  `;

  // Render bar charts using vanilla CSS & flexbox
  const modActionsChart = stats.map(s => {
    const actions = s.removes + s.approvals + s.bans + s.warnings;
    const percentage = Math.round((actions / maxActions) * 100);
    const hours = ((s.timeWorked ?? 0) / (1000 * 60 * 60)).toFixed(1);
    
    return `
      <div style="margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
          <strong>u/${s.modUsername}</strong>
          <span class="muted">${actions} actions • ${hours}h worked</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <div style="flex: 1; height: 16px; background: var(--tab-bg); border-radius: 999px; overflow: hidden; border: 1px solid var(--line);">
            <div style="width: ${percentage}%; height: 100%; background: var(--brand-grad); border-radius: 999px;"></div>
          </div>
          <span style="font-size: 12px; width: 30px; text-align: right; font-weight: bold;">${percentage}%</span>
        </div>
      </div>
    `;
  }).join('');

  // Render detailed table/breakdown
  const rowsHtml = stats.map(s => {
    const hours = ((s.timeWorked ?? 0) / (1000 * 60 * 60)).toFixed(1);
    return `
      <tr style="border-bottom: 1px solid var(--line);">
        <td style="padding: 10px 6px; font-weight: bold;">u/${s.modUsername}</td>
        <td style="padding: 10px 6px; text-align: center;">${hours}h</td>
        <td style="padding: 10px 6px; text-align: center; color: var(--brand-deep);">${s.approvals}</td>
        <td style="padding: 10px 6px; text-align: center; color: var(--danger);">${s.removes}</td>
        <td style="padding: 10px 6px; text-align: center; color: var(--danger); font-weight: bold;">${s.bans}</td>
        <td style="padding: 10px 6px; text-align: center; color: var(--warning);">${s.warnings}</td>
        <td style="padding: 10px 6px; text-align: center;">${s.handovers}</td>
      </tr>
    `;
  }).join('');

  return `
    <h2>Weekly team performance</h2>
    <p class="muted" style="margin-bottom: 20px;">Review moderator contributions, shift hours, and actions for week ${stats[0]?.weekKey ?? ''}.</p>
    
    ${cardsHtml}
    
    <div class="panel-strong" style="background: var(--panel-strong); border: 1px solid var(--line); border-radius: 20px; padding: 20px; box-shadow: var(--shadow); margin-bottom: 24px;">
      <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 16px;">Contribution Comparison</h3>
      ${modActionsChart}
    </div>

    <div class="panel-strong" style="background: var(--panel-strong); border: 1px solid var(--line); border-radius: 20px; padding: 20px; box-shadow: var(--shadow); overflow-x: auto;">
      <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 16px;">Detailed Breakdown</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 2px solid var(--line); text-align: left;">
            <th style="padding: 8px 6px;">Moderator</th>
            <th style="padding: 8px 6px; text-align: center;">Hours</th>
            <th style="padding: 8px 6px; text-align: center;">Approvals</th>
            <th style="padding: 8px 6px; text-align: center;">Removes</th>
            <th style="padding: 8px 6px; text-align: center;">Bans</th>
            <th style="padding: 8px 6px; text-align: center;">Warnings</th>
            <th style="padding: 8px 6px; text-align: center;">Handovers</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

function renderWarnings(snapshot: DashboardSnapshot): string {
  return `
    <h2>Warning history</h2>
    <div class="list">
      ${
        snapshot.warningsDirectory
          .map(
            (entry) => `
            <div class="warning-row">
              <div>
                <strong>u/${entry.username}</strong>
                <div class="muted">${entry.count} warning(s)</div>
              </div>
              <div class="item-actions">
                <button class="btn secondary" data-view-warnings="${entry.username}">View</button>
                <button class="btn danger" data-clear-warnings="${entry.username}">Clear</button>
              </div>
            </div>
          `
          )
          .join('') || '<p class="muted">No warning history stored.</p>'
      }
      ${
        state.warningHistory
          ? `
            <section>
              <h3>u/${state.warningHistory.username}</h3>
              <div class="list">
                ${state.warningHistory.warnings
                  .map(
                    (warning) => `
                      <div class="incident-card">
                        <strong>${escapeHtml(warning.reason)}</strong>
                        <div class="muted">By u/${warning.warnedBy} at ${new Date(warning.warnedAt).toLocaleString()}</div>
                      </div>
                    `
                  )
                  .join('')}
              </div>
            </section>
          `
          : ''
      }
    </div>
  `;
}

function wireEvents(): void {
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.onclick = () => {
      state.activeTab = button.dataset.tab as TabKey;
      render();
    };
  });

  const themeBtn = root.querySelector<HTMLButtonElement>('#theme-toggle-btn');
  if (themeBtn) {
    themeBtn.onclick = () => {
      toggleTheme();
    };
  }

  root
    .querySelectorAll<HTMLButtonElement>('[data-claim-slot]')
    .forEach((button) => {
      button.onclick = async () => {
        const date = button.dataset.claimDate ?? state.date;
        await api('/shifts/claim', {
          method: 'POST',
          body: JSON.stringify({
            date,
            slotIndex: Number(button.dataset.claimSlot),
          }),
        });
        await refresh();
      };
    });

  root
    .querySelectorAll<HTMLButtonElement>('[data-release-slot]')
    .forEach((button) => {
      button.onclick = async () => {
        const date = button.dataset.releaseDate ?? state.date;
        await api('/shifts/release', {
          method: 'POST',
          body: JSON.stringify({
            date,
            slotIndex: Number(button.dataset.releaseSlot),
          }),
        });
        await refresh();
      };
    });

  root
    .querySelectorAll<HTMLButtonElement>('[data-nav-date]')
    .forEach((button) => {
      button.onclick = async () => {
        const delta = Number(button.dataset.navDate);
        const current = getCurrentDateAndSlot(new Date());
        let targetDate: string;
        if (delta === 0) {
          targetDate = current.date;
        } else {
          targetDate = addDays(state.date, delta);
        }
        if (targetDate < current.date) {
          return;
        }
        state.date = targetDate;
        await refresh();
      };
    });

  // Auto handover modal submit & skip
  const autoHandoverSubmit = root.querySelector<HTMLButtonElement>('#auto-handover-submit-btn');
  const autoHandoverSkip = root.querySelector<HTMLButtonElement>('#auto-handover-skip-btn');

  if (autoHandoverSubmit) {
    autoHandoverSubmit.onclick = async () => {
      const shiftId = state.snapshot?.expiredShiftId;
      if (!shiftId) return;

      const freeText = valueOf('auto-handover-text');
      if (!freeText) {
        showToast('What happened this shift is required.');
        return;
      }

      const warningsStr = valueOf('auto-handover-warnings');
      const incidentsStr = valueOf('auto-handover-incidents');
      const urgentNote = valueOf('auto-handover-urgent');

      try {
        await api('/handover', {
          method: 'POST',
          body: JSON.stringify({
            shiftId,
            freeText,
            warnings: csv(warningsStr),
            openIncidents: csv(incidentsStr),
            usersToWatch: csv(warningsStr),
            urgentNote,
          }),
        });
        await api('/presence/offline', { method: 'POST' });
        state.autoHandoverPopupOpen = false;
        showToast('Handover submitted.');
        await refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Submission failed.');
      }
    };
  }

  if (autoHandoverSkip) {
    autoHandoverSkip.onclick = () => {
      const shiftId = state.snapshot?.expiredShiftId;
      if (shiftId) {
        state.skippedHandoverShiftId = shiftId;
      }
      state.autoHandoverPopupOpen = false;
      render();
    };
  }

  // Live Chat Input & Send Events
  const chatInput = root.querySelector<HTMLInputElement>('#chat-input');
  const chatSendBtn = root.querySelector<HTMLButtonElement>('#chat-send-btn');

  const sendMessage = async () => {
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = '';

    try {
      const chatPayload = await api<{ messages: ChatMessage[] }>('/chat', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      state.chatMessages = chatPayload.messages;
      updateChatMessagesUI(chatPayload.messages, state.snapshot?.currentMod ?? '');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to send message.');
    }
  };

  if (chatInput) {
    chatInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void sendMessage();
      }
    };
  }

  if (chatSendBtn) {
    chatSendBtn.onclick = () => {
      void sendMessage();
    };
  }

  root
    .querySelectorAll<HTMLButtonElement>('[data-resolve-incident]')
    .forEach((button) => {
      button.onclick = async () => {
        await api(`/incidents/${button.dataset.resolveIncident}/resolve`, {
          method: 'POST',
        });
        await refresh();
      };
    });

  root
    .querySelectorAll<HTMLButtonElement>('[data-edit-playbook]')
    .forEach((button) => {
      button.onclick = () =>
        openPlaybookModal(button.dataset.editPlaybook ?? '');
    });

  root
    .querySelectorAll<HTMLButtonElement>('[data-delete-playbook]')
    .forEach((button) => {
      button.onclick = async () => {
        await api(`/playbook/${button.dataset.deletePlaybook}`, {
          method: 'DELETE',
        });
        await refresh();
      };
    });

  root
    .querySelectorAll<HTMLButtonElement>('[data-view-warnings]')
    .forEach((button) => {
      button.onclick = async () => {
        const username = button.dataset.viewWarnings ?? '';
        const payload = await api<{ warnings: WarningEntry[] }>(
          `/warnings/${username}`
        );
        state.warningHistory = { username, warnings: payload.warnings };
        render();
      };
    });

  root
    .querySelectorAll<HTMLButtonElement>('[data-clear-warnings]')
    .forEach((button) => {
      button.onclick = async () => {
        await api(`/warnings/${button.dataset.clearWarnings}`, {
          method: 'DELETE',
        });
        state.warningHistory = undefined;
        await refresh();
      };
    });

  root
    .querySelectorAll<HTMLButtonElement>('[data-action]')
    .forEach((button) => {
      const action = button.dataset.action;
      if (action === 'incident-modal') {
        button.onclick = () => openIncidentModal();
      } else if (action === 'playbook-modal') {
        button.onclick = () => openPlaybookModal();
      } else if (action === 'handover-modal') {
        button.onclick = () => openHandoverModal();
      } else if (action === 'heartbeat') {
        button.onclick = async () => {
          await api('/presence/heartbeat', { method: 'POST' });
          showToast('Heartbeat refreshed.');
          await refresh(false);
        };
      }
    });

  root
    .querySelectorAll<HTMLButtonElement>('[data-edit-incident]')
    .forEach((button) => {
      button.onclick = () => {
        openIncidentModal(button.dataset.editIncident ?? '');
      };
    });

  root
    .querySelectorAll<HTMLButtonElement>('[data-delete-incident]')
    .forEach((button) => {
      button.onclick = async () => {
        await api(`/incidents/${button.dataset.deleteIncident}`, {
          method: 'DELETE',
        });
        await refresh();
      };
    });
}

function setModal(content: string): void {
  const modal = root.querySelector<HTMLDivElement>('#modal');
  if (!modal) {
    return;
  }

  modal.className = 'modal-backdrop open';
  modal.innerHTML = `<div class="modal">${content}</div>`;
  modal.onclick = (event) => {
    if (event.target === modal) {
      closeModal();
    }
  };
}

function closeModal(): void {
  const modal = root.querySelector<HTMLDivElement>('#modal');
  if (!modal) {
    return;
  }
  modal.className = 'modal-backdrop';
  modal.innerHTML = '';
}

function openIncidentModal(id?: string): void {
  const incident = id
    ? state.snapshot?.incidents.find((item) => item.id === id)
    : undefined;

  setModal(`
    <h3>${incident ? 'Edit' : 'Add'} incident</h3>
    <div class="field"><label>Title</label><input id="incident-title" value="${escapeAttribute(incident?.title ?? '')}" /></div>
    <div class="field"><label>Detail</label><textarea id="incident-detail" rows="4">${escapeHtml(incident?.detail ?? '')}</textarea></div>
    <div class="field">
      <label>Severity</label>
      <select id="incident-severity">
        <option value="high" ${incident?.severity === 'high' ? 'selected' : ''}>high</option>
        <option value="medium" ${incident?.severity === 'medium' || !incident ? 'selected' : ''}>medium</option>
        <option value="low" ${incident?.severity === 'low' ? 'selected' : ''}>low</option>
      </select>
    </div>
    <div class="toolbar">
      <button class="btn" id="incident-save">Save</button>
      <button class="btn secondary" id="modal-cancel">Cancel</button>
    </div>
  `);
  bindModalButtons(async () => {
    const url = incident ? `/incidents/${incident.id}` : '/incidents';
    await api(url, {
      method: 'POST',
      body: JSON.stringify({
        title: valueOf('incident-title'),
        detail: valueOf('incident-detail'),
        severity: valueOf('incident-severity'),
      }),
    });
    closeModal();
    await refresh();
  });
}

function openPlaybookModal(tag?: string): void {
  const entry = tag
    ? state.snapshot?.playbook.find((item) => item.tag === tag)
    : undefined;
  setModal(`
    <h3>${entry ? 'Edit' : 'Add'} playbook entry</h3>
    <div class="field"><label>Tag</label><input id="playbook-tag" value="${escapeAttribute(entry?.tag ?? '')}" ${entry ? 'readonly' : ''} /></div>
    <div class="field"><label>Title</label><input id="playbook-title" value="${escapeAttribute(entry?.title ?? '')}" /></div>
    <div class="field"><label>Body</label><textarea id="playbook-body" rows="7">${escapeHtml(entry?.body ?? '')}</textarea></div>
    <div class="toolbar">
      <button class="btn" id="playbook-save">Save</button>
      <button class="btn secondary" id="modal-cancel">Cancel</button>
    </div>
  `);
  bindModalButtons(async () => {
    await api('/playbook', {
      method: 'POST',
      body: JSON.stringify({
        tag: valueOf('playbook-tag'),
        title: valueOf('playbook-title'),
        body: valueOf('playbook-body'),
      }),
    });
    closeModal();
    await refresh();
  }, 'playbook-save');
}

function openHandoverModal(): void {
  const shift = state.snapshot?.shifts.find(
    (entry) => entry.modUsername === state.snapshot?.currentMod
  );
  if (!shift) {
    showToast('Claim a shift before ending it.');
    return;
  }

  setModal(`
    <h3>Shift handover</h3>
    <div class="field"><label>What should the next mod know?</label><textarea id="handover-text" rows="5"></textarea></div>
    <div class="field"><label>Usernames warned (comma-separated)</label><input id="handover-warnings" /></div>
    <div class="field"><label>Open incident IDs (comma-separated)</label><input id="handover-incidents" /></div>
    <div class="toolbar">
      <button class="btn warn" id="handover-save">End shift</button>
      <button class="btn secondary" id="modal-cancel">Cancel</button>
    </div>
  `);
  bindModalButtons(async () => {
    await api('/handover', {
      method: 'POST',
      body: JSON.stringify({
        shiftId: shift.shiftId,
        freeText: valueOf('handover-text'),
        warnings: csv(valueOf('handover-warnings')),
        openIncidents: csv(valueOf('handover-incidents')),
      }),
    });
    await api('/presence/offline', { method: 'POST' });
    closeModal();
    await refresh();
  }, 'handover-save');
}

function bindModalButtons(
  onSave: () => Promise<void>,
  saveId = 'incident-save'
): void {
  const saveButton = document.getElementById(
    saveId
  ) as HTMLButtonElement | null;
  const cancelButton = document.getElementById(
    'modal-cancel'
  ) as HTMLButtonElement | null;
  saveButton?.addEventListener('click', async () => {
    try {
      await onSave();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Request failed.');
    }
  });
  cancelButton?.addEventListener('click', () => closeModal());
}

function valueOf(id: string): string {
  const element = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;
  return element?.value.trim() ?? '';
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;');
}

async function refresh(withHeartbeat = true): Promise<void> {
  const current = getCurrentDateAndSlot(new Date());
  if (state.date < current.date) {
    state.date = current.date;
  }
  const isInitial = !state.snapshot;
  if (isInitial) {
    state.loading = true;
    render();
  }
  if (withHeartbeat) {
    try {
      await api('/presence/heartbeat', { method: 'POST' });
    } catch {
      // Ignore heartbeat failures during initial loading.
    }
  }
  const payload = await api<{ snapshot: DashboardSnapshot }>(`/snapshot?date=${encodeURIComponent(state.date)}`);
  state.snapshot = payload.snapshot;

  try {
    const chatPayload = await api<{ messages: ChatMessage[] }>('/chat');
    state.chatMessages = chatPayload.messages;
  } catch {
    // Ignore chat load errors
  }

  if (payload.snapshot.expiredShiftId && state.skippedHandoverShiftId !== payload.snapshot.expiredShiftId) {
    state.autoHandoverPopupOpen = true;
  } else {
    state.autoHandoverPopupOpen = false;
  }

  if (isInitial) {
    state.loading = false;
  }
  render();
}

connectRealtime<DashboardEvent>({
  channel: context.postId,
  onMessage: async () => {
    await refresh(false);
  },
});

// Periodic heartbeat & snapshot refresh (every 60 seconds)
setInterval(async () => {
  try {
    await api('/presence/heartbeat', { method: 'POST' });
  } catch {
    // Silent heartbeat retry.
  }
  try {
    await refresh(false);
  } catch {
    // Silent refresh retry.
  }
}, 60_000);

// Poll chat messages every 10 seconds
setInterval(async () => {
  if (state.snapshot) {
    try {
      const chatPayload = await api<{ messages: ChatMessage[] }>('/chat');
      state.chatMessages = chatPayload.messages;
      updateChatMessagesUI(chatPayload.messages, state.snapshot.currentMod ?? '');
    } catch {
      // Silent chat poll fail
    }
  }
}, 10_000);

void refresh();
