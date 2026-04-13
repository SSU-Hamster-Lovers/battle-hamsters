# 다음 세션 로드맵 — 원웨이 플랫폼 하강 안정화 + 전투 후속 작업

## 현재 상태 (2026-04-13)

PR #61 (`feat/weapon-system-phase2-4`)이 `develop`에 병합되었고, 현재 작업 브랜치는 `feat/projectile-gravity-v1`이다.

완료된 작업:
- **Phase 2**: `aimProfile` visual clamp (Acorn Blaster -55~40°, Paws -30~30°)
- **Phase 3**: Seed Shotgun + Hand Cannon 추가
- **Phase 4**: Burn DoT — `BurnEffect` 런타임, `tick_burn_effects`, 3-레이어 파라메트릭 불꽃 시각화
- **Phase 5**: Seed Shotgun / Hand Cannon 투사체 1차 — `ProjectileRuntime`, `ProjectileSnapshot`, `renderProjectiles()` fallback
- **Phase 5.5**: 자유맵 armory 테스트 구역 + 짧은 무기 스폰 주기, Paws 임시 Burn 제거
- **Phase 5.6**: 투사체 클라이언트 보간/짧은 예측으로 시각적 계단 현상 완화
- **Phase 5.7**: 투사체 충돌 정책 v2 — one-way platform 상향 통과, 수직 넉백 누적 버그 수정
- **Phase 5.8**: 서버 aim clamp v1 — `aimProfile`이 melee / hitscan / projectile / self recoil에 공통 적용
- **Phase 5.9**: 투사체 중력 / 포물선 v1 — `projectileGravityPerSec2`, 서버 포물선 적분, 클라이언트 중력 예측
- **Known Bug**: 플레이어 `dropThroughUntil`이 모든 one-way platform을 함께 무시해서, 가까운 플랫폼 두 개를 한 번에 통과할 수 있음

## 다음 작업 우선순위

### 1순위 — 원웨이 플랫폼 drop-through 안정화 v1

브랜치 후보: `fix/one-way-drop-through-v1`

**왜 지금:** 자유맵 armory처럼 세로 간격이 가까운 플랫폼 조합에서 실제 이동 문법이 깨진다. 이건 TPS 튜닝보다 충돌 계약 문제라서, 다음 스프린트에서 먼저 구조를 바로잡는 게 맞다.

관련 스펙:
- `docs/technical/mini-spec-one-way-drop-through-v1.md`
- `docs/technical/collision-contract.md`
- `docs/technical/current-implementation.md`

핵심 작업:
- 하강 시작 시 source one-way platform 식별
- `dropThroughUntil` 전역 무시를 source platform 단위 무시로 축소
- 가까운 두 플랫폼에서 첫 번째만 통과하고 두 번째에 다시 착지하는지 검증

### 2순위 — 실제 아트 atlas / spritesheet 연결

브랜치 후보: `feat/sprite-atlas-v1`

**준비된 연결 지점:**
- `ProjectileSnapshot.weaponId` 기반 projectile texture 선택 가능
- `renderProjectiles()` fallback 도형이 이미 있어 sprite atlas로 자연스럽게 교체 가능

### 3순위 — Burn DoT 전용 무기 연결

Burn 런타임/시각화는 살아 있지만 현재 연결된 무기는 없다. 전용 무기(예: Flamethrower 계열)를 추가해 실제 gameplay로 다시 연결한다.

### 4순위 — 래그돌 / 사망 연출 v2

현재 weapon/self 사망은 임시 더미 구현. 실제 래그돌/시체 물리 시뮬레이션 필요.

---

## 다음 세션 시작 프롬프트

```
PR #61이 develop에 병합된 상태에서 시작한다.

이번 세션의 목표: one-way platform 하강이 source platform 1개만 통과하도록 안정화한다.

관련 스펙:
- docs/technical/mini-spec-one-way-drop-through-v1.md
- docs/technical/collision-contract.md
- docs/technical/current-implementation.md

먼저 아래 파일들을 읽어 현재 상태를 파악한 뒤 진행한다:
- docs/technical/current-implementation.md
- docs/technical/mini-spec-one-way-drop-through-v1.md
- server/src/room_runtime.rs
- packages/shared/world.ts
- packages/shared/maps/training-arena.json

브랜치: fix/one-way-drop-through-v1
```
