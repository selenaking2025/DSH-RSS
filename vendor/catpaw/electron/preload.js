const { contextBridge, ipcRenderer } = require('electron');

const expectedArgument = process.argv.find((arg) => arg.startsWith('--catpaw-renderer-url='));
const expectedUrl = expectedArgument ? decodeURIComponent(expectedArgument.slice('--catpaw-renderer-url='.length)) : '';
// The bridge is never installed in remote documents or article subframes.
if (process.isMainFrame && window.location.href.split('#')[0] === expectedUrl.split('#')[0]) {
contextBridge.exposeInMainWorld('catpaw', {
  rss: {
    getReadingSettings: () => ipcRenderer.invoke('rss:getReadingSettings'),
    saveReadingSettings: (input) => ipcRenderer.invoke('rss:saveReadingSettings', input),
    testReadingConnection: () => ipcRenderer.invoke('rss:testReadingConnection'),
    listReadingFocuses: () => ipcRenderer.invoke('rss:listReadingFocuses'),
    saveReadingFocus: (input) => ipcRenderer.invoke('rss:saveReadingFocus', input),
    getReadingStatus: () => ipcRenderer.invoke('rss:getReadingStatus'),
    startReadingRun: (input) => ipcRenderer.invoke('rss:startReadingRun', input),
    cancelReadingRun: () => ipcRenderer.invoke('rss:cancelReadingRun'),
    getReadingResults: (input) => ipcRenderer.invoke('rss:getReadingResults', input),
    saveReadingFeedback: (input) => ipcRenderer.invoke('rss:saveReadingFeedback', input),
    recordReadingVisit: (entryId) => ipcRenderer.invoke('rss:recordReadingVisit', entryId),
    splitReadingEvent: (input) => ipcRenderer.invoke('rss:splitReadingEvent', input),
    parseReadingQuery: (text) => ipcRenderer.invoke('rss:parseReadingQuery', text),
    onReadingChanged: (listener) => {
      const handler = (_event, change) => listener(change);
      ipcRenderer.on('rss:readingChanged', handler);
      return () => ipcRenderer.removeListener('rss:readingChanged', handler);
    },
    getMaintenanceStatus: () => ipcRenderer.invoke('rss:getMaintenanceStatus'),
    getThemePreference: () => ipcRenderer.invoke('rss:getThemePreference'),
    setThemePreference: (preference) => ipcRenderer.invoke('rss:setThemePreference', preference),
    translateArticle: (input) => ipcRenderer.invoke('rss:translateArticle', input),
    cancelArticleTranslation: (requestId) => ipcRenderer.invoke('rss:cancelArticleTranslation', requestId),
    onTranslationProgress: (listener) => {
      const handler = (_event, progress) => listener(progress);
      ipcRenderer.on('rss:translationProgress', handler);
      return () => ipcRenderer.removeListener('rss:translationProgress', handler);
    },
    listModelProviders: () => ipcRenderer.invoke('rss:listModelProviders'),
    saveModelProvider: (input) => ipcRenderer.invoke('rss:saveModelProvider', input),
    removeModelProvider: (id) => ipcRenderer.invoke('rss:removeModelProvider', id),
    discoverProviderModels: (input) => ipcRenderer.invoke('rss:discoverProviderModels', input),
    getAppStatus: () => ipcRenderer.invoke('rss:getAppStatus'),
    backupDatabase: () => ipcRenderer.invoke('rss:backupDatabase'),
    restoreDatabase: () => ipcRenderer.invoke('rss:restoreDatabase'),
    exportDiagnostics: () => ipcRenderer.invoke('rss:exportDiagnostics'),
    rebuildSearchIndex: () => ipcRenderer.invoke('rss:rebuildSearchIndex'),
    checkForUpdates: () => ipcRenderer.invoke('rss:checkForUpdates'),
    getUpdateStatus: () => ipcRenderer.invoke('rss:getUpdateStatus'),
    downloadUpdate: () => ipcRenderer.invoke('rss:downloadUpdate'),
    installUpdate: () => ipcRenderer.invoke('rss:installUpdate'),
    onUpdateStatusChanged: (listener) => {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on('rss:updateStatusChanged', handler);
      return () => ipcRenderer.removeListener('rss:updateStatusChanged', handler);
    },
    onStateChanged: (listener) => {
      const handler = (_event, change) => listener(change);
      ipcRenderer.on('rss:stateChanged', handler);
      return () => ipcRenderer.removeListener('rss:stateChanged', handler);
    },
    listGroups: () => ipcRenderer.invoke('rss:listGroups'),
    listFeeds: () => ipcRenderer.invoke('rss:listFeeds'),
    listEntries: (params) => ipcRenderer.invoke('rss:listEntries', params),
    countEntries: (params) => ipcRenderer.invoke('rss:countEntries', params),
    getEntry: (id) => ipcRenderer.invoke('rss:getEntry', id),
    getUnreadCounts: () => ipcRenderer.invoke('rss:getUnreadCounts'),
    getSchedulerStatus: () => ipcRenderer.invoke('rss:getSchedulerStatus'),
    getRefreshSettings: () => ipcRenderer.invoke('rss:getRefreshSettings'),
    updateRefreshSettings: (input) => ipcRenderer.invoke('rss:updateRefreshSettings', input),
    listPipelineRuns: (params) => ipcRenderer.invoke('rss:listPipelineRuns', params),
    listSourceEndpointHealth: (params) => ipcRenderer.invoke('rss:listSourceEndpointHealth', params),
    listFeedRunDiagnostics: (params) => ipcRenderer.invoke('rss:listFeedRunDiagnostics', params),
    listFeedSyncStates: (params) => ipcRenderer.invoke('rss:listFeedSyncStates', params),
    resetSourceEndpointHealth: (endpointId) => ipcRenderer.invoke('rss:resetSourceEndpointHealth', endpointId),
    getXApiFallbackStatus: (feedId) => ipcRenderer.invoke('rss:getXApiFallbackStatus', feedId),
    setXApiFallbackEnabled: (input) => ipcRenderer.invoke('rss:setXApiFallbackEnabled', input),
    listFeedEnrichmentStates: (params) => ipcRenderer.invoke('rss:listFeedEnrichmentStates', params),
    getEnrichmentQueueStatus: () => ipcRenderer.invoke('rss:getEnrichmentQueueStatus'),
    markRead: (id, isRead) => ipcRenderer.invoke('rss:markRead', id, isRead),
    markAllRead: (feedId) => ipcRenderer.invoke('rss:markAllRead', feedId),
    toggleStar: (id) => ipcRenderer.invoke('rss:toggleStar', id),
    fetchEntryContent: (id) => ipcRenderer.invoke('rss:fetchEntryContent', id),
    resolveXiaoyuzhouAudio: (id) => ipcRenderer.invoke('rss:resolveXiaoyuzhouAudio', id),
    openWeChatLogin: () => ipcRenderer.invoke('rss:openWeChatLogin'),
    getSocialThread: (id) => ipcRenderer.invoke('rss:getSocialThread', id),
    analyzeEntry: (input) => ipcRenderer.invoke('rss:analyzeEntry', input),
    getArticleSummary: (entryId) => ipcRenderer.invoke('rss:getArticleSummary', entryId),
    cancelArticleSummary: (requestId) => ipcRenderer.invoke('rss:cancelArticleSummary', requestId),
    createGroup: (name, parentId) => ipcRenderer.invoke('rss:createGroup', name, parentId ?? null),
    updateGroup: (input) => ipcRenderer.invoke('rss:updateGroup', input),
    deleteGroup: (id) => ipcRenderer.invoke('rss:deleteGroup', id),
    refreshAll: (options) => ipcRenderer.invoke('rss:refreshAll', options),
    refreshFeed: (id) => ipcRenderer.invoke('rss:refreshFeed', id),
    backfillFeed: (id, options) => ipcRenderer.invoke('rss:backfillFeed', id, options),
    backfillAll: (options) => ipcRenderer.invoke('rss:backfillAll', options),
    cancelActiveJobs: () => ipcRenderer.invoke('rss:cancelActiveJobs'),
    discoverFeeds: (input) => ipcRenderer.invoke('rss:discoverFeeds', input),
    addFeed: (input) => ipcRenderer.invoke('rss:addFeed', input),
    updateFeed: (input) => ipcRenderer.invoke('rss:updateFeed', input),
    deleteFeed: (id) => ipcRenderer.invoke('rss:deleteFeed', id),
    previewOpml: (options) => ipcRenderer.invoke('rss:previewOpml', options),
    importOpml: (options) => ipcRenderer.invoke('rss:importOpml', options),
    exportOpml: () => ipcRenderer.invoke('rss:exportOpml'),
  },
});

}
