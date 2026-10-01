import type { RssBridge } from '../../electron/contracts/rss';
declare global { interface Window { catpaw?: { rss: RssBridge }; } }
