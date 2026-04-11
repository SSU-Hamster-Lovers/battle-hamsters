# 미니 스펙 — 캐주얼 placeholder 햄스터 렌더링 1차

## 작업명

캐주얼 placeholder 햄스터 렌더링 1차

## 목표

현재 사각형 placeholder 플레이어를 캐주얼한 햄스터 sprite/container 렌더링으로 교체해,
판정은 그대로 유지하면서 플레이어 상태를 더 직관적으로 읽히게 만든다.

## 이번 범위

- 임시 캐주얼 햄스터 렌더링 1차
- sprite/atlas 기준 구조를 먼저 열되, 실제 아트가 없으므로 코드 기반 임시 텍스처 생성 사용
- idle / run / jump / fall / respawning 상태 시각 구분
- 좌우 방향 전환 지원
- 기존 collider/판정은 그대로 유지

## 건드리는 스펙/문서

- `docs/technical/current-implementation.md`
- 필요 시 `docs/game-design/core-rules.md`

## 비목표

- 최종 아트 완성
- skeletal animation
- 공격/피격 전용 애니메이션 완성
- 무기/아이템 아트 전체 리뉴얼

## 핵심 결정

### 1. 판정과 시각은 분리한다

- 서버 authoritative collider와 sprite 크기는 분리해서 본다.
- 지금 단계의 목적은 “예쁘게 보이기”보다 “상태를 잘 읽히게 만들기”다.

### 2. 실제 아트가 없어도 sprite 구조부터 맞춘다

- 초기에는 Phaser Graphics 기반 임시 텍스처를 생성한다.
- 이후 실제 atlas/spritesheet가 들어오면 같은 구조에서 교체 가능해야 한다.

### 3. 상태 차이가 먼저 보여야 한다

- idle
- run
- jump
- fall
- respawning
  상태가 최소한 구분돼야 한다.

## 완료 조건

- 플레이어가 더 이상 단순 사각형으로만 보이지 않는다.
- 캐주얼한 햄스터 silhouette가 보인다.
- 상태와 방향이 기본적으로 읽힌다.
- 기존 입력/판정/보간 구조는 깨지지 않는다.

## 검증 방법

- `pnpm --dir apps/game typecheck`
- `pnpm --dir apps/game build`
- 브라우저에서 이동/점프/리스폰 상태 구분 확인
