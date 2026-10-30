// Only auth and idempotency receipts use browser storage. Business snapshots stay in memory.
export const commandStorage = {
  async getItem(key: string) { return localStorage.getItem(key); },
  async setItem(key: string, value: string) { localStorage.setItem(key, value); },
  async removeItem(key: string) { localStorage.removeItem(key); },
};
