let cachedPrice: number | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000; // refresh every 60s

export async function fetchSolPrice(): Promise<number> {
  const now = Date.now();
  if (cachedPrice !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedPrice;
  }
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { cache: "no-store" }
    );
    const data = (await res.json()) as { solana?: { usd?: number } };
    const price = data.solana?.usd ?? cachedPrice ?? 0;
    cachedPrice = price;
    cachedAt = now;
    return price;
  } catch {
    return cachedPrice ?? 0;
  }
}

export function lamportsToUsd(lamports: number, solPrice: number): string {
  const sol = lamports / 1_000_000_000;
  const usd = sol * solPrice;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(6)}`;
}
