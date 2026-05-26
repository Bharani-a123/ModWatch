import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Hono();

// Mock database in memory
const moderators = ["admin_mod", "mod_alpha", "mod_beta", "mod_gamma"];

const pad = (value) => value.toString().padStart(2, '0');
function formatDateUtc(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
function getSlotIndexFromDate(date) {
  return date.getUTCHours() * 2 + (date.getUTCMinutes() >= 30 ? 1 : 0);
}
function getWeekKey(date) {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000) + 1) / 7
  );
  return `${target.getUTCFullYear()}-${pad(week)}`;
}

const todayStr = formatDateUtc(new Date());

let shifts = [
  {
    shiftId: `${todayStr}:10`,
    date: todayStr,
    slotIndex: 10,
    modUsername: "mod_alpha",
    claimedAt: Date.now() - 3600000,
    notes: "Alpha morning coverage"
  },
  {
    shiftId: `${todayStr}:18`,
    date: todayStr,
    slotIndex: 18,
    modUsername: "mod_beta",
    claimedAt: Date.now() - 1800000,
    notes: "Beta mid-day shift"
  }
];

let incidents = [
  {
    id: "inc_1",
    title: "Spam Bot Attack",
    detail: "Mass posting of crypto spam links in multiple threads. Automod rules updated.",
    severity: "high",
    createdBy: "mod_alpha",
    createdAt: Date.now() - 7200000,
    status: "open",
    linkedPostId: "t3_spambot1"
  },
  {
    id: "inc_2",
    title: "Brigading from external link",
    detail: "Cross-post causing flame war. Locked the thread.",
    severity: "medium",
    createdBy: "mod_beta",
    createdAt: Date.now() - 3600000,
    status: "open",
    linkedPostId: "t3_brigade2"
  }
];

let playbook = [
  {
    tag: "raid",
    title: "Raid / Brigading Protocol",
    body: "1. Lock the affected threads immediately.\n2. Ban the orchestrators and report to admins.\n3. Increase AutoModerator action strength.",
    createdBy: "admin_mod",
    updatedAt: Date.now() - 86400000,
    updatedBy: "admin_mod"
  },
  {
    tag: "spam",
    title: "Crypto / T-shirt Spam handling",
    body: "1. Remove the post.\n2. Add domain to spam filter.\n3. Permanent ban the user.",
    createdBy: "admin_mod",
    updatedAt: Date.now() - 86400000,
    updatedBy: "admin_mod"
  }
];

let warnings = {
  "troll_user_1": [
    {
      warnedBy: "mod_alpha",
      warnedAt: Date.now() - 172800000,
      reason: "Excessive trolling and instigating arguments (minor)"
    }
  ],
  "spammer_bob": [
    {
      warnedBy: "mod_beta",
      warnedAt: Date.now() - 86400000,
      reason: "Self promotion without active participation (serious)"
    }
  ]
};

let stats = [
  {
    modUsername: "admin_mod",
    weekKey: getWeekKey(new Date()),
    removes: 42,
    approvals: 56,
    bans: 8,
    warnings: 12,
    handovers: 5,
    lastActive: Date.now(),
    timeWorked: 28800000 // 8 hours
  },
  {
    modUsername: "mod_alpha",
    weekKey: getWeekKey(new Date()),
    removes: 25,
    approvals: 34,
    bans: 3,
    warnings: 5,
    handovers: 3,
    lastActive: Date.now(),
    timeWorked: 18000000 // 5 hours
  },
  {
    modUsername: "mod_beta",
    weekKey: getWeekKey(new Date()),
    removes: 19,
    approvals: 22,
    bans: 1,
    warnings: 3,
    handovers: 2,
    lastActive: Date.now(),
    timeWorked: 10800000 // 3 hours
  }
];

let chatMessages = [
  {
    id: "msg_1",
    fromMod: "mod_alpha",
    text: "Hey team, watching the front page. Looks quiet so far.",
    sentAt: Date.now() - 600000
  },
  {
    id: "msg_2",
    fromMod: "mod_beta",
    text: "We might get some spillover from the crypto sub, keep an eye out.",
    sentAt: Date.now() - 300000
  }
];

