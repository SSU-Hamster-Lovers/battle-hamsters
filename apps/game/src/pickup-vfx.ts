const COLLAPSE_DURATION = 500;
const MAX_SHAKE = 5;
const SHAKE_FREQ = 0.045;

export function resolvePickupCollapseTransform(
  _spawnedAt: number,
  despawnAt: number | null,
  now: number,
): { scale: number; xOffset: number } {
  if (despawnAt === null) return { scale: 1, xOffset: 0 };

  const remaining = despawnAt - now;
  if (remaining > COLLAPSE_DURATION) return { scale: 1, xOffset: 0 };
  if (remaining <= 0) return { scale: 0, xOffset: 0 };

  const collapseRatio = 1 - remaining / COLLAPSE_DURATION; // 0 → 1
  const scale = 1 - Math.sqrt(collapseRatio);
  const xOffset = Math.sin(now * SHAKE_FREQ) * MAX_SHAKE * collapseRatio;

  return { scale, xOffset };
}
