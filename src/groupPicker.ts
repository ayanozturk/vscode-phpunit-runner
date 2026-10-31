export type GroupMethodOccurrence = {
  group: string;
  methodId: string;
  workspaceId?: string;
};

export type GroupPickerOption = {
  label: string;
  description: string;
  groupName: string;
};

export function buildGroupPickerOptions(occurrences: GroupMethodOccurrence[]): GroupPickerOption[] {
  const methodsByGroup = new Map<string, Map<string, string | undefined>>();

  for (const occurrence of occurrences) {
    const methods = methodsByGroup.get(occurrence.group) ?? new Map<string, string | undefined>();
    if (!methods.has(occurrence.methodId) || (!methods.get(occurrence.methodId) && occurrence.workspaceId)) {
      methods.set(occurrence.methodId, occurrence.workspaceId);
    }
    methodsByGroup.set(occurrence.group, methods);
  }

  return [...methodsByGroup.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([groupName, methods]) => {
    const workspaceCount = new Set([...methods.values()].filter((workspaceId): workspaceId is string => Boolean(workspaceId))).size;
    const methodCount = methods.size;
    return {
      label: groupName,
      description: `${countLabel(methodCount, 'method')} · ${countLabel(workspaceCount, 'workspace')}`,
      groupName,
    };
  });
}

function countLabel(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}
