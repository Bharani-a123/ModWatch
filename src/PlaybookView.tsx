import { Devvit, useState, useAsync, JSONArray } from '@devvit/public-api';
import {
  PlaybookEntry,
  getAllPlaybookEntries,
  upsertPlaybookEntry,
  deletePlaybookEntry,
} from './redis/playbook.js';

interface PlaybookViewProps {
  context: Devvit.Context;
}

export const PlaybookView = (props: PlaybookViewProps) => {
  const { context } = props;
  const { redis, ui, reddit } = context;

  // Roster/Refresh triggers
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  // Search & Navigation states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [expandedTags, setExpandedTags] = useState<string[]>([]);
  const [deleteConfirmTag, setDeleteConfirmTag] = useState<string>('');

  // Form states
  const [tag, setTag] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [body, setBody] = useState<string>('');

  // Fetch current user details
  const { data: currentUser } = useAsync<{ username: string } | null>(async () => {
    const user = await reddit.getCurrentUser();
    return user ? { username: user.username } : null;
  });
  const currentMod = currentUser?.username || 'Guest';

  // Fetch head moderator status
  const { data: isHeadModVal } = useAsync<boolean>(async () => {
    const mods = await reddit.getModerators({ subredditName: context.subredditName || '' }).all();
    const headMod = mods[0];
    return !!headMod && headMod.username === currentMod;
  });
  const isHeadMod = isHeadModVal || false;

  // Fetch playbook onboarding state
  const { data: onboardedVal } = useAsync<boolean>(async () => {
    const raw = await redis.get(`playbook:onboarded:${currentMod}`);
    return raw === '1';
  }, { depends: [currentMod, refreshCounter.toString()] });
  const onboarded = onboardedVal || false;

  // Fetch all playbook entries
  const { data: entriesVal } = useAsync<JSONArray>(async () => {
    const list = await getAllPlaybookEntries(redis);
    return list as unknown as JSONArray;
  }, { depends: [refreshCounter.toString()] });

  const entries = (entriesVal as unknown as PlaybookEntry[]) || [];

  // Filter entries client-side by search query (tag or title match)
  const filteredEntries = entries.filter((entry) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      entry.tag.toLowerCase().includes(q) ||
      entry.title.toLowerCase().includes(q)
    );
  });

  const handleTagInput = (val: string) => {
    // Tag slugification: lowercase, hyphens, no spaces
    const slug = val
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    setTag(slug);
  };

  const handleAddClick = () => {
    setTag('');
    setTitle('');
    setBody('');
    setIsEditing(false);
    setShowForm(true);
  };

  const handleEditClick = (entry: PlaybookEntry) => {
    setTag(entry.tag);
    setTitle(entry.title);
    setBody(entry.body);
    setIsEditing(true);
    setShowForm(true);
  };

  const handleSaveEntry = async () => {
    if (!tag.trim()) {
      ui.showToast({ text: 'Tag slug is required', appearance: 'neutral' });
      return;
    }
    if (!title.trim()) {
      ui.showToast({ text: 'Title is required', appearance: 'neutral' });
      return;
    }
    if (!body.trim()) {
      ui.showToast({ text: 'Body detail is required', appearance: 'neutral' });
      return;
    }

    try {
      await upsertPlaybookEntry(redis, {
        tag: tag.trim(),
        title: title.trim(),
        body: body.trim(),
        createdBy: isEditing ? (entries.find(e => e.tag === tag)?.createdBy || currentMod) : currentMod,
        updatedBy: currentMod,
      });

      ui.showToast({ text: 'Playbook entry saved ✓', appearance: 'success' });
      
      // Reset form
      setTag('');
      setTitle('');
      setBody('');
      setShowForm(false);
      setIsEditing(false);
      setRefreshCounter((prev) => prev + 1);
    } catch (err) {
      ui.showToast({
        text: err instanceof Error ? err.message : 'Failed to save entry',
        appearance: 'neutral',
      });
    }
  };

  const handleDeleteConfirm = async (targetTag: string) => {
    try {
      await deletePlaybookEntry(redis, targetTag);
      ui.showToast({ text: 'Entry deleted', appearance: 'success' });
      setDeleteConfirmTag('');
      setRefreshCounter((prev) => prev + 1);
    } catch (err) {
      ui.showToast({
        text: err instanceof Error ? err.message : 'Failed to delete entry',
        appearance: 'neutral',
      });
    }
  };

  const toggleExpand = (targetTag: string) => {
    if (expandedTags.includes(targetTag)) {
      setExpandedTags(expandedTags.filter((t) => t !== targetTag));
    } else {
      setExpandedTags([...expandedTags, targetTag]);
    }
  };

  const handleDismissOnboarding = async () => {
    await redis.set(`playbook:onboarded:${currentMod}`, '1');
    ui.showToast({ text: 'Onboarding completed ✓', appearance: 'success' });
    setRefreshCounter((prev) => prev + 1);
  };

  // Onboarding overlay for first open showing top 3 entries
  if (!onboarded && entries.length > 0) {
    const top3 = entries.slice(0, 3);
    return (
      <vstack gap="large" padding="large" alignment="center middle" width="100%">
        <vstack
          border="thin"
          padding="large"
          cornerRadius="medium"
          gap="medium"
          backgroundColor="#ffffff"
          width="90%"
        >
          <text size="large" weight="bold">📖 Playbook Onboarding</text>
          <text size="small" color="neutral-content">
            Please read these top 3 playbook entries before continuing:
          </text>
          
          <vstack gap="medium" width="100%">
            {top3.map((item) => (
              <vstack key={item.tag} border="thin" padding="medium" cornerRadius="medium" gap="small">
                <hstack gap="small" alignment="middle">
                  <hstack backgroundColor="#e0f2fe" padding="small" cornerRadius="small">
                    <text color="#0369a1" size="xsmall" weight="bold">#{item.tag}</text>
                  </hstack>
                  <text weight="bold" size="medium">{item.title}</text>
                </hstack>
                <text size="small" color="neutral-content" wrap>{item.body}</text>
              </vstack>
            ))}
          </vstack>

          <hstack width="100%" alignment="center" padding="medium">
            <hstack
              backgroundColor="#3b82f6"
              padding="medium"
              cornerRadius="medium"
              onPress={handleDismissOnboarding}
            >
              <text color="white" weight="bold">Dismiss & Get Started</text>
            </hstack>
          </hstack>
        </vstack>
      </vstack>
    );
  }

  const renderPlaybookCard = (entry: PlaybookEntry) => {
    const isExpanded = expandedTags.includes(entry.tag);
    const bodyText = isExpanded
      ? entry.body
      : (entry.body.length > 100 ? entry.body.substring(0, 100) + '...' : entry.body);
    const isConfirming = deleteConfirmTag === entry.tag;

    return (
      <vstack
        key={entry.tag}
        border="thin"
        padding="medium"
        cornerRadius="medium"
        gap="small"
        backgroundColor="#ffffff"
        width="100%"
      >
        {/* Header containing tag and title */}
        <hstack gap="small" alignment="middle" width="100%">
          <hstack backgroundColor="#f3f4f6" padding="small" cornerRadius="small" border="thin">
            <text color="#374151" size="xsmall" weight="bold">
              #{entry.tag}
            </text>
          </hstack>
          <text weight="bold" size="medium" wrap>
            {entry.title}
          </text>
        </hstack>

        {/* Markdown-supported Detail Body */}
        <vstack width="100%">
          <text size="small" color="neutral-content" wrap>
            {bodyText}
          </text>
        </vstack>

        <text size="xsmall" color="neutral-content">
          Last updated by u/{entry.updatedBy} at {new Date(entry.updatedAt).toUTCString()}
        </text>

        {/* Action Controls */}
        {isConfirming ? (
          <vstack gap="small" backgroundColor="#fee2e2" padding="small" cornerRadius="medium" border="thin" width="100%">
            <text size="small" color="#991b1b" weight="bold" wrap>
              Delete this entry? This cannot be undone
            </text>
            <hstack gap="small" width="100%" alignment="end">
              <button size="small" onPress={() => setDeleteConfirmTag('')}>
                Cancel
              </button>
              <button size="small" appearance="destructive" onPress={() => handleDeleteConfirm(entry.tag)}>
                Delete
              </button>
            </hstack>
          </vstack>
        ) : (
          <hstack gap="small" alignment="middle" width="100%">
            <button size="small" onPress={() => toggleExpand(entry.tag)}>
              {isExpanded ? 'Collapse' : 'View'}
            </button>
            <button size="small" onPress={() => handleEditClick(entry)}>
              Edit
            </button>
            {isHeadMod && (
              <button
                size="small"
                appearance="destructive"
                onPress={() => setDeleteConfirmTag(entry.tag)}
              >
                Delete
              </button>
            )}
          </hstack>
        )}
      </vstack>
    );
  };

  // Convert linear list of entries into rows of 2 columns
  const renderGrid = (list: PlaybookEntry[]) => {
    const rows: PlaybookEntry[][] = [];
    for (let i = 0; i < list.length; i += 2) {
      rows.push(list.slice(i, i + 2));
    }

    return (
      <vstack gap="medium" width="100%">
        {rows.map((row, rowIndex) => (
          <hstack key={rowIndex.toString()} gap="medium" width="100%">
            {row.map((item) => (
              <vstack width="48%" key={item.tag}>
                {renderPlaybookCard(item)}
              </vstack>
            ))}
            {row.length === 1 && <vstack width="48%" />}
          </hstack>
        ))}
      </vstack>
    );
  };

  return (
    <vstack gap="medium" width="100%">
      {/* Top action header bar */}
      <hstack alignment="middle" width="100%">
        <text size="large" weight="bold">Subreddit Playbook</text>
        <spacer grow />
        {!showForm && (
          <button size="small" onPress={handleAddClick}>Add entry</button>
        )}
      </hstack>

      {/* Main body content */}
      <hstack gap="medium" width="100%">
        {/* Left Column: Search + Grid of entries */}
        <vstack width={showForm ? '65%' : '100%'} gap="medium">
          {/* Search bar */}
          <input
            placeholder="Search entries by tag or title..."
            value={searchQuery}
            onInput={(e: { value?: string }) => setSearchQuery(e.value || '')}
          />

          {filteredEntries.length === 0 ? (
            <vstack border="thin" padding="large" cornerRadius="medium" alignment="center middle" backgroundColor="#f9fafb">
              <text color="neutral-content" weight="bold">
                {entries.length === 0
                  ? 'No playbook entries yet — add your first piece of team knowledge'
                  : 'No entries match your search query'}
              </text>
            </vstack>
          ) : (
            renderGrid(filteredEntries)
          )}
        </vstack>

        {/* Right Column: Inline creation/editing form */}
        {showForm && (
          <vstack
            width="35%"
            gap="medium"
            padding="medium"
            cornerRadius="medium"
            border="thin"
            backgroundColor="#f9fafb"
          >
            <text weight="bold" size="medium">
              {isEditing ? 'Edit Playbook Entry' : 'New Playbook Entry'}
            </text>

            <vstack gap="small" width="100%">
              <text size="small" weight="bold">Tag Slug *</text>
              {isEditing ? (
                <vstack padding="small" border="thin" cornerRadius="small" backgroundColor="#e5e7eb">
                  <text size="small" color="#4b5563">#{tag}</text>
                </vstack>
              ) : (
                <input
                  placeholder="e.g. friday-raids"
                  value={tag}
                  onInput={(e: { value?: string }) => handleTagInput(e.value || '')}
                />
              )}
            </vstack>

            <vstack gap="small" width="100%">
              <text size="small" weight="bold">Title *</text>
              <input
                placeholder="Title of the entry"
                value={title}
                onInput={(e: { value?: string }) => setTitle(e.value || '')}
              />
            </vstack>

            <vstack gap="small" width="100%">
              <text size="small" weight="bold">Body detail (supports markdown) *</text>
              <textarea
                placeholder="Write full playbook detail here..."
                value={body}
                onInput={(e: { value?: string }) => setBody(e.value || '')}
                rows={6}
              />
            </vstack>

            <hstack gap="small" width="100%" alignment="end">
              <button size="small" appearance="secondary" onPress={() => { setShowForm(false); setIsEditing(false); }}>
                Cancel
              </button>
              <button size="small" appearance="primary" onPress={handleSaveEntry}>
                Save
              </button>
            </hstack>
          </vstack>
        )}
      </hstack>
    </vstack>
  );
};
