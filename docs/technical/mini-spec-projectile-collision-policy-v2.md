# 미니 스펙: 투사체 충돌 정책 v2

## 작업명

`feat/projectile-collision-policy-v2`

## 목표

현재 투사체의 지형 충돌 규칙을 플레이어가 예측 가능한 형태로 정리한다. 특히 `one_way_platform`이 모든 방향에서 투사체를 막는 임시 동작을 없애고, 플랫폼 게임 문법에 맞는 방향성 규칙을 적용한다.

## 이번 범위

- `floor`: 항상 차단
- `solid_wall`: 항상 차단
- `one_way_platform`: 위에서 아래로 top surface를 가로지를 때만 차단
- 아래에서 위로 지나가는 투사체는 통과
- 현재 projectile 무기(`Seed Shotgun`, `Hand Cannon`)는 위 정책을 공통 사용

## 넉백 안정화

- `external_velocity`는 외부 충격/넉백 전용으로 유지한다.
- 점프/중력에서 쓰는 세로 기본 속도는 별도 runtime 필드로 관리한다.
- 수직 넉백이 `snapshot.velocity.y`에 재누적되어 skyrocket처럼 증폭되는 버그를 막는다.

## 비목표

- 무기별 개별 충돌 정책 데이터화
- 포물선/중력 탄도
- 관통/튕김
- 폭발탄 착탄 규칙

## 검증

- 아래에서 위로 쏜 투사체가 `one_way_platform`을 통과한다.
- 위에서 아래로 떨어지는 투사체는 `one_way_platform`에 막힌다.
- 영거리/하단 사격 시 수직 넉백이 틱마다 비정상 누적되지 않는다.
- `cargo test` 통과
