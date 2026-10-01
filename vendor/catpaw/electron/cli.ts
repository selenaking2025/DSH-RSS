#!/usr/bin/env node
import { initializeReaderData } from './services/initialize-reader-data';

import path from 'node:path';
import { listPipelineRuns } from './data/pipeline-run-repo';
import { resolveUserDataDir } from './runtime';
import {
  enqueueRefreshAll,
  enqueueRefreshFeed,
  toRunOutcome,
} from './services/rss-run-service';

type CliCommand = 'refresh' | 'runs' | 'help';

type ParsedArgs = {
  command: CliCommand;
  feedId: string | null;
  userDataDir: string | null;
  json: boolean;
  limit: number | null;
  refreshConcurrency: number | null;
  perHostConcurrency: number | null;
};

function printHelp() {
  console.log(`Catpaw RSS CLI

Usage:
  catpaw refresh [--feed-id <id>] [--json] [--user-data-dir <dir>]
  catpaw runs [--limit <n>] [--json] [--user-data-dir <dir>]

Options:
  --feed-id <id>               Refresh one feed instead of all feeds
  --limit <n>                  Limit returned RSS pipeline runs
  --refresh-concurrency <n>    Override refresh worker concurrency
  --per-host-concurrency <n>   Override per-host refresh concurrency
  --json                       Print machine-readable JSON output
  --user-data-dir <dir>        Override the isolated Catpaw local state root
`);
}

function requireValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid positive integer for ${flag}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [maybeCommand, ...args] = argv;
  let command: CliCommand;
  if (maybeCommand === 'refresh' || maybeCommand === 'runs') {
    command = maybeCommand;
  } else if (
    maybeCommand === undefined
    || maybeCommand === 'help'
    || maybeCommand === '--help'
    || maybeCommand === '-h'
  ) {
    command = 'help';
  } else {
    throw new Error(`Unknown command: ${maybeCommand}`);
  }

  const parsed: ParsedArgs = {
    command,
    feedId: null,
    userDataDir: null,
    json: false,
    limit: null,
    refreshConcurrency: null,
    perHostConcurrency: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--feed-id':
        parsed.feedId = requireValue(args, index, '--feed-id');
        index += 1;
        break;
      case '--user-data-dir':
        parsed.userDataDir = path.resolve(requireValue(args, index, '--user-data-dir'));
        index += 1;
        break;
      case '--limit':
        parsed.limit = parsePositiveInteger(requireValue(args, index, '--limit'), '--limit');
        index += 1;
        break;
      case '--refresh-concurrency':
        parsed.refreshConcurrency = parsePositiveInteger(
          requireValue(args, index, '--refresh-concurrency'),
          '--refresh-concurrency',
        );
        index += 1;
        break;
      case '--per-host-concurrency':
        parsed.perHostConcurrency = parsePositiveInteger(
          requireValue(args, index, '--per-host-concurrency'),
          '--per-host-concurrency',
        );
        index += 1;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--help':
      case '-h':
        parsed.command = 'help';
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  if (parsed.command === 'runs' && parsed.feedId) {
    throw new Error('--feed-id is only valid with the refresh command');
  }

  return parsed;
}

function applyUserDataDirOverride(userDataDir: string | null) {
  if (userDataDir) {
    process.env.CATPAW_USER_DATA_DIR = userDataDir;
  }
}

function printJson(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function runRefreshCommand(args: ParsedArgs) {
  if (args.feedId) {
    const run = await enqueueRefreshFeed({
      feedId: args.feedId,
      metadata: { initiatedBy: 'cli' },
    });
    const result = toRunOutcome(run);
    const payload = {
      command: 'refresh',
      scope: 'feed',
      feedId: args.feedId,
      userDataDir: resolveUserDataDir(),
      run,
      result,
    };

    if (args.json) {
      printJson(payload);
    } else {
      console.log(`Refreshed feed ${args.feedId}: ${result.status === 'completed' ? 'ok' : result.status}`);
      console.log(`Run ID: ${run.runId}`);
      console.log(`New entries: ${result.progress.newEntries}`);
      if (result.failure) console.error(`Error: ${result.failure.error}`);
    }

    return result.status === 'completed' ? 0 : 1;
  }

  const run = await enqueueRefreshAll({
    options: {
      refreshConcurrency: args.refreshConcurrency,
      perHostConcurrency: args.perHostConcurrency,
    },
    metadata: { initiatedBy: 'cli' },
  });
  const result = toRunOutcome(run);
  const payload = {
    command: 'refresh',
    scope: 'all',
    userDataDir: resolveUserDataDir(),
    run,
    result,
  };

  if (args.json) {
    printJson(payload);
  } else {
    console.log(`Refreshed ${run.totalFeeds} feed(s)`);
    console.log(`Run ID: ${run.runId}`);
    console.log(`Success: ${run.feedsSucceeded}`);
    console.log(`Failed: ${run.feedsFailed}`);
    console.log(`New entries: ${run.newEntries}`);
    if (run.error) console.error(`Error: ${run.error}`);
  }

  return result.status === 'completed' ? 0 : 1;
}

function runRunsCommand(args: ParsedArgs) {
  const runs = listPipelineRuns({ limit: args.limit ?? 10 });
  const payload = {
    command: 'runs',
    userDataDir: resolveUserDataDir(),
    runs,
  };

  if (args.json) {
    printJson(payload);
  } else if (runs.length === 0) {
    console.log('No RSS pipeline runs recorded yet.');
  } else {
    for (const run of runs) {
      console.log(
        `${run.runType} ${run.status} ${new Date(run.startedAt).toLocaleString()} new=${run.newEntries} feeds=${run.feedsCompleted}/${run.totalFeeds}`,
      );
    }
  }

  return 0;
}

export async function runCli(argv = process.argv.slice(2)) {
  try {
    const parsed = parseArgs(argv);
    applyUserDataDirOverride(parsed.userDataDir);

    if (parsed.command === 'help') {
      printHelp();
      return 0;
    }

    await initializeReaderData();
    const exitCode = parsed.command === 'refresh'
      ? await runRefreshCommand(parsed)
      : runRunsCommand(parsed);
    return exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (require.main === module) void runCli().then((code) => process.exit(code));
