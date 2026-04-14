# 미니 스펙 — 무기 polish v1

## 작업명

weapon-polish-v1

## 목표

feat/beam-grab-v1에서 발견된 버그/개선 사항을 일괄 처리한다.
VFX 정렬, 조준 보조, 밸런스, CC 버그 수정.

## 브랜치

`feat/weapon-polish-v1` (base: `feat/beam-grab-v1`)

## 완료 범위

### 레이저 커터
- 빔 총구 위치 xPull/anchorYOffset 누락 수정 (시각-판정 불일치 해소)
- range 500→800
- specialEffect: `{ kind: "burn", durationMs: 1000, tickDamage: 2, tickIntervalMs: 500 }` 추가
- `piercesOneWayPlatforms: false` → 원웨이 플랫폼에 빔 차단 (서버 판정)

### 블루베리 박격포 리밸런싱
- damage 30→90, splashDamage 15→45, splashRadius 80→140
- range 900→2200, projectileSpeed 420→600, gravity 1800→900
- aimProfile: -85°~+5° (근 수평 발사 허용)
- 포물선 조준선 미리보기: 서버 동일 사다리꼴 적분(avg_vel * dt), 사거리 소진 지점 표시

### 다람쥐 기관총 VFX
- `sendLatestInput` 50ms 틱마다 연속 총구 섬광 (`auto_flash` 지속 렌더)
- 3레이어 글로우: 황금 외부(r×2.5) → 밝은 중간(r×1.4) → 흰색 코어(r×0.65), r=4~7 랜덤
- 50px tracer 라인

### 잡기 창 grab CC 완성
- grab 상태에서 `step_player`가 수평 이동·점프 입력 무시 (기존 CC 미적용 버그 수정)
- maxResource 3→2, damage 10→15

### 신규 서버 인프라
- `pierces_one_way_platforms: bool` 필드 (`RuntimeWeaponDefinition`, serde default=false)
- `find_hitscan_target`에 플랫폼 교차 occlusion 체크 추가

## 비목표

- 레이저 커터 빔 VFX가 원웨이 플랫폼을 시각적으로 통과하는 문제 (후속 미룸)

## 검증

- 단위 테스트 63개 통과
  - `grab_effect_freezes_player_movement` — grab CC 이동 차단
  - `laser_cutter_applies_burn_on_hit` — burn specialEffect
  - `laser_cutter_blocked_by_one_way_platform` — 플랫폼 차단
- `pnpm typecheck` (game, shared) 통과
- `cargo test` 63/63 통과

## 수정 파일

| 파일 | 내용 |
|------|------|
| `server/src/room_combat.rs` | find_hitscan_target: pierces_one_way_platforms 파라미터 + occlusion 로직 |
| `server/src/room_runtime.rs` | step_player: active_grab 검사 → move_x=0, jump 차단 |
| `server/src/game_data.rs` | RuntimeWeaponDefinition.pierces_one_way_platforms 필드 추가 |
| `server/src/main.rs` | 테스트 3개 추가 |
| `packages/shared/weapons/laser-cutter.json` | range 800, burn effect, piercesOneWayPlatforms: false |
| `packages/shared/weapons/blueberry-mortar.json` | 리밸런싱 전체 |
| `packages/shared/weapons/grab-spear.json` | maxResource 2, damage 15 |
| `packages/shared/weapons.ts` | piercesOneWayPlatforms?: boolean 추가 |
| `apps/game/src/main.ts` | mortar arc, gatling VFX, laser muzzle fix |
