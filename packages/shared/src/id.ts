export function createId(): string {
  return crypto.randomUUID();
}

export function createTableCode(): string {
  return Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
}
