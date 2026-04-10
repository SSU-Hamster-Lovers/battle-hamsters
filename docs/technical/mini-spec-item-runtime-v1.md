# 미니 스펙 — 아이템 시스템 1차 (spawn / pickup / 효과 적용)

## 작업명

아이템 시스템 1차

## 목표

월드 `itemSpawns`를 실제 런타임 상태로 올리고, 플레이어가 아이템을 획득했을 때
즉시 이해 가능한 효과가 서버 authoritative 상태로 반영되게 만든다.

## 이번 범위

- 테스트 맵 `itemSpawns`를 실제 월드 pickup 상태로 반영
- 아이템 spawn / despawn / respawn 1차
- 자동 pickup 기반 아이템 획득
- 최소 2종 이상의 아이템 효과 실제 적용
  - `jump_boost`
  - `health_recover`
- world snapshot에 item pickup 상태 반영
- 클라이언트 HUD/월드 표시 최소 반영

## 건드리는 스펙/문서

- `docs/game-design/item-design.md`
- `docs/technical/data-formats.md`
- `docs/technical/sync-protocol.md`
- `docs/technical/current-implementation.md`
- 필요 시 `docs/ROADMAP.md`

## 비목표

- 복잡한 버프 스택 시스템
- duration 기반 상태이상
- speed rank 세부 밸런싱 완료
- item 전용 연출/사운드 완성

## 핵심 결정

### 1. 아이템은 무기와 다르게 자동 pickup으로 간다

- 속도 랭크업, 점프 횟수 증가, HP 회복 같은 아이템은
  지나가면서 즉시 먹는 편이 전투 리듬에 더 맞는다.
- 따라서 무기와 아이템은 pickup 정책을 분리한다.
  - 무기: `E`
  - 아이템: 자동 pickup

### 2. 첫 단계는 즉시 효과형 아이템만 다룬다

- `jump_boost`
- `health_recover`
- 필요 시 `extra_life`
- duration/status 아이템은 후속 단계로 미룬다.

### 3. 효과 적용은 모두 서버가 최종 확정한다

- pickup 판정
- 수치 변화
- clamp
- despawn/respawn
  을 모두 서버 authoritative로 둔다.

## 완료 조건

- 월드 아이템이 실제로 스폰된다.
- 닿으면 자동으로 획득된다.
- `jump_boost`가 실제 `maxJumpCount`에 반영된다.
- `health_recover`가 HP를 회복한다.
- item despawn/respawn이 동작한다.

## 검증 방법

- 서버 테스트로 pickup/효과 적용/clamp 확인
- 브라우저 수동 테스트로 월드 아이템 획득 확인
- HUD 또는 디버그 텍스트로 효과 반영 확인
