export const handoverFormDef = {
  title: 'Shift handover',
  fields: [
    {
      name: 'freeText',
      label: 'What should the next mod know?',
      type: 'paragraph' as const,
      required: true,
    },
    {
      name: 'warningsGiven',
      label: 'Usernames warned this shift (comma-separated)',
      type: 'string' as const,
      required: false,
    },
    {
      name: 'openIssues',
      label: 'Any unresolved incidents? (describe briefly)',
      type: 'paragraph' as const,
      required: false,
    },
  ],
};

export const playbookFormDef = {
  title: 'Add / edit playbook entry',
  fields: [
    {
      name: 'tag',
      label: 'Tag (slug, e.g. friday-raids)',
      type: 'string' as const,
      required: true,
    },
    {
      name: 'title',
      label: 'Title',
      type: 'string' as const,
      required: true,
    },
    {
      name: 'body',
      label: 'Details (markdown OK)',
      type: 'paragraph' as const,
      required: true,
    },
  ],
};

export const warnUserFormDef = {
  title: 'Warn user',
  fields: [
    {
      name: 'targetId',
      label: 'Target ID',
      type: 'string' as const,
      required: true,
    },
    {
      name: 'reason',
      label: 'Reason',
      type: 'paragraph' as const,
      required: true,
    },
    {
      name: 'sendPm',
      label: 'Send private message to user',
      type: 'boolean' as const,
      required: false,
      defaultValue: true,
    },
  ],
};
