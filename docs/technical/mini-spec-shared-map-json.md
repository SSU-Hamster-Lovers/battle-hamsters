# 미니 스펙 — 공통 맵 JSON 런타임 이관

## 작업명
공통 맵 JSON 런타임 이관

## 목표
서버와 게임 클라이언트가 현재 각각 하드코딩하고 있는 테스트 맵 구조를
하나의 공통 JSON 정의로 통합해, **충돌 판정 / 렌더링 / 스폰 위치가 같은 데이터 원본**을 보도록 만든다.

## 이번 범위
- 첫 번째 테스트 맵 JSON 파일 위치와 소유 패키지를 확정한다.
- `packages/shared`의 `MapDefinition` 타입과 실제 JSON 구조를 맞춘다.
- 서버가 하드코딩 상수 대신 공통 맵 정의에서 바닥 / 플랫폼 / wall / hazard / spawn 데이터를 읽도록 전환한다.
- 게임 클라이언트가 같은 공통 맵 정의에서 디버그 오버레이와 스폰 위치를 읽도록 전환한다.
- 현재 테스트 맵 1종만 대상으로 한다.

## 건드리는 스펙/문서
- `docs/game-design/map-design.md`
- `docs/technical/data-formats.md`
- `docs/technical/current-implementation.md`
- 필요 시 `docs/ROADMAP.md`

## 비목표
- 맵 에디터 도입
- 복수 맵 선택 UI
- `boundaryPolicy / cameraPolicy / gameplayBounds / deathBounds` 런타임 구현
- item / weapon pickup 실제 상태 구현
- 맵 아트/타일 시스템 도입

## 핵심 결정

### 1. 다음 구현 1순위는 공통 맵 JSON이다
- 이미 충돌 primitive 계약은 정리했고 1차 플랫폼 이동도 구현됐다.
- 지금 남은 가장 큰 불일치는 **서버와 클라이언트가 맵을 각자 하드코딩**하고 있다는 점이다.
- 따라서 다음 구현은 새로운 게임 규칙 추가보다 먼저 **데이터 원본 통합**을 우선한다.

### 2. 첫 단계는 “테스트 맵 1개를 공통 정의로 옮기는 것”이다
- 처음부터 맵 로더/에디터/여러 맵 관리까지 넓히지 않는다.
- 현재 플랫폼 이동 검증에 쓰는 테스트 맵을 기준 샘플로 삼는다.

### 3. boundary/camera 필드는 아직 문서 스펙으로만 유지한다
- `boundaryPolicy`, `cameraPolicy`, `gameplayBounds`, `deathBounds`는 계속 문서에 남긴다.
- 다만 이번 작업에서는 JSON 파일과 shared 타입이 **현재 런타임에서 실제 쓰는 필드**에 먼저 맞춰진다.
- boundary/camera 런타임 사용은 후속 작업으로 둔다.

## 완료 조건
- 서버와 클라이언트에서 테스트 맵 충돌 / hazard / spawn 위치가 같은 JSON 원본에서 읽힌다.
- `server/src/main.rs`와 `apps/game/src/main.ts`에 중복된 테스트 맵 하드코딩이 제거되거나 최소화된다.
- current-implementation 문서가 “공통 맵 JSON 기반” 상태를 반영한다.

## 검증 방법
- 서버 테스트(`cargo test`)가 계속 통과한다.
- 게임 클라이언트 타입체크/빌드가 통과한다.
- 디버그 오버레이 기준으로 바닥 / 플랫폼 / wall / hazard / spawn 위치가 기존 테스트 맵과 어긋나지 않는지 확인한다.
- 두 런타임이 같은 맵 데이터 파일을 참조하는지 코드 기준으로 확인한다.
