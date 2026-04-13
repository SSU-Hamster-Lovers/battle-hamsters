# 미니 스펙: 씨앗 샷건 + 호두 대포 스프라이트 v1

## 작업명

`feat/weapon-sprites-v2`

## 목표

현재 fallback(코드 라벨)으로만 표시되는 `seed_shotgun`과 `hand_cannon`에 전용 비주얼을 추가한다.  
`hand_cannon`은 이 작업에서 `walnut_cannon` (호두 대포)으로 ID와 이름을 변경한다.

---

## 무기별 변경

### 씨앗 샷건 (`seed_shotgun`)

**ID/이름**: 유지  
**테마**: 펌프식 샷건 + 씨앗 알갱이 느낌. 갈색 목재 총신 + 녹색 씨앗 도트.

| 항목 | 내용 |
|------|------|
| Pickup (56×40) | 펌프식 샷건 총신(갈색) + 하단 펌프 막대 + 씨앗 도트 3개 |
| Equip (44×14) | 가로형 긴 총신 + 펌프 부분 돌출 표시, 총구 끝 16px |
| HUD (24×24) | 샷건 실루엣 — 짧고 넓은 총구 + 펌프 그립 |
| Fire style | `shotgun_spread` — 발사 시 5줄기 짧은 tracer 부채꼴(±22°) 표현 |
| Projectile | 씨앗: 작고 갈색/녹색 타원 (`radius 3`, 색상 `0x88cc44`) + 짧은 trail |
| Impact style | `seed_burst` — 작은 씨앗 파편 3~5개 튀는 연출 |

### 호두 대포 (`walnut_cannon`, 전 `hand_cannon`)

**ID 변경**: `hand_cannon` → `walnut_cannon`  
**이름 변경**: "Hand Cannon" → "호두 대포"  
**테마**: 짧고 두꺼운 대포 + 울퉁불퉁한 호두 투사체. 갈색/베이지 색조.

| 항목 | 내용 |
|------|------|
| Pickup (56×40) | 짧고 두꺼운 포신(베이지/갈색) + 바퀴형 포가 받침 + 호두 아이콘 |
| Equip (36×20) | 짧고 굵은 원통형 포신, 총구 끝 15px |
| HUD (24×24) | 대포 실루엣 — 굵은 포신 + 양쪽 바퀴 |
| Fire style | `cannon_blast` — 크고 둥근 총구 화염(반지름 12~16) + 연기 원 2~3개 |
| Projectile | 호두: 울퉁불퉁한 8각 폴리곤 (`radius ~5`, 색상 `0xc8a05a`) + 두꺼운 trail |
| Impact style | `cannon_impact` — 크고 강한 파편 파티클 + 먼지 구름 |

---

## 이번 범위

### 서버 (Rust)

1. **`walnut-cannon.json` 신규** — `hand-cannon.json` 내용 + `id` / `name` 변경
2. **`hand-cannon.json` 삭제**
3. **`server/src/game_data.rs`** — `include_str!` + `HashMap` 키 `hand_cannon` → `walnut_cannon`
4. **`packages/shared/maps/training-arena.json`** — `weaponId: "hand_cannon"` → `"walnut_cannon"` (2곳)
5. **`server/src/main.rs`** — 테스트 내 `hand_cannon` → `walnut_cannon` 일괄 업데이트

### 클라이언트 (TypeScript)

6. **`apps/game/src/weapon-presentation.ts`**
   - `SEED_SHOTGUN_*` / `WALNUT_CANNON_*` 텍스처 상수 추가
   - `ensureWeaponPickupTextures`: 두 무기 pickup + equip 텍스처 등록
   - `resolveWeaponPickupPresentation`: seed_shotgun, walnut_cannon 케이스
   - `resolveWeaponEquipPresentation`: seed_shotgun, walnut_cannon 케이스
   - `resolveWeaponFireStyle`: `shotgun_spread`, `cannon_blast` 추가
   - `ensureWeaponHudTextures`: seed_shotgun, walnut_cannon HUD 아이콘
   - `WeaponFireStyle` 유니온에 `shotgun_spread` / `cannon_blast` 추가

7. **`apps/game/src/main.ts`**
   - `resolveProjectilePresentation`: `seed_shotgun` 색상 갱신, `hand_cannon` → `walnut_cannon` + 호두 폴리곤 렌더 로직
   - `showAttackFlash`: `shotgun_spread` 케이스 — tracer 5줄기 부채꼴
   - `showAttackFlash`: `cannon_blast` 케이스 — 큰 원형 총구 화염
   - 호두 투사체 렌더: `Phaser.GameObjects.Graphics`로 울퉁불퉁 폴리곤 직접 그리기

---

## 비목표

- 서버 스탯 변경 (damage / knockback / range 등)
- 맵 스폰 위치/개수 변경
- 사운드 / 화면 흔들림
- `paws` 스프라이트 (별도 작업)
- 실제 아트 atlas 교체 (현재 코드 생성 texture 유지)

---

## 건드리는 파일

| 파일 | 변경 |
|------|------|
| `packages/shared/weapons/walnut-cannon.json` | 신규 |
| `packages/shared/weapons/hand-cannon.json` | 삭제 |
| `server/src/game_data.rs` | walnut_cannon으로 업데이트 |
| `packages/shared/maps/training-arena.json` | weaponId 2곳 변경 |
| `server/src/main.rs` | 테스트 업데이트 |
| `apps/game/src/weapon-presentation.ts` | 스프라이트 + fire style 추가 |
| `apps/game/src/main.ts` | 투사체/flash 비주얼 업데이트 |

---

## TDD 적용

- **서버 ID 변경** — 기존 `hand_cannon` 테스트를 `walnut_cannon`으로 먼저 수정 → RED 확인 → 코드 변경 → GREEN
- **클라이언트 비주얼 코드** — `generateTexture` / `drawXxx` 함수는 순수 생성 코드 → TDD 예외 (throwaway prototype / generated code)
- `resolveWeaponFireStyle` 변경은 typecheck로 검증

---

## 검증 방법

- `cargo test` 전체 통과
- `pnpm typecheck` (shared + game)
- 브라우저 스모크 테스트:
  - 씨앗 샷건 픽업 스프라이트 / 장착 오버레이 / HUD 아이콘 표시
  - 씨앗 샷건 발사 시 부채꼴 tracer 5줄기
  - 호두 대포 픽업 / 장착 / HUD 표시
  - 호두 투사체 울퉁불퉁하게 날아가고 착탄 시 큰 파편 표시
  - 맵에서 walnut_cannon 스폰 정상 작동

---

## 참고

- 기존 스프라이트 패턴: `docs/archive/mini-specs/mini-spec-weapon-presentation-v1.md`
- 불씨 뿌리개 스프라이트 참고 구현: `docs/archive/mini-specs/mini-spec-flamethrower-v1.md`
- 무기 JSON 스키마: `docs/technical/data-formats.md`
