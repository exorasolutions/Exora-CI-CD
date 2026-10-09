const locks = new Map<string, { token: string; expiresAt: number }>();

export function acquireLock(key: string, ttlMs = 10 * 60_000): string {
  const now = Date.now();
  const existing = locks.get(key);
  if (existing && existing.expiresAt > now) throw new Error(`Deployment already in progress for ${key}`);
  const token = `${process.pid}-${now}-${Math.random().toString(36).slice(2)}`;
  locks.set(key, { token, expiresAt: now + ttlMs });
  return token;
}

export function releaseLock(key: string, token: string): void {
  const existing = locks.get(key);
  if (existing?.token === token) locks.delete(key);
}
