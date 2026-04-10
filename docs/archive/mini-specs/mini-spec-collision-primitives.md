# Archived — 미니 스펙 — 충돌 primitive 확장 및 테스트 맵 개선

## 작업명
충돌 primitive 확장 및 테스트 맵 개선

## 목표
현재 플랫폼 이동 테스트 맵을 더 실제 게임에 가까운 구조로 확장하고, 충돌을 `바닥 / 원웨이 플랫폼 / 좌우 벽 / 낙사 구멍 / 즉사 함정`으로 분리할 준비를 한다.

## 왜 필요한가
현재는 중앙 pit이 낙사 검증에는 유용하지만, 실제로는 다음 문제가 남아 있다.

- pit 좌우 벽 충돌이 없어 가장자리에서 부자연스럽게 튀어 보일 수 있음
- 낙사 구멍과 즉사 함정이 아직 개념적으로 분리되지 않음
- 이후 아이템/무기 스폰 위치를 배치하려면 테스트 맵 구조가 더 명확해야 함

## 이번 범위
- 테스트 맵에서 `낙사 구멍`과 `즉사 함정` 개념을 분리
- 좌우 벽 충돌 primitive 정의
- x축 / y축 충돌 해소를 더 명확히 분리할 준비
- 디버그 오버레이에 wall / pit / kill zone 구분 표시 방향 정리
- 향후 공통 맵 JSON 구조에 들어갈 최소 충돌 primitive 목록 정리

## 건드리는 스펙 / 문서
- `docs/game-design/core-rules.md`
- `docs/game-design/map-design.md`
- `docs/technical/collision-contract.md`
- `docs/technical/data-formats.md`
- `docs/technical/current-implementation.md`

## 비목표
- 맵 에디터 구현
- 아이템/무기 pickup 구현
- 전투 판정 구현
- 최종 아트 적용
- 완전한 타일 기반 충돌 시스템 전환

## 정의할 primitive

### 1. floor surface
- 위에서 착지 가능한 일반 바닥

### 2. one-way platform
- 위에서만 착지 가능
- 아래에서 통과 가능
- `아래 + 점프` 시 잠시 충돌 무시 가능

### 3. solid wall
- 좌우 이동을 막는 고체 벽
- pit 좌우 경계 처리에 필요

### 4. fall zone
- 바닥이 없는 허공 아래쪽 낙사 영역
- 떨어져 들어가면 사망/리스폰 처리

### 5. instant kill hazard
- 가시, 함정 등 닿으면 즉시 사망하는 영역
- 낙사와 구분되는 개념

## 테스트 맵 방향
- 좌측/우측 일반 바닥
- 중앙 허공 pit
- pit 위 또는 옆의 원웨이 플랫폼
- 한쪽에 즉사 함정 placeholder
- 상공 리스폰 포인트 복수

## 검증 방법
- pit 가장자리에서 벽 충돌 없이 튀어 오르는 현상이 줄어드는지 확인
- 허공 구멍으로 떨어져 낙사 처리되는지 확인
- 즉사 함정이 낙사와 별도 타입으로 표현되는지 확인
- 디버그 오버레이에서 floor / one-way / wall / fall zone / hazard 구분이 가능한지 확인