let onlineMods = [
  {
    username: "admin_mod",
    sessionStart: Date.now() - 1800000,
    currentShift: "10:00-10:30",
    currentShiftSlotIndex: 20,
    currentShiftDate: todayStr
  },
  {
    username: "mod_alpha",
    sessionStart: Date.now() - 3600000
  }
];

let handovers = [
  {
    shiftId: `${todayStr}:10`,
    fromMod: "mod_alpha",
    toMod: "mod_beta",
    writtenAt: Date.now() - 3600000,
    openIncidents: ["inc_1"],
    warnings: ["troll_user_1"],
    freeText: "Everything is under control. I handled a minor spam bot attack.",
    usersToWatch: ["troll_user_1"],
    urgentNote: "Keep checking the pinned thread."
  }
];

// Helper to response wrapper
const ok = (val) => ({ ok: true, ...val });
const error = (msg) => ({ ok: false, error: msg });

// Static Files Serving with custom header injection for Devvit context shim
app.get('/', async (c) => {
  const filePath = path.join(__dirname, 'dist/client/dashboard.html');
  if (!fs.existsSync(filePath)) {
    return c.text("dist/client/dashboard.html not found. Please build the client first using 'npm run build'.", 404);
  }
  let html = fs.readFileSync(filePath, 'utf8');
  // Inject mock window.devvit context shim at the top of head
  const shimScript = `
  <script>
    window.devvit = {
      context: {
        postId: "t3_mock_dashboard",
        userId: "t2_mock_mod",
        username: "admin_mod"
      }
    };
  </script>
  `;
  html = html.replace('<head>', '<head>' + shimScript);
  return c.html(html);
});

app.get('/dashboard.html', async (c) => c.redirect('/'));

app.get('/default.js', async (c) => {
  const filePath = path.join(__dirname, 'dist/client/default.js');
  if (!fs.existsSync(filePath)) return c.text("default.js not found", 404);
  const js = fs.readFileSync(filePath, 'utf8');
  c.header('Content-Type', 'application/javascript');
  return c.text(js);
});

app.get('/default.css', async (c) => {
  const filePath = path.join(__dirname, 'dist/client/default.css');
  if (!fs.existsSync(filePath)) return c.text("default.css not found", 404);
  const css = fs.readFileSync(filePath, 'utf8');
  c.header('Content-Type', 'text/css');
  return c.text(css);
});

// REST API Mock Routes
app.get('/api/snapshot', (c) => {
  const dateParam = c.req.query('date') || todayStr;
  const now = new Date();
  const currentSlotIndex = getSlotIndexFromDate(now);

  const warningsDirectory = Object.entries(warnings).map(([username, list]) => ({
    username,
    count: list.length,
    latestAt: list[list.length - 1]?.warnedAt || Date.now()
  }));

  const snapshot = {
    subredditName: "education_111",
    currentMod: "admin_mod",
    isHeadMod: true,
    headMod: "admin_mod",
    currentDate: dateParam,
    currentSlotIndex: dateParam === todayStr ? currentSlotIndex : -1,
    shifts,
    latestHandover: handovers[handovers.length - 1] || null,
    incidents,
    playbook,
    onlineMods,
    stats,
    warningsDirectory,
    moderators
  };

  return c.json(ok({ snapshot }));
});

app.post('/api/presence/heartbeat', (c) => {
  const adminPresence = onlineMods.find(m => m.username === 'admin_mod');
  if (adminPresence) {
    adminPresence.sessionStart = Date.now();
  } else {
    onlineMods.push({
      username: 'admin_mod',
      sessionStart: Date.now()
    });
  }
  return c.json(ok({}));
});

app.post('/api/presence/offline', (c) => {
  onlineMods = onlineMods.filter(m => m.username !== 'admin_mod');
  return c.json(ok({}));
});

app.post('/api/shifts/claim', async (c) => {
  const body = await c.req.json();
  const { date, slotIndex, notes } = body;
  const newShift = {
    shiftId: `${date}:${slotIndex}`,
    date,
    slotIndex: Number(slotIndex),
    modUsername: "admin_mod",
    claimedAt: Date.now(),
    notes: notes || "Claimed via Mock Preview"
  };
  // Prevent duplicate claims
  shifts = shifts.filter(s => !(s.date === date && s.slotIndex === Number(slotIndex)));
  shifts.push(newShift);
  return c.json(ok({ shift: newShift }));
});

