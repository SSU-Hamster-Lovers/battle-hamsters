# 미니 스펙: 투사체 중력 / 포물선 v1

작업명:
`feat/projectile-gravity-v1`

목표:
투사체가 직선 속도만 쓰는 상태에서 벗어나, 무기별로 중력 영향을 받아 포물선 궤적을 그릴 수 있게 만든다.

이번 범위:
- `WeaponDefinition.projectileGravityPerSec2` 추가
- 서버 `ProjectileRuntime`에 중력 가속도 반영
- 현재 projectile 무기 2종에 1차 튜닝 적용
  - `Seed Shotgun`: 더 큰 낙하
  - `Hand Cannon`: 더 작은 낙하
- 클라이언트 투사체 예측/회전을 중력 포함 방식으로 보정

건드리는 스펙/문서:
- `docs/technical/data-formats.md`
- `docs/technical/current-implementation.md`
- `docs/technical/next-session-roadmap.md`
- `packages/shared/weapons.ts`
- `packages/shared/weapons/seed-shotgun.json`
- `packages/shared/weapons/hand-cannon.json`
- `server/src/game_data.rs`
- `server/src/main.rs`
- `server/src/room_projectiles.rs`
- `apps/game/src/main.ts`

비목표:
- 폭발탄 / 관통탄 / 튕김
- 무기별 충돌 프로필 세분화
- 투사체 바람/항력
- Acorn Blaster 투사체화

검증 방법:
- `cargo test`
- `pnpm --filter @battle-hamsters/shared typecheck`
- `pnpm --filter @battle-hamsters/game typecheck`
- 자유맵에서 샷건/핸드캐논 수평 발사 시 하강 곡선이 육안으로 보이는지 확인

## 정책

- `projectileGravityPerSec2` 단위는 `px/s²`
- `0`이면 기존 직선탄과 동일
- 1차 적용값:
  - `Seed Shotgun`: `520 px/s²`
  - `Hand Cannon`: `260 px/s²`

## 의도

- `Seed Shotgun`은 퍼지는 씨앗탄 느낌을 살리기 위해 더 빠르게 떨어진다.
- `Hand Cannon`은 무거운 슬러그 느낌을 유지하되, 완전 직선탄보다 약간 포물선을 갖는다.

## 서버 적분 방식

- 틱 시작 속도와 틱 끝 속도의 평균값으로 이동 변위를 계산한다.
- 충돌 판정은 그 변위를 선분 sweep로 본다.
- 즉, 완전한 곡선 충돌은 아니지만 20 TPS 기준에서 예측 가능하고 구현 안정성이 높다.
