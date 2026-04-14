# 미니 스펙: 투사체 무기 1차 — Seed Shotgun + Hand Cannon 투사체화

## 작업명

`feat/projectile-weapons-v1`

## 배경 / 동기

Seed Shotgun과 Hand Cannon은 현재 **hitscan**으로 구현되어 있다. 빠른 속도의 투사체로 전환하면:
- 물리적 거리감과 탄환 회피 가능성이 생겨 전투 전략 깊이가 늘어난다
- 투사체 시각화(tracer / 탄환 sprite)를 실제로 렌더링할 수 있다
- 향후 폭발·관통 같은 투사체 상호작용을 확장할 수 있다

**스프라이트 작업과 동시 진행 목적**: 투사체 sprite와 tracer 연출은 무기·아이템 실제 아트와 같은 sprint에서 함께 구현하면 자산 파이프라인을 한 번에 정리할 수 있다.

## 이번 범위

### 1. JSON 변경

- `packages/shared/weapons/seed-shotgun.json`
  - `hitType`: `"hitscan"` → `"projectile"`
  - `projectileSpeed`: 600 (px/s 단위, 20 TPS 기준 약 30px/tick)
    - 근거: Acorn 사거리(~400px) 기준 약 0.67초 도달 → 눈으로 보이면서도 충분히 빠른 산탄

- `packages/shared/weapons/hand-cannon.json`
  - `hitType`: `"hitscan"` → `"projectile"`
  - `projectileSpeed`: 900 (px/s, 20 TPS 기준 약 45px/tick)
    - 근거: 고화력 단발 특성상 산탄보다 더 빠르되, 화면에서 추적 가능한 속도

### 2. 서버: 투사체 런타임 추가

**신규 구조체** (`server/src/main.rs`):
```rust
struct ProjectileRuntime {
    id: String,
    owner_id: String,
    weapon_id: String,
    position: Vector2,
    velocity: Vector2,      // 픽셀/초
    damage: u16,
    knockback: f64,
    range_remaining: f64,   // 남은 최대 사거리
    special_effect: RuntimeWeaponSpecialEffect,
    spawned_at: u64,
}
```

**`RoomState`에 추가**:
```rust
projectiles: HashMap<String, ProjectileRuntime>,
next_projectile_id: u64,
```

**신규 파일** `server/src/room_projectiles.rs`:
- `spawn_projectiles(shooter_id, weapon, aims, shooter_pos, now_ms)` — pellet별 투사체 생성
- `step_projectiles(now_ms, deaths, dying_this_tick)` — 매 틱 위치 갱신·충돌 체크·사거리 소진 처리

기존 `room_combat.rs`의 hitscan 섹션에서 `HitType::Hitscan` 분기 외에 `HitType::Projectile` 분기 추가:
- 쿨다운·탄 소모·반동은 즉시 처리 (기존과 동일)
- 레이 판정 대신 `spawn_projectiles()` 호출

### 3. Shared 프로토콜: 투사체 스냅샷

`packages/shared/world.ts`:
```ts
export interface ProjectileSnapshot {
  id: EntityId;
  ownerId: EntityId;
  weaponId: EntityId;
  position: Vector2;
  velocity: Vector2;
}

// MatchSnapshot.projectiles 타입을 unknown[] → ProjectileSnapshot[]로 변경
```

서버 `WorldSnapshotPayload.projectiles`를 실제 투사체 배열로 채운다.

### 4. 클라이언트: 투사체 렌더링

`apps/game/src/main.ts`:
- `renderProjectiles(projectiles: ProjectileSnapshot[])` 신규 메서드
- 기본 표현: 작은 원 + 짧은 꼬리 (tracer line)
  - Seed Shotgun pellet: 작은 초록 원 (`0x55ee66`, r=3) + 4px 꼬리
  - Hand Cannon bullet: 큰 주황 원 (`0xff8800`, r=5) + 8px 꼬리
- 스프라이트 교체 시: sprite atlas의 bullet 텍스처로 교체 가능한 구조로 작성
- 투사체는 보간 없이 서버 위치 그대로 렌더링 (빠른 속도라 1-2프레임 오차 무시)

`update()` 루프에서 투사체 위치 보간 또는 클라이언트 예측은 **이번 범위 밖** — 서버 50ms 단위로 스냅샷을 받는 방식 유지.

## 건드릴 파일

| 파일 | 변경 |
|------|------|
| `packages/shared/weapons/seed-shotgun.json` | hitType + projectileSpeed |
| `packages/shared/weapons/hand-cannon.json` | hitType + projectileSpeed |
| `packages/shared/world.ts` | `ProjectileSnapshot` 타입, `MatchSnapshot.projectiles` 타입 |
| `server/src/main.rs` | `ProjectileRuntime`, `RoomState.projectiles`, snapshot 직렬화 |
| `server/src/room_combat.rs` | `HitType::Projectile` 분기 추가 |
| `server/src/room_projectiles.rs` | 신규 — 투사체 spawn/step/hit 처리 |
| `server/src/room_runtime.rs` | `step_projectiles()` 통합 |
| `apps/game/src/main.ts` | `renderProjectiles()`, 투사체 시각화 |

## 비목표

- 투사체 중력 (직선 이동만)
- 투사체 관통 / 벽 튕김
- 투사체 client-side 보간·예측
- Berry Launcher / 폭발 투사체 (별도 mini-spec)
- Acorn Blaster 투사체화 (hitscan 유지)

## 스프라이트 작업과의 연계

이 스펙은 **무기 sprite atlas가 추가되는 같은 브랜치/sprint에서** 구현하도록 설계한다:
- `ProjectileSnapshot.weaponId`로 투사체 sprite 텍스처를 결정하는 구조 미리 준비
- sprite 없으면 fallback 도형(위 §4) 자동 사용
- atlas 추가 시 `resolveProjectileTexture(weaponId)` 함수만 채우면 됨

## 검증

- `cargo test` 전체 통과
- Seed Shotgun: 5개 투사체가 퍼져서 날아가는 것 확인 (dev 서버 슬로우 모션 테스트)
  - `projectileSpeed` 값을 60으로 낮춰 궤적 육안 확인
- Hand Cannon: 단발 투사체 고속 이동 확인
- 사거리 초과 시 투사체 자동 소멸 확인
- 투사체 hit 판정이 서버 authoritative로 동작 확인
