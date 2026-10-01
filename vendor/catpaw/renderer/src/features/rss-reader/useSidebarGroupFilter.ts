import { useEffect, useMemo, useState } from 'react';
import type { Feed, GroupTreeNode } from './types';

export function useSidebarGroupFilter(
  groupTree: GroupTreeNode[],
  groupedFeeds: Map<string | null, Feed[]>,
  isLoading: boolean,
) {
  const [requestedGroupId, selectGroup] = useState('');
  const groupOptions = useMemo(() => {
    const options: Array<{ group: GroupTreeNode; label: string }> = [];
    const walk = (groups: GroupTreeNode[], parentLabel: string) => {
      for (const group of groups) {
        const label = parentLabel ? `${parentLabel} / ${group.name}` : group.name;
        options.push({ group, label });
        walk(group.children, label);
      }
    };
    walk(groupTree, '');
    return options;
  }, [groupTree]);

  const selectedGroup = groupOptions.find(({ group }) => group.id === requestedGroupId)?.group ?? null;
  const selectedGroupId = selectedGroup?.id ?? '';
  const visibleGroupTree = useMemo(() => {
    if (selectedGroup) return [];
    const pruneEmptyGroups = (groups: GroupTreeNode[]): GroupTreeNode[] => groups.flatMap((group) => {
      const children = pruneEmptyGroups(group.children);
      return (groupedFeeds.get(group.id)?.length ?? 0) > 0 || children.length > 0
        ? [{ ...group, children }]
        : [];
    });
    return pruneEmptyGroups(groupTree);
  }, [groupTree, groupedFeeds, selectedGroup]);

  const visibleFeeds = useMemo(() => {
    if (!selectedGroup) return groupedFeeds.get(null) ?? [];
    const collectFeeds = (group: GroupTreeNode): Feed[] => [
      ...(groupedFeeds.get(group.id) ?? []),
      ...group.children.flatMap(collectFeeds),
    ];
    return collectFeeds(selectedGroup);
  }, [groupedFeeds, selectedGroup]);

  // A deleted group must return the sidebar to all subscriptions.
  useEffect(() => {
    if (!isLoading && requestedGroupId && !selectedGroup) selectGroup('');
  }, [isLoading, requestedGroupId, selectedGroup]);

  return { groupOptions, selectedGroup, selectedGroupId, visibleGroupTree, visibleFeeds, selectGroup };
}
