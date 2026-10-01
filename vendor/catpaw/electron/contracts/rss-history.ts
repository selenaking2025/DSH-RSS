/** A committed RSS page boundary. Never supplied by renderer input. */
export type RssHistoryCursor = {
  nextUrl: string;
  pendingSeedUrls: string[];
  visited: string[];
  pages: number;
  scannedItems: number;
  reachedBoundary: boolean;
  sourceRsshubBase: string | null;
};
