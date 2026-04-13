# 미니 스펙: 무기 확장 v2 — Seed Shotgun + Hand Cannon

## 작업명

`feat/weapon-expansion-v2`

## 목표

Acorn Blaster 이후 두 번째·세 번째 무기를 추가한다. 서버 `hitscan` 판정이 단일 레이에서 **pellet burst**로 확장되어 다중 탄환을 지원한다.

## 이번 범위 (구현 완료)

### Seed Shotgun

- `packages/shared/weapons/seed-shotgun.json`
- `hitType: "hitscan"`, `pelletCount: 5`, `spreadDeg: 22`
- `damage: 7` (pellet당), `knockback: 4`, `attackIntervalMs: 700`
- `maxResource: 4`, `resourcePerShot: 1`, `discardOnEmpty: true`
- `rarity: "uncommon"`
- 훈련 맵 `weapon_group` 랜덤 후보 2개

### Hand Cannon

- `packages/shared/weapons/hand-cannon.json`
- `hitType: "hitscan"`, `pelletCount: 1`, `spreadDeg: 3`
- `damage: 28`, `knockback: 18`, `selfRecoilForce: 3.5`, `attackIntervalMs: 900`
- `maxResource: 4`, `resourcePerShot: 1`, `discardOnEmpty: true`
- `rarity: "rare"`
- 훈련 맵 x=800 고정 스폰 (respawnMs: 25000)

### 서버 pellet burst

- `server/src/room_combat.rs` — `FireMode::Single` 가드 제거
- `pelletCount > 1`일 때 `spreadDeg` 범위 내 균등 각도 분산으로 복수 레이 판정
- pellet별 독립 판정, 같은 타겟 복수 적중 가능
- 쿨다운·탄 소모·반동은 발사 1회만 처리

### 클라이언트 표현

- `seed_shotgun`, `hand_cannon`은 기존 fallback 도형/라벨로 처리
- HUD 아이콘: `drawFallbackHudIcon` 자동 적용

## 건드린 파일

| 파일 | 변경 |
|------|------|
| `packages/shared/weapons/seed-shotgun.json` | 신규 |
| `packages/shared/weapons/hand-cannon.json` | 신규 |
| `packages/shared/maps/training-arena.json` | weaponSpawns 추가 |
| `server/src/game_data.rs` | 두 무기 JSON 로드 |
| `server/src/main.rs` | 테스트 fixture 갱신 |
| `server/src/room_combat.rs` | pellet burst 처리 |

## 비목표

- Seed Shotgun / Hand Cannon 전용 스프라이트 (fallback 유지)
- 투사체 물리 변환 (현재 hitscan, 향후 `mini-spec-projectile-weapons-v1.md` 참조)
- spread 내 랜덤 분산 (현재 균등 분산으로 결정론적 처리)

## 검증

- `cargo test` 전체 통과 (테스트 fixture 2개 pickup 반영)
- 훈련 맵 Seed Shotgun weapon_group 1개 + Hand Cannon fixed 1개 스폰 확인
