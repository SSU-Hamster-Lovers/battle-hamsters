# 다음 세션 로드맵 — 무기 스프라이트 + 투사체 물리

## 현재 상태 (2026-04-13)

PR #61 (`feat/weapon-system-phase2-4`) 리뷰/병합 대기 중.

완료된 작업:
- **Phase 2**: `aimProfile` visual clamp (Acorn Blaster -55~40°, Paws -30~30°)
- **Phase 3**: Seed Shotgun (5-pellet hitscan) + Hand Cannon (단발 고화력)
- **Phase 4**: Burn DoT — `BurnEffect` 런타임, `tick_burn_effects`, 3-레이어 파라메트릭 불꽃 시각화

## 다음 작업 우선순위

### 1순위 — 실제 아트 + 투사체 물리 (동시 Sprint)

브랜치: `feat/sprite-atlas-v1` + `feat/projectile-weapons-v1` (스펙: `docs/technical/mini-spec-projectile-weapons-v1.md`)

**왜 함께:** 투사체 sprite 텍스처(`ProjectileSnapshot.weaponId` 기반)와 무기 sprite atlas를 같은 Sprint에서 처리하면 자산 파이프라인을 한 번에 정리 가능.

**투사체 변환 범위:**
- `packages/shared/weapons/seed-shotgun.json`: `hitType: "hitscan"` → `"projectile"`, `projectileSpeed: 600`
- `packages/shared/weapons/hand-cannon.json`: `hitType: "hitscan"` → `"projectile"`, `projectileSpeed: 900`
- 서버: `ProjectileRuntime` 구조체, `server/src/room_projectiles.rs` 신규, `RoomState.projectiles: HashMap<String, ProjectileRuntime>`
- Shared: `ProjectileSnapshot` 타입, `MatchSnapshot.projectiles: ProjectileSnapshot[]`
- 클라이언트: `renderProjectiles()` — fallback 도형 + sprite 교체 가능 구조

**스프라이트 범위 (별도 스펙 필요):**
- 햄스터 sprite sheet (idle / run / jump / fall / respawning)
- 무기 sprite atlas (Acorn Blaster, Seed Shotgun, Hand Cannon pickup + projectile)
- 아이템 sprite (health pack, jump boost)

### 2순위 — Burn DoT 전용 무기 연결

Burn이 현재 `Paws`에 임시 연결되어 있다. 전용 무기(예: Flamethrower 계열) 추가 후 `paws.json`의 `specialEffect` 제거.

현재 Paws specialEffect: `{ "kind": "burn", "durationMs": 2200, "tickDamage": 2, "tickIntervalMs": 500 }`

### 3순위 — 서버 aim clamp (Step 3)

현재 `aimProfile` clamp는 클라이언트 표시 전용. 서버에서도 `aim` 벡터를 `aimProfile` 범위로 clamp하면 서버 판정 정확도 향상.

파일: `server/src/room_combat.rs` — hitscan/melee 판정 직전에 aim 각도를 clamp.

### 4순위 — 래그돌 / 사망 연출 v2

현재 weapon/self 사망은 임시 더미 구현. 실제 래그돌/시체 물리 시뮬레이션 필요.

---

## 다음 세션 시작 프롬프트

```
PR #61이 병합되었고, develop 최신이 그 내용을 반영한다고 가정하고 시작한다.

이번 세션의 목표: 무기 스프라이트 + Seed Shotgun / Hand Cannon 투사체 물리 구현.

관련 스펙: docs/technical/mini-spec-projectile-weapons-v1.md

먼저 아래 파일들을 읽어 현재 상태를 파악한 뒤 진행한다:
- docs/technical/current-implementation.md
- docs/technical/mini-spec-projectile-weapons-v1.md
- packages/shared/world.ts (ProjectileSnapshot 타입 추가 위치)
- server/src/main.rs (RoomState, ProjectileRuntime 추가 위치)
- server/src/room_combat.rs (HitType::Projectile 분기 추가 위치)
- packages/shared/weapons/seed-shotgun.json
- packages/shared/weapons/hand-cannon.json

브랜치: feat/projectile-weapons-v1 (develop에서 신규 분기)
```
