import { getDb } from '../data/db-core';
import { ensureSourceEndpointSeedData, listSourceFeedSnapshots } from '../data/source-endpoint-sync';
import { saveSourceCapabilities } from '../data/source-capabilities-repo';
import { resolveWebCliTwitterHandle } from '../sources/twitter-metadata';
import { resolveWebCliCommand } from '../integrations/web-cli-command';

/** Application startup owns provider seeding; opening a DB connection never loads adapters. */
export async function initializeReaderData() {
  const database = getDb();
  const needsWebCli = listSourceFeedSnapshots(database).some((feed) => feed.sourceStrategy === 'twitter' && resolveWebCliTwitterHandle(feed));
  const capabilities = { webCliTwitter: needsWebCli && Boolean(await resolveWebCliCommand()) };
  database.transaction(() => {
    saveSourceCapabilities(database, capabilities);
    ensureSourceEndpointSeedData(database, capabilities);
  }).immediate();
  return database;
}
