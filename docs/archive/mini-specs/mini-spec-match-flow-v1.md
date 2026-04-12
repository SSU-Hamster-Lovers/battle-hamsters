# 미니 스펙 — 매치 흐름 1차

## 작업명

매치 흐름 1차 — Waiting → Running → Finished + 점수 + 결과

## 목표

매치룸에서 실제 게임 사이클이 돌아가게 한다.
대기 → 시작 → 종료 → 결과 확인 → 다음 매치(또는 로비 복귀).
자유맵은 기존과 동일하게 항상 Running 유지.

## 이번 범위

### 서버
- `RoomState` 에 `match_state: MatchState` 필드 추가 (현재는 tick 에서 하드코딩)
- 매치룸 상태 전환:
  - **Waiting**: 플레이어 2명 이상 입장 → 5초 카운트다운 → Running
  - **Running**: `time_remaining_ms` 소진 → Finished
  - **Finished**: 결과를 5초간 유지 → 자동으로 다시 Waiting (새 매치)
- 자유맵: 생성 시 `match_state = Running`, 전환 없음
- 점수 추적: `PlayerRuntime` 에 `kills: u32`, `deaths: u32` 추가
  - kill_feed push 시점에 killer 의 kills += 1, victim 의 deaths += 1
  - 리스폰/매치 리셋 시 점수는 초기화하지 않음 (매치 끝까지 누적)
  - 새 매치 시작 시 0 으로 리셋
- `WorldSnapshotPayload` 에 `matchState` 실제 값 반영 (현재 하드코딩 제거)
- `world_snapshot` 에 플레이어별 kills/deaths 포함 (PlayerSnapshot 확장 또는 별도 필드)

### shared 타입
- `PlayerSnapshot` 에 `kills: number`, `deaths: number` 추가

### 클라이언트
- 매치 상태별 UI:
  - **Waiting**: "대기 중... (N/2명)" 또는 카운트다운 표시
  - **Running**: 기존 게임 플레이 + 남은 시간 표시 (이미 infoText 에 있음)
  - **Finished**: 결과 오버레이 (순위, 킬/데스, 다음 매치 카운트다운)
- 자유맵: 상태 표시 없이 기존과 동일

## 건드리는 스펙/문서

- `docs/technical/sync-protocol.md` (matchState 전환 규칙)
- `docs/technical/current-implementation.md`

## 비목표

- 호스트 권한 / 수동 시작 버튼
- 팀전 / 복잡한 승리 조건
- ELO / 랭킹 시스템
- DB 기록 (인메모리만)

## 핵심 결정

### A. 매치 시작 조건: 2명 이상 + 5초 카운트다운
- Waiting 상태에서 플레이어가 2명 이상이면 5초 카운트다운 시작
- 카운트다운 중 인원이 다시 1명 이하가 되면 카운트다운 취소
- `WorldSnapshotPayload` 에 `countdownMs: number | null` 추가해 클라에서 표시

### B. 매치 종료: 시간 소진
- `time_remaining_ms == 0` 도달 시 `match_state = Finished`
- Finished 상태에서는 5초간 결과 표시 후 자동 새 매치

### C. 점수 규칙
- 킬: 상대를 죽이면 +1 (HP 0 도달이든, 넉백 낙사 어사인이든)
- 데스: 죽으면 +1
- 자살(last_hit_by 없이 낙사): 킬 귀속 없음, 본인 데스만 +1
- 승자: 매치 종료 시 킬 수 최다 (동점 시 데스 수 적은 쪽)

### D. 매치 리셋
- Finished → Waiting 전환 시:
  - 모든 플레이어 kills/deaths 0 으로 리셋
  - 모든 플레이어 리스폰
  - 무기/아이템 초기 스폰 재실행
  - time_remaining_ms 초기값 복원

### E. 자유맵은 항상 Running
- match_state = Running, time_remaining_ms = u64::MAX
- 점수는 트래킹 하되 리셋되지 않음 (기간 누적)
- 결과 화면 / 매치 전환 없음

## 완료 조건

- 매치룸에서 2명 이상 입장 시 카운트다운 → 게임 시작
- 5분 후 결과 화면에 순위/킬/데스 표시
- 5초 후 새 매치 자동 시작
- 자유맵은 기존과 동일하게 동작

## 검증 방법

- 브라우저 2개로 매치룸 접속 → 카운트다운 → 플레이 → 시간 종료 → 결과 화면 → 자동 재시작
- 자유맵은 영향 없음 확인
- `cargo test` 신규 테스트 통과
