# 미니 스펙 — 룸별 게임플레이 설정 1차

## 작업명

룸별 게임플레이 설정 1차

## 목표

실제 플레이 단위인 룸/매치가 공통 전역값 하나에 묶이지 않고,
점프 수/생명/HP 같은 핵심 규칙을 룸 설정으로 가질 수 있게 만든다.

## 이번 범위

- 룸 단위 gameplay config 구조 정의
- 기본 점프 수 / 최대 점프 수 / 시작 HP / 시작 생명 설정 후보 정의
- 현재 in-memory room loop에 설정 주입 가능한 구조 초안
- 글로벌 기본값(config/DB/admin) 연동은 후속 단계로 분리

## 건드리는 스펙/문서

- `docs/game-design/core-rules.md`
- `docs/technical/data-formats.md`
- `docs/technical/current-implementation.md`
- 필요 시 `docs/technical/architecture.md`

## 비목표

- 관리자 웹 UI
- DB 기반 실시간 운영 설정 저장
- 랭크/매칭 규칙 전체 외부화
- 완전한 live config hot reload

## 핵심 결정

### 1. 방 설정과 글로벌 기본값은 분리한다

- 1차는 **룸이 자기 gameplay config를 가진다**가 핵심이다.
- 글로벌 기본값을 중앙 서버에서 바꾸는 기능은 2차로 분리한다.

### 2. gameplay config는 전투 판정에 직접 연결한다

- 기본 점프 수
- 최대 점프 수
- 시작 HP
- 시작 생명
  같은 값은 서버 authoritative 판정에 바로 반영돼야 한다.

### 3. 운영 기본값 소스는 후속 단계에서 추가한다

- config file
- DB
- admin API
  같은 소스는 나중에 붙인다.
- 1차는 **구조를 열어 두는 것**이 우선이다.

## 완료 조건

- 룸이 자체 gameplay config를 가진다는 구조가 문서와 코드에서 정리된다.
- 점프/HP/생명 관련 값이 더 이상 하드코딩 상수 하나에만 의존하지 않게 갈 수 있는 기준이 생긴다.
- 글로벌 기본값/운영자 설정은 후속 스펙으로 분리된다.

## 검증 방법

- 문서 기준 정합성 검토
- 이후 구현 시 서버 테스트로 룸별 설정 반영 확인
