# 미니 스펙: 무기 확장 v4 (14~15번째 무기) — 스턴 + 공습

> **상태**: `feat/weapons-expansion-v4` 완료 (2026-04-14). 누적 무기 13종 → 15종. 서버 테스트 78개 PASS.

---

## 무기 A — 스턴 도토리 (`stun_acorn`) ★ 1순위

### 테마
마비 성분이 있는 도토리를 발사하는 단발 히트스캔 무기.
맞은 플레이어는 1.5초간 이동·점프 불가 상태(스턴)에 빠진다.
콤보 세팅 또는 낙사 유도에 활용.

### 주요 스탯

| 항목 | 값 |
|------|-----|
| hitType | `hitscan` |
| fireMode | `single` |
| resourceModel | `magazine` |
| maxResource | 6 |
| resourcePerShot | 1 |
| damage | 12 |
| knockback | 4 |
| selfRecoilForce | 3 |
| attackIntervalMs | 900 |
| range | 700 |
| rarity | `uncommon` |
| specialEffect | `{ kind: "stun", durationMs: 1500 }` |
| aimProfile | -40° ~ +40° |

### 새 서버 로직 — `stun` specialEffect

- `RuntimeWeaponSpecialEffect::Stun { duration_ms }` 추가
- `PlayerRuntime.active_stun: Option<StunEffect>` 필드 추가
- `step_player()`: stunned 중이면 move_x = 0, jump 무시
- `tick_stun_effects(now_ms)`: 만료된 stun 제거 + effects 에서 `"stun"` 항목 제거
- `apply_or_refresh_stun(player, expires_at)`: stun 적용/갱신
- `reset_player_state()`: active_stun 초기화
- `StatusEffectSnapshot { kind: "stun" }` 클라이언트 전달

### 비주얼
- Pickup: 노란색 도토리 + 번개 표시 (22×22)
- Equip: 짧은 총신 + 도토리 탄창 오버레이 (32×12)
- Fire style: `stun_flash` — 짧고 굵은 노란 tracer + 목표에 전기 파편 3개
- Impact: `stun_spark` — 노란/흰색 전기 파편 4~5개 + 지속 번개 텍스트("⚡")

### 난이도: ★★☆☆ (burn/grab 패턴 그대로 재사용, 이동 억제 신규)

---

## 무기 B — 공습 리모컨 (`airstrike_remote`) ★ 2순위

### 테마
비콘을 던지면 2.5초 후 해당 X 열(column)에 공중폭격이 내려온다.
직접 타격은 없고 비콘 착탄 위치 기준으로 전장 경고 → 수직 열 AoE.
예측과 교란으로 이기는 "전략 무기".

### 주요 스탯

| 항목 | 값 |
|------|-----|
| hitType | `projectile` |
| fireMode | `single` |
| resourceModel | `magazine` |
| maxResource | 1 |
| resourcePerShot | 1 |
| damage | 0 (비콘 직접 피해 없음) |
| knockback | 0 |
| selfRecoilForce | 1.0 |
| attackIntervalMs | 800 |
| projectileSpeed | 600 |
| projectileGravityPerSec2 | 800 |
| range | 1000 |
| rarity | `rare` |
| specialEffect | `{ kind: "airstrike", delayMs: 2500, columnHalfWidth: 60, splashDamage: 70, knockback: 25 }` |
| discardOnEmpty | true |
| aimProfile | -60° ~ +60° |

### 새 서버 로직 — `airstrike` specialEffect + WorldEvent 시스템

```json
"specialEffect": {
  "kind": "airstrike",
  "delayMs": 2500,
  "columnHalfWidth": 60,
  "splashDamage": 70,
  "knockback": 25
}
```

**비콘 투사체 동작**:
- 기존 projectile 인프라 그대로 사용 (중력 포물선)
- 지형/플레이어 충돌 시 → 직접 피해 0, 즉시 소멸
- 소멸 시 `WorldEvent::Airstrike` 생성 (비콘 x 위치 + delayMs)

**WorldEvent 시스템 (신규)**:
- `WorldEventRuntime` 구조체: id, kind, trigger_at_ms, x
- `WorldEventKind::Airstrike { x, column_half_width, splash_damage, knockback, attacker_id, weapon_id }`
- `RoomState.world_events: Vec<WorldEventRuntime>` + `next_world_event_id: u64`
- `step_world_events(now_ms)`: trigger_at_ms 도달 시 열 내 모든 플레이어에게 피해 적용 후 이벤트 제거
- 열 충돌 기준: `|player.x - event.x| < column_half_width` (Y 무관)

**새 공유 타입**:
- `WorldEventSnapshot { id, kind: "airstrike", x, columnHalfWidth, triggerAtMs }`
- `MatchSnapshot.worldEvents: WorldEventSnapshot[]`

### 비주얼
- Pickup: 작은 리모컨 + 안테나 (24×18)
- Equip: 오버레이 (30×10) — 짧은 리모컨 모양
- 비콘 투사체: 빨간 점멸 원 (4px) + 연기 파티클
- Fire style: `beacon_toss` — 포물선 예측선 (throw_arc 재사용)
- 위험 지역: 빨간 수직 직사각형 컬럼 (alpha 0.25) + 카운트다운 텍스트
- 공습 VFX: 화면 위에서 빠른 흰/빨간 수직 섬광 → 하단 폭발 burst (spawnExplosionBurst 재사용)
- 경고 배너: HUD 상단 "공습 경고! ⚠" 텍스트 (2초간)

### 난이도: ★★★☆ (WorldEvent 시스템 신규 + 경고 UI 신규, 열 AoE 신규)

---

## 구현 순서

| 순서 | 무기 | 상태 |
|------|------|------|
| 1차 | **무기 A** (스턴 도토리) | 진행 중 |
| 2차 | **무기 B** (공습 리모컨) | 대기 |

---

## 수정 파일 목록

| 파일 | 작업 |
|------|------|
| `docs/technical/mini-spec-weapons-expansion-v4.md` | 신규 (이 파일) |
| `packages/shared/weapons.ts` | WeaponSpecialEffect에 stun + airstrike 추가 |
| `packages/shared/world.ts` | WorldEventSnapshot 타입 + MatchSnapshot.worldEvents 필드 |
| `packages/shared/weapons/stun-acorn.json` | 신규 |
| `packages/shared/weapons/airstrike-remote.json` | 신규 |
| `packages/shared/weapon-data.ts` | 두 무기 등록 |
| `server/src/game_data.rs` | RuntimeWeaponSpecialEffect + include_str! |
| `server/src/main.rs` | StunEffect + WorldEventRuntime + PlayerRuntime 필드 + TDD 테스트 |
| `server/src/room_combat.rs` | apply_or_refresh_stun, tick_stun_effects |
| `server/src/room_projectiles.rs` | airstrike 비콘 충돌 → WorldEvent 생성 |
| `server/src/room_runtime.rs` | step_player stun 억제 + step_world_events 호출 |
| `server/src/room_world_events.rs` | step_world_events 구현 (신규 파일) |
| `apps/game/src/weapon-presentation.ts` | 스프라이트 + fire style |
| `apps/game/src/main.ts` | stun_flash/beacon_toss 이펙트 + 위험지역 렌더링 + 공습 VFX |
| `docs/technical/current-implementation.md` | 상태 반영 |

---

## 참고

- burn 구현: `server/src/room_combat.rs::apply_or_refresh_burn`
- grab 구현: `server/src/room_combat.rs::tick_grab_effects`
- timed_explode: `server/src/room_projectiles.rs::step_projectiles`
- apply_explosion: `server/src/room_projectiles.rs::apply_explosion`