app.post('/api/shifts/release', async (c) => {
  const body = await c.req.json();
  const { date, slotIndex } = body;
  shifts = shifts.filter(s => !(s.date === date && s.slotIndex === Number(slotIndex)));
  return c.json(ok({}));
});

app.post('/api/handover', async (c) => {
  const body = await c.req.json();
  const { shiftId, freeText, warnings: warns, openIncidents, usersToWatch, urgentNote } = body;
  const note = {
    shiftId,
    fromMod: "admin_mod",
    writtenAt: Date.now(),
    openIncidents: openIncidents || [],
    warnings: warns || [],
    freeText,
    usersToWatch: usersToWatch || [],
    urgentNote: urgentNote || ""
  };
  handovers.push(note);
  return c.json(ok({}));
});

app.post('/api/incidents', async (c) => {
  const body = await c.req.json();
  const { title, detail, severity, linkedPostId } = body;
  const incident = {
    id: `inc_${Date.now()}`,
    title,
    detail,
    severity,
    createdBy: "admin_mod",
    createdAt: Date.now(),
    status: "open",
    linkedPostId: linkedPostId || ""
  };
  incidents.push(incident);
  return c.json(ok({ incident }));
});

app.post('/api/incidents/:id/resolve', (c) => {
  const id = c.req.param('id');
  const inc = incidents.find(i => i.id === id);
  if (inc) {
    inc.status = 'resolved';
    inc.resolvedBy = 'admin_mod';
    inc.resolvedAt = Date.now();
  }
  return c.json(ok({}));
});

app.post('/api/incidents/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { title, detail, severity } = body;
  const inc = incidents.find(i => i.id === id);
  if (inc) {
    inc.title = title;
    inc.detail = detail;
    inc.severity = severity;
  }
  return c.json(ok({}));
});

app.delete('/api/incidents/:id', (c) => {
  const id = c.req.param('id');
  incidents = incidents.filter(i => i.id !== id);
  return c.json(ok({}));
});

app.post('/api/playbook', async (c) => {
  const body = await c.req.json();
  const { tag, title, body: content } = body;
  const entry = {
    tag: tag.trim().toLowerCase(),
    title: title.trim(),
    body: content.trim(),
    createdBy: "admin_mod",
    updatedAt: Date.now(),
    updatedBy: "admin_mod"
  };
  playbook = playbook.filter(p => p.tag !== entry.tag);
  playbook.push(entry);
  return c.json(ok({ entry }));
});

app.delete('/api/playbook/:tag', (c) => {
  const tag = c.req.param('tag').toLowerCase();
  playbook = playbook.filter(p => p.tag !== tag);
  return c.json(ok({}));
});

app.get('/api/warnings/:username', (c) => {
  const username = c.req.param('username');
  return c.json(ok({ warnings: warnings[username] || [] }));
});

app.post('/api/warnings', async (c) => {
  const body = await c.req.json();
  const { targetUsername, reason, linkedPostId, shiftId } = body;
  const warning = {
    warnedBy: "admin_mod",
    warnedAt: Date.now(),
    reason,
    linkedPostId: linkedPostId || "",
    shiftId: shiftId || ""
  };
  if (!warnings[targetUsername]) {
    warnings[targetUsername] = [];
  }
  warnings[targetUsername].push(warning);
  return c.json(ok({ warnings: warnings[targetUsername] }));
});

app.delete('/api/warnings/:username', (c) => {
  const username = c.req.param('username');
  delete warnings[username];
  return c.json(ok({}));
});

app.get('/api/stats', (c) => {
  return c.json(ok({ stats }));
});

app.get('/api/chat', (c) => {
  return c.json(ok({ messages: chatMessages }));
});

app.post('/api/chat', async (c) => {
  const body = await c.req.json();
  const { text } = body;
  const newMessage = {
    id: `msg_${Date.now()}`,
    fromMod: "admin_mod",
    text,
    sentAt: Date.now()
  };
  chatMessages.push(newMessage);
  return c.json(ok({ messages: chatMessages }));
});

serve({
  fetch: app.fetch,
  port: 8080
}, (info) => {
  console.log(`Mock server started successfully!`);
  console.log(`Open http://localhost:${info.port} in your browser to view the Mod Tool preview.`);
});
