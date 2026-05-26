type RedisClient = typeof import('@devvit/redis').redis;
import type { Incident } from '../../shared/types.js';
import { getJson, setJson } from '../lib/redis-json.js';

const INCIDENTS_KEY = 'incidents:active';

async function writeIncidents(
  redis: RedisClient,
  incidents: Incident[]
): Promise<void> {
  const capped = [...incidents]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 100);
  await setJson(redis, INCIDENTS_KEY, capped);
}

export async function getIncidents(redis: RedisClient): Promise<Incident[]> {
  return (await getJson<Incident[]>(redis, INCIDENTS_KEY)) ?? [];
}

export async function getOpenIncidents(
  redis: RedisClient
): Promise<Incident[]> {
  return (await getIncidents(redis))
    .filter((incident) => incident.status === 'open')
    .sort((left, right) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return (
        severityOrder[left.severity] - severityOrder[right.severity] ||
        right.createdAt - left.createdAt
      );
    });
}

export async function addIncident(
  redis: RedisClient,
  incident: Omit<Incident, 'id' | 'createdAt' | 'status'>
): Promise<Incident> {
  const next: Incident = {
    ...incident,
    id: `inc_${Date.now()}`,
    createdAt: Date.now(),
    status: 'open',
  };
  const incidents = await getIncidents(redis);
  incidents.unshift(next);
  await writeIncidents(redis, incidents);
  return next;
}

export async function resolveIncident(
  redis: RedisClient,
  incidentId: string,
  resolvedBy: string
): Promise<void> {
  const incidents = await getIncidents(redis);
  const now = Date.now();
  await writeIncidents(
    redis,
    incidents.map((incident) =>
      incident.id === incidentId
        ? { ...incident, status: 'resolved', resolvedAt: now, resolvedBy }
        : incident
    )
  );
}

export async function pruneOldIncidents(redis: RedisClient): Promise<void> {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const incidents = await getIncidents(redis);
  await writeIncidents(
    redis,
    incidents.filter(
      (incident) =>
        incident.status === 'open' || (incident.resolvedAt ?? 0) >= cutoff
    )
  );
}

export async function deleteIncident(
  redis: RedisClient,
  incidentId: string
): Promise<void> {
  const incidents = await getIncidents(redis);
  const next = incidents.filter((incident) => incident.id !== incidentId);
  await writeIncidents(redis, next);
}

export async function updateIncident(
  redis: RedisClient,
  incidentId: string,
  updates: Partial<Omit<Incident, 'id' | 'createdAt'>>
): Promise<void> {
  const incidents = await getIncidents(redis);
  const next = incidents.map((incident) =>
    incident.id === incidentId
      ? { ...incident, ...updates }
      : incident
  );
  await writeIncidents(redis, next);
}
