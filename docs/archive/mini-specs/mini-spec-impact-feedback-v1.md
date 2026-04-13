# 미니 스펙: 피격 피드백 v1

작업명:
피격 파티클 1차/2차 + 사망 더미 튜닝

목표:
피격 방향이 읽히는 파티클 연출을 추가하고, 서버 정확 이벤트가 없는 구간도 fallback 으로 커버한다. 사망 더미는 현재보다 덜 높게, 조금 느리게 보이도록 다듬는다.

이번 범위:
- HP 감소 감지 기반 피격 파티클 1차 추가
- `damage_applied` 서버 이벤트 2차 계약 추가
- 마지막 피격 방향을 사용한 사망 더미 launch 튜닝

건드리는 스펙/문서:
- `docs/technical/sync-protocol.md`
- `docs/technical/data-formats.md`
- `docs/technical/current-implementation.md`

비목표:
- 정확한 부위별 히트박스
- 래그돌 본체 물리
- 무기별 전용 피격 파티클 세트

검증 방법:
- `cargo test`
- `pnpm --dir apps/game typecheck`
- `pnpm --dir apps/game build`

## 1. 1차 규칙

- 클라이언트는 `hp` 감소를 감지하면 피격 파티클을 생성할 수 있다.
- 방향은 우선 현재/직전 속도 차이와 넉백 방향으로 추정한다.
- 정확 이벤트가 없을 때만 fallback 으로 사용한다.

## 2. 2차 규칙

- 서버는 `damage_applied` 이벤트를 스냅샷에 포함한다.
- 이벤트는 `victimId`, `attackerId`, `weaponId`, `damage`, `impactDirection`, `impactPoint`, `occurredAt` 를 가진다.
- 클라이언트는 이 이벤트가 있으면 이를 우선 사용해 피격 파티클과 사망 launch 방향을 정한다.

## 3. 사망 더미 튜닝

- `weapon/self` 사망 시 더미는 마지막 피격 방향을 따라 짧은 포물선을 그린다.
- 현재보다:
  - 수평/수직 초기 속도를 낮춘다.
  - 중력을 약하게 해 전체 템포를 조금 늦춘다.
  - 페이드 구간을 약간 늘린다.
