export type ReaderDataScope = 'entries' | 'subscriptions' | 'counts';
export type ReaderStateChange = { scopes: Array<ReaderDataScope | 'jobs'> };
