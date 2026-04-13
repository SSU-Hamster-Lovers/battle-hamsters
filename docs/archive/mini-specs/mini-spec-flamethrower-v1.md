# 미니 스펙: 화염방사 무기 v1 — 불씨 뿌리개

> **상태: 구현 완료** — `feat/flamethrower-v1` → `develop` (PR #69, #70 머지, 2026-04-13)
>
> 주요 구현 후기: 스펙 대비 변경된 항목은 ① `resourceModel` infinite → magazine(100발), ② 파티클 burst 규모 축소(10~14개 → 2~3개/틱), ③ burn 틱 타이머 버그(refresh 시 `next_tick_at` 재설정 문제) 수정 포함.

## 작업명

`feat/flamethrower-v1`

## 이름 후보

| 한글 | 영문 ID | 설명 |
|------|---------|------|
| **불씨 뿌리개** *(추천)* | `ember_sprinkler` | 물 뿌리개(water sprinkler)의 반대 개념 — 아이러니가 개그 포인트 |
| 도토리 볶음기 | `acorn_roaster` | 도토리를 볶아 내뿜는 주방 기기 느낌 |
| 열폭 발사기 | `heat_blaster` | 열폭(열폭발/분노)의 이중 의미 |

이 문서에서는 **불씨 뿌리개 / `ember_sprinkler`** 기준으로 작성. 최종 이름은 작업 시작 전 확정.

---

## 목표

햄스터식 화염방사기를 추가한다.  
공격 버튼을 누르고 있으면 포물선 파티클 스트림이 연속 분사되고, 맞은 대상에게 **Burn DoT**가 적용된다.

---

## 무기 설계

### 기본 스탯

| 항목 | 값 | 비고 |
|------|-----|------|
| hitType | `melee` | 기존 cone hit 인프라 재사용 |
| fireMode | `single` | fire-and-forget으로 연속 발사 |
| attackIntervalMs | 100 | 10 hits/s |
| range | 170 | px, 현재 Paws(42)보다 훨씬 길다 |
| damage | 3 | 직접 피해 낮음, 번 DoT가 핵심 |
| knockback | 0.5 | 약한 밀침 |
| specialEffect | burn | durationMs: 2500, tickDamage: 3, tickIntervalMs: 400 |
| resourceModel | `magazine` | 100발, 소진 시 버려짐 (약 10초 연사) |
| maxResource | 100 | |
| resourcePerShot | 1 | |
| discardOnEmpty | true | |
| aimProfile | -20° ~ +20° | 좁은 조준각 |
| worldDespawnMs | 8000 | |
| pickupWeight | 2 | 맵 희귀 스폰 |

### Cone 형태 (기존 Paws와 비교)

```
Paws:             [14px]──────────[56px]
                  near_half_w=7   far_half_w=21

ember_sprinkler:  [14px]──────────────────────────[184px]
                  near_half_w=5                    far_half_w=60
```

- 시작은 좁고 끝은 넓다 → 실제 화염방사기처럼 갈수록 퍼지는 모양

---

## 이번 범위

### 서버

1. **Cone 파라미터 확장** (`game_data.rs`, `room_combat.rs`)
   - `RuntimeWeaponDefinition`에 옵셔널 필드 추가:
     - `melee_cone_near_half_width: Option<f64>` — 없으면 `PLAYER_HALF_SIZE * 0.5`
     - `melee_cone_far_half_width: Option<f64>` — 없으면 `PLAYER_HALF_SIZE * 1.5`
   - `find_melee_target`이 위 값을 읽어 cone을 계산
   - 기존 Paws는 `null` → 변경 없음

2. **무기 JSON** (`packages/shared/weapons/ember-sprinkler.json`)
   - 위 스탯 정의
   - `specialEffect: { "kind": "burn", "durationMs": 2500, "tickDamage": 3, "tickIntervalMs": 400 }`
   - `meleeConeNearHalfWidth: 5`, `meleeConeFarHalfWidth: 60`

3. **맵 스폰** (`packages/shared/maps/training-arena.json`)
   - armory 상단 shelf에 고정 스폰 1개 추가
   - `despawnAfterMs: 8000`, `respawnMs: 5000`

### 클라이언트 — 파티클 스트림 VFX

`apps/game/src/weapon-presentation.ts` (또는 `flamethrower-vfx.ts` 신규 분리)

**발사 감지:**
- `resolveWeaponFireStyle`에 `ember_sprinkler` case 추가
- 매 공격마다 `spawnFlameParticles(origin, aimDir, now)` 호출

**파티클 1개 설계 (실제 구현 기준):**

| 항목 | 값 |
|------|-----|
| 초기 속도 | aim 방향 × 4.5~7.5 px/frame + ±0.3 수직 퍼짐(perp 방향) |
| 중력 | 0.31 px/frame² |
| drag | 0.98 /frame |
| 수명 | 280~430ms (랜덤) |
| 크기 | 4~6.5px 타원, scaleXVelocity=0.022, scaleYVelocity=0.018 (시간에 따라 성장) |
| 색상 | `#ffdd44`, `#ff9900`, `#ff6600`, `#ff3300`, `#ffaa00` 중 랜덤 |
| 알파 | 수명 50% 이전: baseAlpha(0.85), 이후 페이드 아웃 |
| 개수 / burst | 2~3개 (50ms 틱마다 생성, attack 버튼 누르는 동안) |

**렌더링:**
- `Phaser.GameObjects.Ellipse` — hitParticles 배열 재사용
- 매 update()마다 위치(중력/drag 적용), 크기, 알파 재계산

### 클라이언트 — 픽업 스프라이트

- Phaser Graphics 코드 생성 (아직 아트 없음)
- 작은 주황/빨간 원통형 (화염방사기 탱크 실루엣) + `EB` 글리프 라벨
- 향후 atlas 스프라이트로 교체 예정

---

## 비목표

- 실제 스프라이트 아트 (아직 placeholder)
- 무기 장착 오버레이 애니메이션 (fallback 사용)
- AoE/폭발 피해 (v1은 단순 cone hit)
- 지형 충돌하는 불꽃 — 파티클은 순수 시각 연출, 서버 판정과 무관
- 연기/잔불 after-effect

---

## 건드리는 파일

| 파일 | 변경 |
|------|------|
| `packages/shared/weapons/ember-sprinkler.json` | 신규 — 무기 정의 |
| `packages/shared/weapons.ts` | `ember_sprinkler` 등록 |
| `packages/shared/maps/training-arena.json` | armory 스폰 추가 |
| `server/src/game_data.rs` | cone 파라미터 필드 추가 |
| `server/src/room_combat.rs` | `find_melee_target` 파라미터화 |
| `apps/game/src/main.ts` | 픽업 스프라이트, 발사 이벤트 연결 |
| `apps/game/src/weapon-presentation.ts` | 파티클 스트림 VFX |

---

## 검증 방법

- 공격 버튼 누르고 있으면 연속 분사 (100ms 주기)
- 가까이 있는 적에게 Burn DoT가 걸리는지 확인 (적 위에 불꽃 아이콘)
- 파티클이 포물선으로 떨어지는지 확인 (수평 발사 시 중력에 의해 아래로 처짐)
- 파티클이 갈수록 퍼지는지 확인 (먼 곳에서 더 넓게 분포)
- 3색(노랑→주황→빨강) 레이어 혼합이 보이는지 확인
- 화염 범위 밖 적에게는 피해/번 없는지 확인
- `cargo test` 전체 통과
- `pnpm typecheck` 전체 통과

---

## 참고

- 기존 Burn DoT 구현: `docs/archive/mini-specs/mini-spec-status-effects-trim-v1.md`
- melee cone 기하학: `server/src/room_combat.rs` `find_melee_target`
- fire-and-forget 연속 발사: `server/src/room_runtime.rs` (`attack_was_down` auto-requeue)
- 기존 파티클 예시: `apps/game/src/main.ts` `spawnHitParticles`
