import { Devvit, useState, useAsync, JSONArray } from '@devvit/public-api';
import {
  Incident,
  getIncidents,
  addIncident,
  resolveIncident,
} from './redis/incidents.js';

interface IncidentViewProps {
  context: Devvit.Context;
}

export const IncidentView = (props: IncidentViewProps) => {
  const { context } = props;
  const { redis, ui, reddit } = context;

  // UI state
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [resolvedCollapsed, setResolvedCollapsed] = useState<boolean>(true);

  // Form states
  const [title, setTitle] = useState<string>('');
  const [detail, setDetail] = useState<string>('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('low');
  const [linkedPostId, setLinkedPostId] = useState<string>('');

  // Fetch current user details
  const { data: currentUser } = useAsync<{ username: string } | null>(async () => {
    const user = await reddit.getCurrentUser();
    return user ? { username: user.username } : null;
  });
  const currentMod = currentUser?.username || 'Guest';

  // Fetch active and resolved incidents
  const { data: incidentsVal } = useAsync<JSONArray>(async () => {
    const list = await getIncidents(redis);
    return list as unknown as JSONArray;
  }, { depends: [refreshCounter.toString()] });

  const incidents = (incidentsVal as unknown as Incident[]) || [];
  
  // Filter and sort open incidents by severity (high -> medium -> low)
  const openIncidents = incidents.filter((i) => i.status === 'open');
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const sortedOpenIncidents = [...openIncidents].sort((a, b) => {
    const aOrder = severityOrder[a.severity] ?? 3;
    const bOrder = severityOrder[b.severity] ?? 3;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return b.createdAt - a.createdAt; // secondary: newest first
  });

  // Filter and sort resolved incidents (last 5 resolved, newest resolved first)
  const resolvedIncidents = incidents
    .filter((i) => i.status === 'resolved')
    .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0));
  const recentResolvedIncidents = resolvedIncidents.slice(0, 5);

  const toggleExpand = (id: string) => {
    if (expandedIds.includes(id)) {
      setExpandedIds(expandedIds.filter((x) => x !== id));
    } else {
      setExpandedIds([...expandedIds, id]);
    }
  };

  const getTruncatedDetail = (detailText: string, isExpanded: boolean) => {
    if (isExpanded) return detailText;
    const lines = detailText.split('\n');
    if (lines.length > 2) {
      return lines.slice(0, 2).join('\n') + '...';
    }
    if (detailText.length > 120) {
      return detailText.substring(0, 120) + '...';
    }
    return detailText;
  };

  const getSeverityBadge = (sev: 'low' | 'medium' | 'high') => {
    switch (sev) {
      case 'high':
        return { bg: '#fee2e2', text: '#dc2626', label: 'HIGH' };
      case 'medium':
        return { bg: '#fef3c7', text: '#d97706', label: 'MEDIUM' };
      case 'low':
      default:
        return { bg: '#e5e7eb', text: '#374151', label: 'LOW' };
    }
  };

  const handleAddIncident = async () => {
    if (!title.trim()) {
      ui.showToast({ text: 'Title is required', appearance: 'neutral' });
      return;
    }
    if (!detail.trim()) {
      ui.showToast({ text: 'Detail is required', appearance: 'neutral' });
      return;
    }

    try {
      const data: Omit<Incident, 'id' | 'createdAt' | 'status'> = {
        title: title.trim(),
        detail: detail.trim(),
        severity,
        createdBy: currentMod,
      };

      const trimmedLinkedPost = linkedPostId.trim();
      if (trimmedLinkedPost) {
        data.linkedPostId = trimmedLinkedPost;
      }

      await addIncident(redis, data);

      ui.showToast({ text: 'Incident logged ✓', appearance: 'success' });
      
      // Reset form
      setTitle('');
      setDetail('');
      setSeverity('low');
      setLinkedPostId('');
      setShowForm(false);
      setRefreshCounter((prev) => prev + 1);
    } catch (err) {
      ui.showToast({
        text: err instanceof Error ? err.message : 'Failed to log incident',
        appearance: 'neutral',
      });
    }
  };

  const handleResolve = async (id: string) => {
    try {
      await resolveIncident(redis, id, currentMod);
      ui.showToast({ text: 'Incident resolved ✓', appearance: 'success' });
      setRefreshCounter((prev) => prev + 1);
    } catch (err) {
      ui.showToast({
        text: err instanceof Error ? err.message : 'Failed to resolve incident',
        appearance: 'neutral',
      });
    }
  };

  const renderIncidentCard = (incident: Incident, isOpen: boolean) => {
    const badge = getSeverityBadge(incident.severity);
    const isExpanded = expandedIds.includes(incident.id);
    const hasLongDetail = incident.detail.length > 120 || incident.detail.split('\n').length > 2;

    return (
      <vstack
        key={incident.id}
        border="thin"
        padding="medium"
        cornerRadius="medium"
        gap="small"
        backgroundColor="#ffffff"
        width="100%"
      >
        <hstack alignment="middle" gap="small" width="100%">
          <hstack
            backgroundColor={badge.bg}
            padding="small"
            cornerRadius="small"
            alignment="center middle"
          >
            <text color={badge.text} size="xsmall" weight="bold">
              {badge.label}
            </text>
          </hstack>
          <text weight="bold" size="medium" wrap>
            {incident.title}
          </text>
        </hstack>

        <vstack onPress={() => toggleExpand(incident.id)} gap="small" width="100%">
          <text wrap size="small" color="neutral-content">
            {getTruncatedDetail(incident.detail, isExpanded)}
          </text>
          {hasLongDetail && (
            <text size="xsmall" color="#3b82f6" weight="bold">
              {isExpanded ? 'Show less ▲' : 'Show more ▼'}
            </text>
          )}
        </vstack>

        {!!incident.linkedPostId && (
          <text size="xsmall" color="neutral-content">
            Linked Post/Comment: {incident.linkedPostId}
          </text>
        )}

        <hstack alignment="middle" width="100%">
          <text size="xsmall" color="neutral-content">
            Created by u/{incident.createdBy} at {new Date(incident.createdAt).toUTCString()}
          </text>
          <spacer grow />
          {isOpen ? (
            <hstack
              backgroundColor="#10b981"
              padding="small"
              cornerRadius="medium"
              alignment="center middle"
              onPress={() => handleResolve(incident.id)}
            >
              <text color="white" weight="bold" size="small">
                Resolve ✓
              </text>
            </hstack>
          ) : (
            <text size="xsmall" color="neutral-content" weight="bold">
              Resolved by u/{incident.resolvedBy || 'unknown'}
            </text>
          )}
        </hstack>
      </vstack>
    );
  };

  return (
    <vstack gap="medium" width="100%">
      {/* Top Header section */}
      <hstack alignment="middle" width="100%">
        <text size="large" weight="bold">Incident Tracker</text>
        <spacer grow />
        {!showForm && (
          <button size="small" onPress={() => setShowForm(true)}>Add incident</button>
        )}
      </hstack>

      {/* Main content columns */}
      <hstack gap="medium" width="100%">
        {/* Left panel: open incident list */}
        <vstack width={showForm ? '65%' : '100%'} gap="medium">
          {sortedOpenIncidents.length === 0 ? (
            <vstack
              border="thin"
              padding="large"
              cornerRadius="medium"
              alignment="center middle"
              backgroundColor="#f0fdf4"
            >
              <text color="#15803d" weight="bold" size="medium">
                No open incidents — all clear ✓
              </text>
            </vstack>
          ) : (
            <vstack gap="small" width="100%">
              {sortedOpenIncidents.map((incident) => renderIncidentCard(incident, true))}
            </vstack>
          )}
        </vstack>

        {/* Right panel: Inline creation form when toggled */}
        {showForm && (
          <vstack
            width="35%"
            gap="medium"
            padding="medium"
            cornerRadius="medium"
            border="thin"
            backgroundColor="#f9fafb"
          >
            <text weight="bold" size="medium">Log New Incident</text>
            
            <vstack gap="small" width="100%">
              <text size="small" weight="bold">Title *</text>
              <input
                placeholder="Brief title of incident"
                value={title}
                onInput={(e: { value?: string }) => setTitle(e.value || '')}
              />
            </vstack>

            <vstack gap="small" width="100%">
              <text size="small" weight="bold">Detail *</text>
              <textarea
                placeholder="Describe the incident detail..."
                value={detail}
                onInput={(e: { value?: string }) => setDetail(e.value || '')}
                rows={4}
              />
            </vstack>

            <vstack gap="small" width="100%">
              <text size="small" weight="bold">Severity *</text>
              <hstack gap="small" width="100%">
                <button
                  size="small"
                  appearance={severity === 'low' ? 'primary' : 'secondary'}
                  onPress={() => setSeverity('low')}
                >
                  Low
                </button>
                <button
                  size="small"
                  appearance={severity === 'medium' ? 'primary' : 'secondary'}
                  onPress={() => setSeverity('medium')}
                >
                  Medium
                </button>
                <button
                  size="small"
                  appearance={severity === 'high' ? 'primary' : 'secondary'}
                  onPress={() => setSeverity('high')}
                >
                  High
                </button>
              </hstack>
            </vstack>

            <vstack gap="small" width="100%">
              <text size="small" weight="bold">Linked Post ID (optional)</text>
              <input
                placeholder="t3_postid or t1_commentid"
                value={linkedPostId}
                onInput={(e: { value?: string }) => setLinkedPostId(e.value || '')}
              />
            </vstack>

            <hstack gap="small" width="100%" alignment="end">
              <button size="small" appearance="secondary" onPress={() => setShowForm(false)}>
                Cancel
              </button>
              <button size="small" appearance="primary" onPress={handleAddIncident}>
                Submit
              </button>
            </hstack>
          </vstack>
        )}
      </hstack>

      {/* Bottom Section: Recently Resolved */}
      <vstack
        border="thin"
        padding="medium"
        cornerRadius="medium"
        gap="medium"
        backgroundColor="#f9fafb"
        width="100%"
      >
        <hstack
          alignment="middle"
          width="100%"
          onPress={() => setResolvedCollapsed(!resolvedCollapsed)}
        >
          <text weight="bold" size="medium">Recently Resolved</text>
          <spacer grow />
          <text size="small" color="#3b82f6" weight="bold">
            {resolvedCollapsed ? 'Show ▼' : 'Hide ▲'}
          </text>
        </hstack>

        {!resolvedCollapsed && (
          <vstack gap="small" width="100%">
            {recentResolvedIncidents.length === 0 ? (
              <text size="small" color="neutral-content">
                No recently resolved incidents
              </text>
            ) : (
              recentResolvedIncidents.map((incident) => renderIncidentCard(incident, false))
            )}
          </vstack>
        )}
      </vstack>
    </vstack>
  );
};
