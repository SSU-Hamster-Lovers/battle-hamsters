# 미니 스펙 — hazard 피드백 1차

## 작업명

hazard 피드백 1차

## 목표

낙사와 즉사 함정 진입이 현재보다 더 잘 보이게 만들어,
왜 죽었는지와 언제 리스폰 중인지 쉽게 이해되도록 한다.

## 이번 범위

- 낙사 / 즉사 함정 진입 시 최소 시각 피드백
- 리스폰 대기 상태 표시 보강
- 사망 원인 텍스트 또는 색상 구분 1차
- 킬로그 1차 구조 정의
- 하단 플레이어 상태 HUD 1차 구조 정의

## 건드리는 스펙/문서

- `docs/game-design/core-rules.md`
- `docs/technical/current-implementation.md`
- 필요 시 `docs/technical/sync-protocol.md`

## 비목표

- 고급 이펙트
- 사운드 시스템
- 킬 로그/점수 UI 완성
- 다인전 모든 경우의 HUD 완성

## 핵심 결정

### 1. 원인 구분이 먼저다

- `fall_zone`
- `instant_kill_hazard`
  를 최소한 플레이어가 구분할 수 있어야 한다.

### 2. 과한 연출보다 정보 우선

- 색상/짧은 텍스트/alpha 변화처럼 단순한 표현부터 시작
- 전장 가독성을 해치지 않게 한다.

### 3. 킬로그는 좌상단 또는 우상단 스택형으로 둔다

- 킬/데스 발생 시 한 줄 추가
- 3초 뒤 자동 pop
- 예시 형식:
  - `Player 1 -> Acorn Blaster -> Player 2`
  - `Player 1 -> 낙사`
  - `Player 1 -> 자살`

### 4. 중앙 하단 플레이어 상태 HUD를 기본 후보로 둔다

- 표시 후보:
  - 플레이어 프로필
  - 속도 랭크
  - HP 바
  - 생명 개수
  - 습득 무기
- 단, 다인전/팀전 확장 시 레이아웃이 급격히 복잡해질 수 있으므로
  이번 단계에서는 **구조 정의**를 우선하고 완성도 높은 배치는 후속 작업으로 둔다.

### 5. 사망 파편 연출은 백로그로 남긴다

- 죽으면 작은 사각형 조각이 여러 개 흩어지는 식의 파편 연출은 매력적이다.
- 하지만 이는 현재 1차 정보 피드백보다 후순위이므로 **백로그**로 둔다.

## 확정된 결정 (v1)

### A. 킬로그 전송 방식 — 서버 보존 + 스냅샷 포함

- 서버는 `RoomState`에 `kill_feed: VecDeque<KillFeedEntry>` 버퍼를 둔다.
- 엔트리는 `occurredAt` 을 기준으로 **TTL 3.5초**가 지나면 tick cleanup 에서 제거한다 (클라 표시 3초 + 네트워크 여유 0.5초).
- `world_snapshot.payload.killFeed` 필드에 현재 살아 있는 엔트리 전체를 매 스냅샷마다 포함한다.
- `room_snapshot.payload.killFeed` 에도 동일 배열을 포함해, **재접속/늦게 합류한 클라이언트가 입장 직후 동일 버퍼를 받아 복원**할 수 있게 한다.
- 클라이언트는 엔트리 `id` 로 중복 렌더를 방지하고, 각 엔트리를 받은 뒤 3초가 지나면 로컬에서 제거한다. (서버 TTL 과 독립적으로 동작해 지연 환경에서도 자연스럽게 pop)
- 최대 버퍼 크기는 `16` 엔트리로 상한을 둔다 (과도한 스냅샷 팽창 방지).

### B. 사망 원인 표시 위치 — 킬로그 only

- 화면 중앙 토스트, 플레이어 머리 위 원인 라벨, 데스 리플레이 등은 **모두 비목표**.
- 플레이어는 오직 **킬로그 스택**을 통해서만 사망 원인을 확인한다.
- 리스폰 대기 상태 표시 보강은 킬로그와 별개로 진행한다 (본인 화면 피드백).

### C. 하단 플레이어 HUD — 구조 정의만

- 이번 단계에서 실제 Phaser/DOM UI 배치는 **하지 않는다**.
- `docs/technical/mini-spec-hazard-feedback-v1.md` 내부 또는 후속 문서에
  `프로필 / 속도 랭크 / HP 바 / 생명 / 습득 무기` 슬롯의 **1차 구조 문서**만 남긴다.
- 기존 HUD 텍스트(무기/탄/HP/점프)는 이번 작업에서 유지한다.

## 데이터 계약 초안

### `DeathCause`

```ts
export type DeathCause =
  | { kind: "fall_zone" }
  | { kind: "instant_kill_hazard" }
  | { kind: "weapon"; killerId: EntityId; weaponId: EntityId }
  | { kind: "self"; weaponId: EntityId }; // self-recoil 등
```

- `self` 는 자기 반동/자폭 통합용. v1에서는 실제로 발생하지 않더라도 타입만 예약.

### `KillFeedEntry`

```ts
export interface KillFeedEntry {
  id: EntityId;           // 서버에서 발급 (tick + sequence)
  occurredAt: TimestampMs;
  victimId: EntityId;
  cause: DeathCause;
}
```

- killer 정보는 `cause` 내부에 포함되어 있어, 별도 top-level 필드로 분리하지 않는다.
- `victimId` 만 top-level 로 둬 렌더/필터가 쉽다.

### 렌더 규칙 (클라이언트)

- `cause.kind === "weapon"` → `{killerName} -> {weaponDisplayName} -> {victimName}`
- `cause.kind === "fall_zone"` → `{victimName} -> 낙사`
- `cause.kind === "instant_kill_hazard"` → `{victimName} -> 함정`
- `cause.kind === "self"` → `{victimName} -> 자살`

## 하단 플레이어 상태 HUD 1차 구조 (문서 only)

```text
[ 프로필 아이콘 ][ 속도 랭크 ][ HP 바 ][ 생명 수 ][ 습득 무기 ]
```

- 위치: 화면 중앙 하단, `visualBounds` 하단에서 고정 오프셋.
- 다인전/팀전 시 레이아웃 복잡도가 급격히 커지므로 **4인 개인전 기준**으로만 설계.
- 각 슬롯은 v1에서는 텍스트 placeholder 로 남겨도 무방.
- 실제 배치/스타일링은 `mini-spec-hazard-feedback-v2` 또는 별도 HUD 미니 스펙으로 분리.

## 서버 리팩토링 메모

- `room_runtime.rs` 의 `deaths: Vec<String>` 을 `deaths: Vec<(String, DeathCause)>` 로 교체.
- `handle_weapon_attack` 은 `deaths.push((target_id, DeathCause::Weapon { killer_id, weapon_id }))` 로 기록.
- hazard 진입 사망은 `intersecting_hazard()` 의 `HazardKind` 에서 바로 매핑.
- `trigger_respawn` 호출 시점에 `RoomState::push_kill_feed(entry, now_ms)` 를 함께 호출.
- `kill_feed` cleanup 은 매 tick 시작 시 TTL 통과한 엔트리를 `pop_front()` 로 제거.

## 완료 조건

- 낙사와 즉사 함정 사망을 구분할 수 있다.
- 리스폰 중 상태가 더 명확하다.
- 킬로그와 하단 플레이어 상태 HUD의 1차 구조가 문서로 정리된다.

## 검증 방법

- 낙사/즉사 함정 각각 수동 재현
- 리스폰 대기 중 표시 확인
- 킬로그 스택 형식과 유지 시간(3초) 확인
