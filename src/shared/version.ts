import pkg from '../../package.json';
import source from '../../vendor/catpaw/SOURCE.json';
export const PLUGIN_VERSION = pkg.version;
export const CATPAW_SOURCE = { version: source.version, revision: source.revision };
