import { RedisClient } from '@devvit/public-api';

export interface Incident {
  id: string;              // "inc_{Date.now()}"
  title: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  createdBy: string;
  createdAt: number;
  status: 'open' | 'resolved';
  resolvedAt?: number;
  resolvedBy?: string;
  linkedPostId?: string;
}

const INCIDENTS_KEY = 'incidents:active';

function capIncidents(incidents: Incident[]): Incident[] {
  if (incidents.length <= 100) {
    return incidents;
  }

  const open = incidents.filter((i) => i.status === 'open');
  const resolved = incidents.filter((i) => i.status === 'resolved');

  // Sort resolved incidents by resolution time ascending (oldest resolved first)
  resolved.sort((a, b) => (a.resolvedAt || 0) - (b.resolvedAt || 0));

  // Determine how many resolved items to drop
  const excess = incidents.length - 100;
  const resolvedToKeep = resolved.slice(excess);

  const combined = [...open, ...resolvedToKeep];
  
  // Maintain chronological order for combined results, capped at 100
  return combined.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}

export async function getIncidents(redis: RedisClient): Promise<Incident[]> {
  const raw = await redis.get(INCIDENTS_KEY);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as Incident[];
  } catch {
    return [];
  }
}

export async function getOpenIncidents(redis: RedisClient): Promise<Incident[]> {
  const list = await getIncidents(redis);
  return list.filter((i) => i.status === 'open');
}

export async function addIncident(
  redis: RedisClient,
  data: Omit<Incident, 'id' | 'createdAt' | 'status'>
): Promise<Incident> {
  const newIncident: Incident = {
    ...data,
    id: `inc_${Date.now()}`,
    createdAt: Date.now(),
    status: 'open',
  };

  const list = await getIncidents(redis);
  list.unshift(newIncident); // Prepend new incident
  
  const capped = capIncidents(list);
  await redis.set(INCIDENTS_KEY, JSON.stringify(capped));
  
  return newIncident;
}

export async function resolveIncident(
  redis: RedisClient,
  incidentId: string,
  resolvedBy: string
): Promise<void> {
  const list = await getIncidents(redis);
  const updated = list.map((i) => {
    if (i.id === incidentId) {
      return {
        ...i,
        status: 'resolved' as const,
        resolvedAt: Date.now(),
        resolvedBy,
      };
    }
    return i;
  });

  const capped = capIncidents(updated);
  await redis.set(INCIDENTS_KEY, JSON.stringify(capped));
}

export async function pruneOldIncidents(redis: RedisClient): Promise<void> {
  const list = await getIncidents(redis);
  const cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48 hours ago
  
  const filtered = list.filter((i) => {
    if (i.status === 'open') {
      return true;
    }
    return (i.resolvedAt || 0) >= cutoff;
  });

  await redis.set(INCIDENTS_KEY, JSON.stringify(filtered));
}
