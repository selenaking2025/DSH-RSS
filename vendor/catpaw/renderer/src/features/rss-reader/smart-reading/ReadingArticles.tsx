import { createPortal } from 'react-dom';
import { ArticleList, type ArticleListProps } from '../ArticleList';
import type { FeedGroup } from '../types';
import { SmartReadingPanel } from './SmartReadingPanel';
import { ReadingSettings, type ReadingSettingsTab } from './ReadingSettings';
import { useSmartReading } from './useSmartReading';
import './smart-reading.css';

type Props = ArticleListProps & {
  isSelected: boolean;
  groups: FeedGroup[];
  settingsTab: ReadingSettingsTab | null;
  onOpenSettings: (tab: ReadingSettingsTab) => void;
  onCloseSettings: () => void;
  onShowSelected: () => void;
};

export function ReadingArticles({ isSelected, groups, settingsTab, onOpenSettings, onCloseSettings, onShowSelected, ...props }: Props) {
  // Keep the selected interest and reading budget when navigating or closing settings.
  const reading = useSmartReading();
  function select(id: string) { props.onSelectEntry(id); void window.catpaw?.rss.recordReadingVisit(id).catch(() => {}); }
  return <>
    {isSelected ? <SmartReadingPanel reading={reading} feedById={props.feedById} selectedEntryId={props.selectedEntryId} onSelect={select} onSettings={onOpenSettings} />
      : <ArticleList {...props} onSelectEntry={select} />}
    {settingsTab ? createPortal(<ReadingSettings reading={reading} feeds={[...props.feedById.values()]} groups={groups}
      initialTab={settingsTab} onClose={onCloseSettings} onShowResults={onShowSelected} />, document.body) : null}
  </>;
}
