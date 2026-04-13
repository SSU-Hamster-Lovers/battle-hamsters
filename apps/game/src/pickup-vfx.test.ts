import assert from "node:assert/strict";
import { resolvePickupCollapseTransform } from "./pickup-vfx.ts";

// 헬퍼
function assertClose(actual: number, expected: number, tol = 0.001, msg?: string) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${msg ?? ""} expected ~${expected}, got ${actual}`,
  );
}

// 1. despawnAt === null → 기본값 반환
{
  const { scale, xOffset } = resolvePickupCollapseTransform(0, null, 1000);
  assert.equal(scale, 1, "no despawnAt: scale should be 1");
  assert.equal(xOffset, 0, "no despawnAt: xOffset should be 0");
}

// 2. remaining > 500ms → collapse 미시작, 기본값 반환
{
  const now = 1000;
  const despawnAt = now + 600; // remaining=600 > COLLAPSE_DURATION=500
  const { scale, xOffset } = resolvePickupCollapseTransform(0, despawnAt, now);
  assert.equal(scale, 1, "outside collapse window: scale should be 1");
  assert.equal(xOffset, 0, "outside collapse window: xOffset should be 0");
}

// 3. remaining <= 0 → scale=0, xOffset=0
{
  const now = 2000;
  const despawnAt = now - 10; // 이미 소멸 시각 지남
  const { scale, xOffset } = resolvePickupCollapseTransform(0, despawnAt, now);
  assert.equal(scale, 0, "expired: scale should be 0");
  assert.equal(xOffset, 0, "expired: xOffset should be 0");
}

// 4. 정확히 collapse 시작 시점 (remaining=500 → collapseRatio=0)
{
  const now = 1000;
  const despawnAt = now + 500; // remaining=500, collapseRatio=0
  const { scale, xOffset } = resolvePickupCollapseTransform(0, despawnAt, now);
  // collapseRatio=0 → scale=1-sqrt(0)=1, xOffset=sin(...)*MAX_SHAKE*0=0
  assertClose(scale, 1, 0.001, "collapseRatio=0: scale");
  assertClose(xOffset, 0, 0.001, "collapseRatio=0: xOffset");
}

// 5. remaining=250ms (collapseRatio=0.5) → scale = 1 - sqrt(0.5) ≈ 0.293
{
  const now = 1000;
  const despawnAt = now + 250;
  const { scale } = resolvePickupCollapseTransform(0, despawnAt, now);
  assertClose(scale, 1 - Math.sqrt(0.5), 0.001, "collapseRatio=0.5: scale");
}

// 6. remaining → 0 일수록 scale → 0에 수렴
{
  const now = 1000;
  const despawnAt = now + 50; // remaining=50, collapseRatio=0.9
  const { scale } = resolvePickupCollapseTransform(0, despawnAt, now);
  assertClose(scale, 1 - Math.sqrt(0.9), 0.001, "collapseRatio=0.9: scale");
  assert(scale < 0.1, `near end: scale should be close to 0, got ${scale}`);
}

// 7. xOffset 진폭이 collapseRatio에 비례 — remaining=250 vs remaining=50
{
  const now = 10000; // sin(10000 * 0.045) ≠ 0 인 타임스탬프
  const sinVal = Math.sin(now * 0.045);
  if (Math.abs(sinVal) > 0.3) {
    // sin 값이 유의미할 때만 검사
    const r250 = resolvePickupCollapseTransform(0, now + 250, now);
    const r50 = resolvePickupCollapseTransform(0, now + 50, now);
    assert(
      Math.abs(r50.xOffset) > Math.abs(r250.xOffset),
      `closer to despawn → larger shake amplitude (${Math.abs(r50.xOffset)} > ${Math.abs(r250.xOffset)})`,
    );
  }
}

console.log("✓ 모든 resolvePickupCollapseTransform 테스트 통과");
