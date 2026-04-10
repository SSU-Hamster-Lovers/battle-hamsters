# 미니 스펙 — 카메라 visual bounds 1차

## 작업명

카메라 visual bounds 1차

## 목표

이미 문서에 정의한 `visualBounds` 규칙을 실제 런타임에 반영해,
카메라가 논리적 울타리 영역을 보여주지 않도록 만든다.
이 작업은 수치보다 **실제 플레이 화면에서의 어색함을 찾고 조정하는 것**이 중요하다.

## 이번 범위

- `visualBounds`를 카메라 clamp 기준으로 실제 사용
- pit 아래 낙사 유도 영역 / 논리 fence 영역 미노출 보장
- follow 카메라 1차 구현
- follow 이동은 damping 계열 기본 적용

## 건드리는 스펙/문서

- `docs/game-design/map-design.md`
- `docs/technical/data-formats.md`
- `docs/technical/mini-spec-map-boundaries-camera.md`
- `docs/technical/current-implementation.md`

## 비목표

- dynamic zoom
- 모든 플레이어를 화면에 넣는 멀티타겟 카메라
- scripted / cinematic camera
- Bezier 기반 특수 연출 카메라

## 핵심 결정

### 1. 카메라 clamp는 `visualBounds` 기준이다

- `gameplayBounds`나 `deathBounds`는 시스템 판정용
- 카메라는 시각적 울타리를 넘지 않는다.

### 2. follow 이동은 damping 계열로 시작한다

- 선형 고정 속도 이동보다
- `smooth damp / spring / critical damping`
  성격의 지연 추적을 우선한다.

### 3. static → follow 전환은 작은 범위로 시작한다

- 테스트 맵 1개 기준
- local player 중심 follow 1차

### 4. 카메라 작업은 플레이 테스트 기반 튜닝을 전제로 한다

- 단순 구현 통과보다 실제 게임 화면에서의 체감이 더 중요하다.
- follow 지연, clamp 감각, 점프/낙사 직전 프레이밍은 수동 플레이 테스트로 조정한다.

## 완료 조건

- 카메라가 pit 아래 논리 영역을 보여주지 않는다.
- follow 이동이 튀지 않고 자연스럽다.
- 맵 경계 근처에서도 clamp가 깨지지 않는다.

## 검증 방법

- 맵 양 끝/중앙 pit 근처 수동 테스트
- 점프/낙사 직전 카메라 동작 확인
- “이상하게 많이 보여주는 영역”이나 “따라오는 감각이 답답한 구간”을 실제 플레이 영상/체감 기준으로 찾는다.
