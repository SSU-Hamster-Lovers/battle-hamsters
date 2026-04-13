# 미니 스펙: 상태이상 1차 — Burn DoT

## 작업명

`feat/status-effects-burn-v1`

## 목표

상태이상 시스템 뼈대를 세우고, **Burn DoT** 한 종을 end-to-end로 동작시킨다.
`applicationChance` 없이 결정론적으로 적중 즉시 적용.

## 이번 범위 (구현 완료)

### Shared 타입

- `packages/shared/world.ts`
  ```ts
  export interface StatusEffectInstance {
    kind: "burn";
    killerId: EntityId | null;
    weaponId: EntityId;
    expiresAt: TimestampMs;
  }
  // PlayerSnapshot에 추가:
  effects: StatusEffectInstance[];
  ```
- `packages/shared/weapons.ts` — `WeaponSpecialEffect`에 burn 변형:
  ```ts
  | { kind: "burn"; durationMs: number; tickDamage: number; tickIntervalMs: number }
  ```

### 무기 JSON

- `packages/shared/weapons/paws.json` — `specialEffect` → burn (임시 연결):
  ```json
  "specialEffect": { "kind": "burn", "durationMs": 2200, "tickDamage": 2, "tickIntervalMs": 500 }
  ```

### 서버

- `server/src/main.rs`
  - `BurnEffect` 런타임 구조체 (내부 전용, 비직렬화):
    `killer_id`, `weapon_id`, `expires_at`, `next_tick_at`, `tick_damage`, `tick_interval_ms`
  - `StatusEffectSnapshot` (직렬화): `kind`, `killer_id`, `weapon_id`, `expires_at`
  - `PlayerRuntime.active_burn: Option<BurnEffect>`
  - `PlayerSnapshot.effects: Vec<StatusEffectSnapshot>`
- `server/src/game_data.rs` — `RuntimeWeaponSpecialEffect::Burn { duration_ms, tick_damage, tick_interval_ms }`
- `server/src/room_combat.rs`
  - `apply_or_refresh_burn()` — 명중 시 호출, duration refresh 방식 (중첩 없음)
  - `tick_burn_effects()` — 매 틱 DoT 적용, 만료 제거, 번 사망 귀속
  - melee / hitscan 명중 후 `RuntimeWeaponSpecialEffect::Burn` 체크
  - `reset_general_combat_state()` — `active_burn + effects` 초기화
- `server/src/room_runtime.rs` — `tick_gameplay()`에서 `tick_burn_effects` 호출

### 클라이언트

- `apps/game/src/main.ts`
  - `RenderedPlayer.burnFlame: Phaser.GameObjects.Graphics`
  - `updateBurnFlames()` — 60 FPS update() 루프에서 호출
  - `redrawBurnFlame()` — 3-레이어 파라메트릭 불꽃 실루엣 (sin 파형 기반)
    - 상단: 포물선 envelope + 이중 sin 파형 → 흔들리는 불꽃 혀
    - 하단: 반타원 → 발 아래 자연스러운 마감
    - 레이어: 붉은주황(외곽) → 주황(중간) → 노랑(코어)

## 번 상수

| 항목 | 값 |
|------|-----|
| durationMs | 2200 ms |
| tickIntervalMs | 500 ms |
| tickDamage | 2 |
| 최대 총 피해 | ~8 (2200ms / 500ms × 2 = 최대 4틱) |

## 설계 결정

- `applicationChance` 없음 — 적중 = 확정 burn (결정론적)
- Burn 사망 귀속: 기존 `DeathCause::Weapon { killer_id, weapon_id }` 재사용 (신규 variant 없음)
- `active_burn`은 runtime-only; `effects`만 클라이언트로 직렬화
- 현재 Paws에 임시 연결 — 전용 무기 추가는 후속 작업

## 비목표

- chill / shock / poison 등 추가 상태이상
- 상태이상 저항·해제 시스템
- 클라이언트 HUD 상태이상 아이콘 (burn 전용 무기 추가 시 구현)
- `applicationChance` 기반 확률 적중

## 검증

- `cargo test` 전체 통과 (39개)
- `pnpm typecheck` shared + game 통과
- Paws 명중 시 대상 플레이어에 파라메트릭 불꽃 표시 확인 (dev 서버)
- 2200ms 후 불꽃 자동 소멸 확인
- 리스폰 시 burn 즉시 해제 확인
