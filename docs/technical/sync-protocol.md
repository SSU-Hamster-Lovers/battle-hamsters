# 동기화 프로토콜

## 목표

초기 동기화 프로토콜의 목표는 다음 세 가지다.

1. 연결이 단순할 것
2. 서버 권위가 명확할 것
3. 빠른 이동 난전과 다양한 무기/아이템 동작을 나중에도 수용할 수 있을 것

## 전송 방식

- 실시간 전투 연결: **WebSocket**
- MVP 메시지 포맷: **JSON envelope**
- 서버 모델: **authoritative server**

## Envelope 형식

모든 메시지는 공통 envelope를 사용한다.

```json
{
  "type": "room_snapshot",
  "timestamp": 1712600000000,
  "payload": {}
}
```

## 연결 순서

1. 클라이언트가 WebSocket 연결
2. 서버가 `welcome` 전송
3. 클라이언트가 `join_room` 전송
4. 서버가 `room_snapshot` 전송
5. 클라이언트가 주기적으로 `player_input` 전송
6. 서버가 주기적으로 `world_snapshot` 전송

## 설계 원칙

- 이동, 점프, 사격, 빔 조사, 아이템 효과 적용 모두 **서버가 최종 확정**한다.
- 기본 무기를 제외한 무기는 모두 유한 자원 무기다.
- 드랍 무기와 스폰 무기는 월드에서 일정 시간 후 despawn 된다.
- 채널형 무기(beam)는 단발 사격과 다르게 **유지 입력 + 시간당 자원 소모**로 처리할 수 있어야 한다.
- 발사 시 상대 넉백과 발사자 자기 반동도 모두 **서버가 최종 확정**한다.
- 점프 횟수는 `1 ~ 3` 범위 밖으로 벗어나지 않도록 서버가 clamp 한다.

## 클라이언트 -> 서버 메시지

### `join_room`

```json
{
  "type": "join_room",
  "timestamp": 1712600001000,
  "payload": {
    "roomId": "room_alpha",
    "playerName": "hammy"
  }
}
```

### `player_input`

```json
{
  "type": "player_input",
  "timestamp": 1712600001100,
  "payload": {
    "sequence": 14,
    "move": { "x": 1, "y": 0 },
    "aim": { "x": 1, "y": 0 },
    "jump": false,
    "attack": true,
    "attackPressed": false,
    "pickupWeaponPressed": false,
    "dropWeapon": false,
    "dropWeaponPressed": false
  }
}
```

#### 해석 규칙

- `attack: true`는 버튼이 눌린 상태를 의미한다.
- `attackPressed: true`는 이번 입력 프레임에서 새 발사 요청이 생겼음을 의미한다.
- `pickupWeaponPressed: true`는 이번 입력 프레임에서 무기 pickup 요청이 생겼음을 의미한다.
- `dropWeaponPressed: true`는 이번 입력 프레임에서 무기 드롭 요청이 생겼음을 의미한다.
- 단발 무기는 이 입력을 발사 트리거로 해석할 수 있다.
- 채널형 무기는 `attack: true`가 유지되는 동안 발사 지속으로 해석할 수 있다.
- 투척 무기와 grab 무기도 동일 공격 입력을 사용한다.

## 서버 -> 클라이언트 메시지

### `room_snapshot`

```json
{
  "type": "room_snapshot",
  "timestamp": 1712600001050,
  "payload": {
    "roomId": "room_alpha",
    "players": [],
    "weaponPickups": [],
    "itemPickups": [],
    "matchState": "waiting",
    "killFeed": []
  }
}
```

### `world_snapshot`

```json
{
  "type": "world_snapshot",
  "timestamp": 1712600001150,
  "payload": {
    "serverTick": 128,
    "players": [],
    "projectiles": [],
    "weaponPickups": [],
    "itemPickups": [],
    "killFeed": []
  }
}
```

#### 킬로그 (`killFeed`) 규칙

- `room_snapshot` 과 `world_snapshot` 모두 현재 유효한 킬로그 엔트리 배열을 포함한다.
- 재접속/지각 합류한 클라이언트가 첫 `room_snapshot` 만 받아도 현재 피드 상태를 복원할 수 있다.
- 서버 버퍼 TTL 은 `3.5s` (클라 표시 3s + 네트워크 여유 0.5s), 버퍼 상한은 `16` 엔트리다.
- 엔트리 타입:
  ```ts
  interface KillFeedEntry {
    id: EntityId;            // 서버에서 발급 (중복 렌더 방지용)
    occurredAt: TimestampMs;
    victimId: EntityId;
    cause: DeathCause;
  }
  type DeathCause =
    | { kind: "fall_zone" }
    | { kind: "instant_kill_hazard" }
    | { kind: "weapon"; killerId: EntityId; weaponId: EntityId }
    | { kind: "self"; weaponId: EntityId };
  ```
- 클라이언트는 `id` 로 중복 렌더를 막고, 수신 시각 기준 3초 후 로컬에서 제거한다.

## 판정 원칙

- 이동 판정: 서버 최종 확정
- 점프 횟수 소비/회복: 서버 최종 확정
- 사격 판정: 서버 최종 확정
- 상대 넉백 / 자기 반동 적용: 서버 최종 확정
- beam 조사 판정: 서버 최종 확정
- grab 상태 부여/해제: 서버 최종 확정
- 무기 자원 감소 및 무기 소멸: 서버 최종 확정
- 아이템 획득 및 효과 적용: 서버 최종 확정
- 클라이언트는 시각 효과만 먼저 보여줄 수 있음

## 서버 틱 정책

MVP에서는 아래 정책을 사용한다.

- 입력 수집: 클라이언트 프레임마다 최신값 유지
- 시뮬레이션 틱: `20 TPS` 또는 `30 TPS`
- 스냅샷 브로드캐스트: 시뮬레이션 틱과 동일 또는 절반

초기 구현은 **안정적인 20 TPS**를 우선 추천한다.

## 후속 확장 메시지

아래 메시지는 later phase에서 추가한다.

- `weapon_picked`
- `weapon_dropped`
- `weapon_despawned`
- `item_picked`
- `item_spawned`
- `grab_started`
- `grab_ended`
- `beam_started`
- `beam_stopped`
- `damage_applied`
- `player_respawned`
- `score_updated`

## 플랫폼 이동 1차 해석 규칙

- `move.x`는 좌우 이동 입력으로 사용한다.
- `jump`는 점프 시작 입력으로 사용한다.
- `move.y > 0` 또는 아래 입력은 공중에서는 급강하, 원웨이 플랫폼 위에서는 플랫폼 내려오기 조건으로 해석할 수 있다.
- 중력, 착지, 낙사, 리스폰은 모두 서버가 최종 확정한다.
- 현재 테스트 규칙에서는 낙사 후 3초 뒤 상공에서 리스폰한다.
