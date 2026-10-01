export type SchedulerStatus = Awaited<
  ReturnType<NonNullable<typeof window.catpaw>['rss']['getSchedulerStatus']>
>;

export type EnrichmentQueueStatus = Awaited<
  ReturnType<NonNullable<typeof window.catpaw>['rss']['getEnrichmentQueueStatus']>
>;

export type PipelineRunsResult = Awaited<
  ReturnType<NonNullable<typeof window.catpaw>['rss']['listPipelineRuns']>
>;

export type PipelineRun = PipelineRunsResult[number];

export type SchedulerJob = NonNullable<SchedulerStatus['currentJob']>;
