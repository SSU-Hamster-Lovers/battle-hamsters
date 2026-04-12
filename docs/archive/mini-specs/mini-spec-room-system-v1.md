# 미니 스펙 — 방 시스템 1차 (Room System v1)

## 작업명

방 시스템 1차 — 다중 룸, 4자리 코드, 자유맵

## 목표

친구들과 인터넷으로 실제 게임을 테스트할 수 있도록
방 만들기 / 코드로 입장 / 자유맵 입장 흐름을 구현한다.

## 이번 범위

### 서버
- `RoomState` 를 단일 고정 인스턴스에서 `HashMap<RoomId, RoomState>` 로 전환
- HTTP API:
  - `POST /rooms` — 매치룸 생성 → `{ roomId, code }`
  - `GET /rooms` — 활성 룸 목록 (type, 인원수, matchState)
  - `GET /rooms/free` — 자유맵 roomId 조회
- 자유맵(`free_play`): 서버 시작 시 자동 생성, 상시 유지. 코드 없음.
- 매치룸 코드: 4자리 숫자, 방 생성 시 발급, 다음 조건 시 만료
  - 방 정상 종료 (매치 끝, 인원 0명)
  - 아무도 없이 10분 경과 (유령 방 자동 제거)
- 매치룸 코드 만료 후 동일 코드 재사용 가능 (신규 방에 재할당)

### 클라이언트 (Game Client)
- URL params 파싱: `?room=1234&name=hammy&pid=UUID`
  - `room` 있음 → 해당 룸에 바로 접속
  - 없음 → (현재는 기존 흐름, 나중에 인게임 로비로 대체)
- `playerId` 를 `sessionStorage` 에서 `localStorage` + UUID v4 방식으로 전환
  (재접속 시 동일 플레이어 유지)

### Portal (Next.js)
- 닉네임 입력 (localStorage 저장, UUID 자동 발급)
- [자유맵 입장] 버튼 → `GET /rooms/free` → Game URL 이동
- [방 만들기] 버튼 → `POST /rooms` → 코드 표시 + URL 복사 → Game URL 이동
- [코드로 입장] → 4자리 코드 입력 → Game URL 이동

## 건드리는 스펙/문서

- `docs/technical/architecture.md`
- `docs/technical/sync-protocol.md` (WS 흐름은 변경 없음)
- `docs/technical/current-implementation.md`

## 비목표

- 인게임 로비 화면 (Portal → Game URL 이동 방식으로 대체)
- 방 비밀번호 / 초대 전용 설정
- 매치룸 설정 커스텀 UI (고정값: 5분, 3생명)
- 계정 인증 / JWT (익명 UUID 방식 유지)
- 매치 흐름 (Waiting → Running → Finished) — 별도 미니 스펙

## 확정된 결정

### A. 방 코드 형식
```
4자리 숫자 (0000 ~ 9999)
URL: game.example.com?room=1234&name=hammy&pid=UUID
```
- 방 생성 시 사용 중이 아닌 코드를 랜덤 발급
- 충돌 시 자동으로 다른 코드 선택
- 자유맵은 코드 없음

### B. 룸 타입
```rust
enum RoomType {
    FreePlay,   // 상시 유지, 무제한 생명/시간
    Match,      // 유저 생성, 5분/3생명, 종료 후 제거
}
```
- 자유맵 GameplayConfig: lives=255, time_limit=∞ (u64::MAX)
- 매치룸 GameplayConfig: 기존 default() 유지

### C. 신원(Identity)
```
playerId: UUID v4 (localStorage, 최초 방문 시 자동 생성)
nickname: 문자열 (localStorage, 유저가 입력)
```
- 서버는 playerId 를 그대로 신뢰 (검증 없음, 초기)
- 나중에 JWT 미들웨어를 WS handshake 에 추가하는 것만으로 계정 연동 가능
- 게임 내 player_id 는 기존 `player_{seq}` 방식 유지 (WebSocket 세션 단위)

### D. Portal ↔ Game 핸드오프
```
Portal → 결정사항: roomId, playerName, playerId
       → Game URL: game.example.com?room=1234&name=hammy&pid=UUID-xxxx

Game 클라이언트:
  URL params 있음 → 바로 WebSocket 접속
  없음            → 나중에 인게임 로비 (현재는 기존 흐름)
```
- 이 분기를 처음부터 설계해두면 Portal 로비와 인게임 로비가 공존 가능

### E. 유령 방 제거
- 매치룸에서 인원이 0명이 되면 10분 타이머 시작
- 10분 후에도 0명이면 룸과 코드 제거
- 자유맵은 제거 안 함

## 완료 조건

- 친구와 코드(또는 URL)를 공유해 같은 방에 접속할 수 있다.
- 자유맵에서 무제한으로 뛰어놀 수 있다.
- 방 코드가 만료 후 새 방에 재사용된다.

## 검증 방법

- 브라우저 2개로 같은 코드 입력 → 같은 방에서 만남
- 자유맵 URL 공유 → 누구든 입장 가능
- 매치룸 10분 빈 방 → 자동 제거 확인
- `cargo test` + 신규 단위 테스트 통과

## 구현 순서

1. 서버 — `HashMap<RoomId, RoomState>` 전환 + 자유맵 자동 생성
2. 서버 — HTTP API (`POST /rooms`, `GET /rooms`, `GET /rooms/free`)
3. 서버 — 코드 발급 / 만료 / 유령 방 제거 로직
4. 클라이언트 — URL params 파싱 + localStorage UUID
5. Portal — 로비 UI (닉네임, 자유맵, 방 만들기, 코드 입장)

## 참고

- 매치 흐름(Waiting → Running → Finished), 결과 화면, 점수 집계는 별도 미니 스펙으로 분리
- 계정 인증은 이 작업에서 다루지 않음
