# 미니 스펙: 픽업 소멸 VFX v1 — 점멸 + 블랙홀 흡수 연출

## 작업명

`feat/pickup-despawn-vfx-v1`

## 목표

월드의 무기/아이템 픽업이 소멸 직전, 점멸 이후 블랙홀처럼 한 점으로 빨려 들어가며 사라지는 연출을 추가한다.

## 현재 상태

`resolvePickupBlinkAlpha`가 남은 시간 비율에 따라 3단계 점멸 속도(220ms → 140ms → 70ms)를 적용한다.  
소멸 자체는 서버가 픽업을 스냅샷에서 제거하는 시점에 클라이언트도 삭제하는 방식이다.

현재 점멸은 **alpha 토글**만 있고, scale/위치 변화는 없다.

## 원하는 연출

소멸 마지막 **500ms** 동안 두 레이어를 추가한다:

### 레이어 1: X축 흔들림 (shake)
- `xOffset = sin(now_ms * freq) * MAX_SHAKE * (1 - collapseRatio)`
  - `collapseRatio`: 0(collapse 시작) → 1(소멸 순간)
  - 남은 시간이 적을수록 흔들림 진폭이 커진다
  - `MAX_SHAKE`: ±5px
  - 주파수: `freq = 0.045` (약 14Hz에서 점점 빠르게 느껴지도록)

### 레이어 2: Scale 수축
- `scale = 1 - collapseRatio^0.5`
  - easeIn 곡선으로 처음에는 천천히, 마지막 순간에 빠르게 0에 수렴
  - 0에 가까워질수록 급격히 사라지는 느낌

### 기존 점멸 유지
- alpha 점멸 로직은 그대로 유지한다
- 결과적으로: 빠르게 깜빡이면서 + 좌우로 흔들리면서 + 오그라들어 사라지는 연출

```
시간 흐름 (소멸 기준 역순):
   t = -총생존시간  ████████████████░░░░░░░░░░░  → 점멸 없음
   t = -35%        ████░░██░░██░░██░░██           → 점멸 시작 (220ms 주기)
   t = -18%        ██░░██░░██░░                   → 점멸 빠름 (140ms 주기)
   t =  -8%        █░█░█░█░                       → 점멸 매우 빠름 (70ms)
   t = -500ms      + shake 시작 (흔들림 + scale 수축)
   t =    0        → 사라짐
```

## 이번 범위

- 무기 픽업 소멸 VFX: `renderedWeaponPickups`의 `root`에 scale + xOffset 적용
- 아이템 픽업 소멸 VFX: `renderedItemPickups`의 `body` + `label`에 동일 적용
- 연출 계산 함수 `resolvePickupCollapseTransform(spawnedAt, despawnAt, now)` 추가

## 건드리는 파일

| 파일 | 변경 |
|------|------|
| `apps/game/src/main.ts` | `resolvePickupCollapseTransform` 추가, `step()` 픽업 업데이트 루프 수정 |

## 비목표

- 서버 측 변경 없음 (소멸 타이밍은 서버 기준 그대로)
- 스폰 연출 변경 (fade_in / airdrop은 별도)
- 사운드 효과 추가

## 구현 방향

### 새 함수

```typescript
private resolvePickupCollapseTransform(
  spawnedAt: number,
  despawnAt: number | null,
  now: number,
): { scale: number; xOffset: number } {
  const COLLAPSE_DURATION = 500;
  const MAX_SHAKE = 5;
  const SHAKE_FREQ = 0.045;

  if (despawnAt === null) return { scale: 1, xOffset: 0 };

  const remaining = despawnAt - now;
  if (remaining > COLLAPSE_DURATION) return { scale: 1, xOffset: 0 };
  if (remaining <= 0) return { scale: 0, xOffset: 0 };

  const collapseRatio = 1 - remaining / COLLAPSE_DURATION; // 0 → 1
  const scale = 1 - Math.sqrt(collapseRatio);
  const xOffset = Math.sin(now * SHAKE_FREQ) * MAX_SHAKE * collapseRatio;

  return { scale, xOffset };
}
```

### 적용 위치 (step 루프)

무기 픽업:
```typescript
const { scale, xOffset } = this.resolvePickupCollapseTransform(
  rendered.spawnedAt, rendered.despawnAt, this.time.now
);
rendered.root.setScale(scale);
rendered.root.x = rendered.targetX + xOffset;
```

아이템 픽업:
```typescript
const { scale, xOffset } = this.resolvePickupCollapseTransform(
  rendered.spawnedAt, rendered.despawnAt, this.time.now
);
rendered.body.setScale(scale);
rendered.body.x = rendered.targetX + xOffset;
rendered.label.setScale(scale);
```

### 기존 alpha 로직 유지

`resolvePickupBlinkAlpha`는 그대로 두고, 위 transform과 독립적으로 중첩 적용한다.

## 검증 방법

- 무기 픽업이 소멸 500ms 전부터 흔들리며 오그라드는지 확인
- 아이템 픽업 동일 확인
- 소멸 시 scale이 0으로 부드럽게 수렴하는지 확인
- 기존 점멸 패턴과 자연스럽게 겹치는지 확인
- 줍기(pickup) 즉시 제거 시 연출이 튀지 않는지 확인

## 참고

- 현재 기존 점멸 구간: 잔여 비율 35% 이하부터 시작
- Collapse 구간(마지막 500ms)은 점멸 구간과 겹쳐도 괜찮음 — 두 효과가 자연스럽게 합산됨
- `armory` 무기들은 `despawnAfterMs: 6000ms`이므로 소멸 연출이 자주 보임 → 연출 테스트 적합
