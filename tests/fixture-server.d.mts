export function startFixture(port?: number): Promise<{ origin: string; state: { count: number; failing: boolean; slow: boolean; dynamic: boolean; requests: number }; close(): Promise<void> }>;
