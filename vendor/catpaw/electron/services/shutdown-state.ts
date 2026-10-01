let shuttingDown = false;
export const isShuttingDown = () => shuttingDown;
export function beginShutdown() { shuttingDown = true; }
