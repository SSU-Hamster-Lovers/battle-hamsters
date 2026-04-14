# 미니 스펙: 솔방울 저격총 (pine_sniper) v1

## 작업명
feat/pine-sniper-v1

## 목표
희귀 저격 무기 `pine_sniper`(솔방울 저격총)를 서버-클라이언트 전체에 구현한다.
솔방울 개머리판 + 긴 금속 총신 + 스코프 범프의 독특한 비주얼과 함께,
좁은 에임 프로파일(±8°)·높은 단발 피해·긴 사거리로 저격 역할을 담당한다.

## 이번 범위

- `packages/shared/weapons/pine-sniper.json` — 무기 정의 신규 생성
- `packages/shared/weapon-data.ts` — pine_sniper 등록
- `server/src/game_data.rs` — include_str! + HashMap 항목 추가
- `server/src/main.rs` — TDD 테스트 2개 (RED 먼저)
- `apps/game/src/weapon-presentation.ts` — HUD 아이콘 / equip 오버레이 / pickup 텍스처 / `sniper_flash` 파이어 스타일
- `apps/game/src/main.ts` — `sniper_flash` 이펙트 (긴 흰색 트레이서 + 섬광 + 스코프 글린트)
- `docs/technical/current-implementation.md` — 상태 반영

## 무기 스탯

| 항목 | 값 |
|------|----|
| id | `pine_sniper` |
| name | 솔방울 저격총 |
| hitType | `hitscan` |
| fireMode | `single` |
| damage | 55 |
| knockback | 20 |
| selfRecoilForce | 15 |
| attackIntervalMs | 1400 |
| range | 1100 |
| maxResource | 3 |
| discardOnEmpty | true |
| rarity | `rare` |
| aimProfile | -8° ~ +8° |
| specialEffect | none |

## 건드리는 스펙

- `docs/game-design/weapons.md` (무기 목록)
- `docs/technical/data-formats.md` (WeaponDefinition 타입)

## 비목표

- `training-arena.json` 맵 스폰 포인트 — map-rework-v2 브랜치에서 처리
- 실제 아트 에셋 교체 (코드 생성 스프라이트로 1차 구현)
- 특수 효과(specialEffect) 없음

## 검증 방법

```bash
cd server && cargo test pine_sniper   # RED → GREEN
cargo test                             # 회귀 없음
cd apps/game && pnpm typecheck
cd packages/shared && pnpm typecheck
cd server && cargo check
```
