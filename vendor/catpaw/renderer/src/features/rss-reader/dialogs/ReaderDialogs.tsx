import { useEffect, useRef } from 'react';
import type { DialogProps, ReaderDialog } from './types';
import { ImportSubscriptionDialog } from './ImportSubscriptionDialog';
import { AddFeedDialog } from './AddFeedDialog';
import { EditFeedDialog } from './EditFeedDialog';
import { EditGroupDialog } from './EditGroupDialog';
import { NewFolderDialog } from './NewFolderDialog';
import { RefreshSettingsDialog } from './RefreshSettingsDialog';
import { SourceHealthDialog } from './SourceHealthDialog';
import { MaintenanceDialog } from './MaintenanceDialog';
import { ApiKeysDialog } from './ApiKeysDialog';
import { TranslationSettingsDialog } from './TranslationSettingsDialog';
import { SummarySettingsDialog } from './SummarySettingsDialog';
type Props = { dialog: ReaderDialog | null } & Omit<DialogProps['import'] & DialogProps['health'] & DialogProps['edit-feed'] & DialogProps['edit-group'] & DialogProps['refresh'] & DialogProps['translation'] & DialogProps['summary'], 'feedId' | 'feed' | 'group' | 'settings'>;
export function ReaderDialogs(props: Props) {
  const { dialog } = props;
  const lastReaderFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && !event.target.closest('[role="dialog"]')) {
        lastReaderFocus.current = event.target;
      }
    };
    document.addEventListener('focusin', rememberFocus);
    return () => document.removeEventListener('focusin', rememberFocus);
  }, []);
  useEffect(() => {
    if (!dialog) return;
    const previous = lastReaderFocus.current;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!modal) return;
    const getControls = () => Array.from(modal.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
    if (!modal.contains(document.activeElement)) getControls()[0]?.focus();
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); props.onClose(); }
      if (event.key !== 'Tab') return;
      const controls = getControls();
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKeys);
    return () => {
      document.removeEventListener('keydown', handleKeys);
      const target = [previous,
        document.querySelector<HTMLElement>('.menu-anchor > button'),
        document.querySelector<HTMLElement>('.reader-compact-nav button[aria-current]'),
      ].find((element) => element?.isConnected && element.getClientRects().length > 0);
      target?.focus();
    };
  }, [dialog]);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'import': return <ImportSubscriptionDialog {...props} />;
    case 'add': return <AddFeedDialog {...props} />;
    case 'edit-feed': return <EditFeedDialog {...props} feed={dialog.feed} />;
    case 'edit-group': return <EditGroupDialog {...props} group={dialog.group} />;
    case 'new-folder': return <NewFolderDialog {...props} parentId={dialog.parentId} />;
    case 'refresh': return <RefreshSettingsDialog {...props} settings={dialog.settings} />;
    case 'health': return <SourceHealthDialog {...props} feedId={dialog.feedId} />;
    case 'maintenance': return <MaintenanceDialog {...props} />;
    case 'api-keys': return <ApiKeysDialog {...props} />;
    case 'translation': return <TranslationSettingsDialog {...props} />;
    case 'summary': return <SummarySettingsDialog {...props} />;
  }
}
