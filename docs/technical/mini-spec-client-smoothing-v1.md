# 미니 스펙 — 클라이언트 보간 및 시각 품질 1차

## 작업명

클라이언트 보간 및 시각 품질 1차

## 목표

현재 authoritative 상태는 유지하면서, 플레이어와 월드 오브젝트의 시각적 튐을 줄여
움직임과 전투 가독성을 개선한다.

## 이번 범위

- remote player 위치 보간 1차
- local player도 과도한 튐이 있으면 최소 보간/시각 보정 적용
- weapon/item pickup 시각 위치 보간 검토
- 발사/피격/리스폰 텍스트나 색상 피드백 최소 개선
- 지금 당장 전부 구현하지 못해도, 적용 가능한 보간/압축/동기화 기술 후보를 함께 정리한다.

## 건드리는 스펙/문서

- `docs/technical/current-implementation.md`
- 필요 시 `docs/technical/sync-protocol.md`

## 비목표

- full client prediction
- rollback / reconciliation
- 고급 애니메이션 시스템
- 카메라 구현

## 핵심 결정

### 1. authoritative 서버 구조는 유지한다

- 보간은 렌더링 보조층에서만 처리
- 최종 위치/상태 판정은 계속 서버 기준

### 2. remote player 보간을 우선한다

- 체감상 가장 거친 부분은 다른 플레이어 움직임일 가능성이 높다.
- 첫 단계는 remote entity 중심으로 개선한다.

### 3. 시각 반응은 작고 명확하게 시작한다

- 색상/alpha/짧은 effect 정도로 시작
- 전투 정보가 가려지지 않게 한다.

### 4. 활용 가능한 보간/동기화 기술은 최대한 열어 둔다

지금 당장 전부 구현할 필요는 없지만, 아래 기술들은 후보로 적극 검토한다.

- interpolation buffer
- snapshot interpolation
- entity별 dead reckoning
- local reconciliation 기초 구조
- input sequence 기반 보정
- state delta / delta compression
- 중요 이벤트와 상태 스냅샷의 분리 전송
- fixed tick snapshot + render tick interpolation
- remote entity 우선 보간, local entity 최소 예측
- lerp보다 더 자연스러운 damped interpolation / smooth damping

즉, 이번 미니 스펙은 “1차 구현”이 목적이지만,
후속 확장에 쓸 기술 조사 결과도 백로그로 같이 남기는 방향을 취한다.

## 완료 조건

- remote player 움직임이 현재보다 덜 거칠게 보인다.
- pickup/entity 위치 튐이 줄어든다.
- authoritative 동기화 구조는 깨지지 않는다.
- 후속 확장 후보 기술 목록이 문서나 backlog에 정리된다.

## 검증 방법

- 2클라이언트 수동 테스트
- 리스폰/발사/이동 중 시각 튐 비교
- 현재 구현한 보간과 향후 후보 기술을 구분해 기록한다.
