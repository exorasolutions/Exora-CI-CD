export class DeliveryDedupe {
  #seen = new Map<string, number>();
  constructor(private readonly ttlMs = 24 * 60 * 60 * 1000) {}

  hasOrAdd(id: string, now = Date.now()): boolean {
    for (const [key, expiry] of this.#seen) if (expiry <= now) this.#seen.delete(key);
    if (this.#seen.has(id)) return true;
    this.#seen.set(id, now + this.ttlMs);
    return false;
  }
}
