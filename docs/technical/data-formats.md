# 데이터 포맷

## 원칙

- 기본 교환 포맷은 **JSON**을 사용한다.
- 사람이 읽고 수정할 수 있어야 한다.
- Phaser와 Rust 양쪽에서 다루기 쉬워야 한다.
- 맵/무기 정의/아이템 정의/월드 인스턴스/네트워크 스냅샷 구조를 분리한다.
- 무기 시스템은 단순 총기뿐 아니라 **beam, grab, throwable** 계열까지 확장 가능해야 한다.

## 버전 필드

모든 외부 데이터는 버전 필드를 포함한다.

```json
{
  "version": 1
}
```

향후 breaking change가 생기면 버전을 올린다.

## 맵 포맷

```json
{
  "version": 1,
  "id": "arena_01",
  "name": "Training Arena",
  "size": {
    "width": 1280,
    "height": 720
  },
  "boundaryPolicy": "closed",
  "cameraPolicy": "static",
  "visualBounds": {
    "left": 0,
    "right": 1280,
    "top": 0,
    "bottom": 720
  },
  "gameplayBounds": {
    "left": 0,
    "right": 1280,
    "top": 0,
    "bottom": 720
  },
  "deathBounds": {
    "left": -200,
    "right": 1480,
    "top": -9999,
    "bottom": 900
  },
  "spawnPoints": [
    { "id": "spawn_a", "x": 120, "y": 80 },
    { "id": "spawn_b", "x": 1160, "y": 80 }
  ],
  "collision": [
    {
      "id": "floor_left",
      "type": "floor",
      "leftX": 0,
      "rightX": 330,
      "topY": 540
    },
    {
      "id": "floor_right",
      "type": "floor",
      "leftX": 470,
      "rightX": 1280,
      "topY": 540
    },
    {
      "id": "platform_mid",
      "type": "one_way_platform",
      "leftX": 250,
      "rightX": 550,
      "topY": 380
    },
    {
      "id": "pit_wall_left",
      "type": "solid_wall",
      "x": 330,
      "topY": 540,
      "bottomY": 720
    },
    {
      "id": "pit_wall_right",
      "type": "solid_wall",
      "x": 470,
      "topY": 540,
      "bottomY": 720
    }
  ],
  "hazards": [
    {
      "id": "pit_fall_zone",
      "type": "fall_zone",
      "x": 330,
      "y": 540,
      "width": 140,
      "height": 180
    },
    {
      "id": "spike_strip_right",
      "type": "instant_kill_hazard",
      "x": 960,
      "y": 522,
      "width": 96,
      "height": 18
    }
  ],
  "terrain": [],
  "weaponSpawns": [
    {
      "id": "weapon_mid",
      "weaponId": "acorn_blaster",
      "x": 640,
      "y": 320,
      "respawnMs": 10000,
      "despawnAfterMs": 10000,
      "spawnStyle": "airdrop",
      "despawnStyle": "shrink_pop",
      "mode": "fixed"
    }
  ],
  "itemSpawns": [
    {
      "id": "item_jump_1",
      "itemId": "jump_boost_small",
      "x": 960,
      "y": 240,
      "respawnMs": 15000,
      "spawnStyle": "fade_in"
    }
  ],
  "decorations": []
}
```

### 맵 필드 설명

| 필드             | 설명                                       |
| ---------------- | ------------------------------------------ | ------------------------------ | -------------------------- |
| `boundaryPolicy` | `closed                                    | open`                          |
| `cameraPolicy`   | `static                                    | follow                         | dynamic`                   |
| `visualBounds`   | 카메라가 보여줄 수 있는 시각적 울타리 범위 |
| `gameplayBounds` | 실제 이동 가능 범위                        |
| `deathBounds`    | out-of-bounds 사망 범위                    |
| `spawnPoints`    | 리스폰 위치 목록                           |
| `collision`      | `floor                                     | one_way_platform               | solid_wall` primitive 목록 |
| `hazards`        | `fall_zone                                 | instant_kill_hazard` rect 목록 |
| `weaponSpawns`   | 무기 생성 위치 및 소멸 규칙                |
| `itemSpawns`     | 아이템 생성 위치와 연출                    |
| `spawnStyle`     | `airdrop                                   | fade_in                        | triggered`                 |
| `despawnStyle`   | `shrink_pop` 등 디스폰 연출                |
| `mode`           | `fixed | random_candidates` |
| `spawnGroupId`   | 후보 지점 랜덤 스폰 그룹 ID |

### 충돌 primitive 규칙

- `floor`
  - `id`
  - `type: "floor"`
  - `leftX`
  - `rightX`
  - `topY`
- `one_way_platform`
  - `id`
  - `type: "one_way_platform"`
  - `leftX`
  - `rightX`
  - `topY`
- `solid_wall`
  - `id`
  - `type: "solid_wall"`
  - `x`
  - `topY`
  - `bottomY`

### hazard 규칙

- `fall_zone`
  - `id`
  - `type: "fall_zone"`
  - `x`
  - `y`
  - `width`
  - `height`
- `instant_kill_hazard`
  - `id`
  - `type: "instant_kill_hazard"`
  - `x`
  - `y`
  - `width`
  - `height`

### spawn 후보 그룹 규칙

- `mode: "fixed"`
  - 해당 위치에 고정 스폰
- `mode: "random_candidates"`
  - 같은 `spawnGroupId`를 공유하는 후보들 중 하나만 활성화
- `spawnGroupId`
  - 무기/아이템 후보 지점을 같은 순환 그룹으로 묶는 식별자

### 경계 / 카메라 정책 규칙

- `boundaryPolicy`
  - `closed | open`
- `cameraPolicy`
  - `static | follow | dynamic`
- `visualBounds`
  - `left`
  - `right`
  - `top`
  - `bottom`
- `gameplayBounds`
  - `left`
  - `right`
  - `top`
  - `bottom`
- `deathBounds`
  - `left`
  - `right`
  - `top`
  - `bottom`

## 현재 구현 참고

- 위 필드들은 맵 경계 정책과 카메라 규칙을 위한 장기 맵 포맷 기준이다.
- 현재 구현은 아직 이 필드를 실제 런타임 로딩에 사용하지 않는다.
- 현재 상태는 `docs/technical/current-implementation.md`를 기준으로 본다.

### visualBounds / gameplayBounds / deathBounds 해석

- `visualBounds`
  - 카메라가 보여줄 수 있는 최대 시각 범위
  - pit 아래 낙사 유도 영역, 버그 방지용 fence 같은 논리 영역을 굳이 보여줄 필요는 없다
- `gameplayBounds`
  - 플레이어가 실제로 이동 가능한 범위
- `deathBounds`
  - gameplayBounds 바깥에서 더 멀리 벗어났을 때 사망 처리되는 범위

즉, **카메라 clamp는 visualBounds 기준**이고,
논리 판정은 gameplayBounds / deathBounds 기준으로 따로 해석한다.

### follow 카메라 이동 원칙

- `cameraPolicy: "follow"`는 선형 고정 속도 이동보다
  **지연 추적 + 가속/감속이 있는 damping 계열 이동**을 기본 후보로 둔다.
- Bezier 곡선은 기본 follow 수단보다 **연출용/특수 카메라 경로**에 더 적합한 후보로 본다.

## 무기 정의 포맷

```json
{
  "version": 1,
  "id": "acorn_blaster",
  "name": "Acorn Blaster",
  "hitType": "hitscan",
  "fireMode": "single",
  "resourceModel": "magazine",
  "damage": 12,
  "knockback": 8,
  "selfRecoilForce": 1,
  "selfRecoilAngleDeg": 0,
  "selfRecoilAngleJitterDeg": 0,
  "selfRecoilGroundMultiplier": 1,
  "selfRecoilAirMultiplier": 1.2,
  "attackIntervalMs": 220,
  "range": 620,
  "projectileSpeed": 0,
  "spreadDeg": 2,
  "pelletCount": 1,
  "maxResource": 8,
  "resourcePerShot": 1,
  "resourcePerSecond": 0,
  "discardOnEmpty": true,
  "pickupWeight": 10,
  "rarity": "common",
  "worldDespawnMs": 10000,
  "specialEffect": null
}
```

### 무기 정의 필드

| 필드                         | 설명                            |
| ---------------------------- | ------------------------------- | -------- | ---------- | -------- |
| `hitType`                    | `melee                          | hitscan  | projectile | beam`    |
| `fireMode`                   | `single                         | burst    | auto       | channel` |
| `resourceModel`              | `infinite                       | magazine | capacity`  |
| `knockback`                  | 상대에게 가는 넉백              |
| `selfRecoilForce`            | 발사자에게 가는 기본 반동 세기  |
| `selfRecoilAngleDeg`         | 에임 반대 방향 기준 각도 보정   |
| `selfRecoilAngleJitterDeg`   | 발사마다 줄 수 있는 반동 오차   |
| `selfRecoilGroundMultiplier` | 지상 반동 배수                  |
| `selfRecoilAirMultiplier`    | 공중 반동 배수                  |
| `maxResource`                | 최대 탄/에너지                  |
| `resourcePerShot`            | 발사당 소모량                   |
| `resourcePerSecond`          | 채널형 무기 초당 소모량         |
| `discardOnEmpty`             | 자원 고갈 시 무기 제거 여부     |
| `worldDespawnMs`             | 월드에 놓였을 때 자동 소멸 시간 |
| `specialEffect`              | `grab                           | explode  | none` 등   |

### 후속 확장 후보: 조준 각도 / Dead zone

- 현재 `WeaponDefinition` 에는 조준 가능 각도 제한 필드가 없다.
- 후속 단계에서는 무기별 허용 발사 각도를 위해 아래와 같은 확장 필드를 검토한다.

```ts
type WeaponAimProfile = {
  mode: "free" | "horizontal_only" | "vertical_only";
  minAimDeg: number;
  maxAimDeg: number;
  deadZoneBehavior: "clamp" | "block";
};
```

- 이 구조는 아직 런타임 계약에 반영되지 않았다.
- 상세 초안은 `docs/technical/mini-spec-weapon-angle-deadzone-v0.md` 를 참조한다.

### 예시: beam 무기

```json
{
  "version": 1,
  "id": "laser_cutter",
  "name": "Laser Cutter",
  "hitType": "beam",
  "fireMode": "channel",
  "resourceModel": "capacity",
  "damage": 6,
  "knockback": 1,
  "selfRecoilForce": 0,
  "selfRecoilAngleDeg": 0,
  "selfRecoilAngleJitterDeg": 0,
  "selfRecoilGroundMultiplier": 1,
  "selfRecoilAirMultiplier": 1,
  "attackIntervalMs": 100,
  "range": 520,
  "projectileSpeed": 0,
  "spreadDeg": 0,
  "pelletCount": 1,
  "maxResource": 100,
  "resourcePerShot": 0,
  "resourcePerSecond": 20,
  "discardOnEmpty": true,
  "pickupWeight": 2,
  "rarity": "rare",
  "worldDespawnMs": 10000,
  "specialEffect": null
}
```

### 예시: grab 무기

```json
{
  "version": 1,
  "id": "grab_spear",
  "name": "Grab Spear",
  "hitType": "melee",
  "fireMode": "single",
  "resourceModel": "magazine",
  "damage": 4,
  "knockback": 2,
  "selfRecoilForce": 0.4,
  "selfRecoilAngleDeg": 0,
  "selfRecoilAngleJitterDeg": 0,
  "selfRecoilGroundMultiplier": 1,
  "selfRecoilAirMultiplier": 1,
  "attackIntervalMs": 900,
  "range": 80,
  "projectileSpeed": 0,
  "spreadDeg": 0,
  "pelletCount": 1,
  "maxResource": 3,
  "resourcePerShot": 1,
  "resourcePerSecond": 0,
  "discardOnEmpty": true,
  "pickupWeight": 1,
  "rarity": "rare",
  "worldDespawnMs": 10000,
  "specialEffect": {
    "kind": "grab",
    "grabDurationMs": 3000
  }
}
```

## 아이템 정의 포맷

```json
{
  "version": 1,
  "id": "jump_boost_small",
  "name": "Jump Boost",
  "itemType": "jump_boost",
  "maxStack": 1,
  "effect": {
    "jumpCountDelta": 1
  }
}
```

### 아이템 종류

- `speed_rank_up`
- `extra_life`
- `health_recover`
- `jump_boost`

### 아이템 규칙

- `jumpCountDelta` 적용 후 `maxJumpCount`는 `1 ~ 3` 범위로 clamp
- `speed_rank_up` 적용 후 `moveSpeedRank`는 `-7 ~ +7` 범위로 clamp
- 회복 아이템은 최대 HP를 넘기지 않음

## 월드 무기 인스턴스 포맷

```json
{
  "id": "pickup_42",
  "weaponId": "acorn_blaster",
  "position": { "x": 640, "y": 320 },
  "source": "spawn",
  "resourceRemaining": 8,
  "spawnedAt": 1712600000000,
  "despawnAt": 1712600010000,
  "spawnStyle": "airdrop",
  "despawnStyle": "shrink_pop"
}
```

## 월드 아이템 인스턴스 포맷

```json
{
  "id": "item_pickup_7",
  "itemId": "jump_boost_small",
  "position": { "x": 960, "y": 240 },
  "source": "spawn",
  "spawnedAt": 1712600000000
}
```

## 플레이어 상태 포맷

서버 authoritative 상태의 기본 단위는 아래 구조를 따른다.

```json
{
  "id": "player_1",
  "name": "hammy",
  "position": { "x": 320, "y": 280 },
  "velocity": { "x": 0, "y": 0 },
  "direction": "right",
  "hp": 100,
  "lives": 99,
  "moveSpeedRank": 0,
  "maxJumpCount": 1,
  "jumpCountUsed": 0,
  "grounded": true,
  "dropThroughUntil": null,
  "respawnAt": null,
  "equippedWeaponId": "paws",
  "equippedWeaponResource": null,
  "grabState": null,
  "lastDeathCause": null,
  "kills": 0,
  "deaths": 0,
  "state": "alive"
}
```

### 상태값

- `state`: `alive | respawning | eliminated`
- `direction`: `left | right`
- `moveSpeedRank`: `-7 ~ 7`
- `maxJumpCount`: `1 | 2 | 3`
- `equippedWeaponResource`: 기본 무기는 `null`, 보급 무기는 숫자 사용
- `jumpCountUsed`: 현재까지 사용한 점프 횟수
- `grounded`: 지면/플랫폼에 착지 중인지 여부
- `dropThroughUntil`: 플랫폼 내려오기 충돌 무시 종료 시각
- `respawnAt`: 리스폰 예정 시각
- `grabState`: grab 중이면 대상/남은 시간 정보 포함 가능
- `lastDeathCause`: 최근 사망 원인. 살아 있는 동안에는 보통 `null`
- `kills`: 현재 매치 누적 킬 수
- `deaths`: 현재 매치 누적 데스 수

### `lastDeathCause` 용도

- `state === "respawning"` 인 동안 클라이언트가 최근 사망 원인을 보고 연출을 다르게 적용할 수 있도록 둔 필드다.
- 현재 1차 구현 기준:
  - `fall_zone`, `instant_kill_hazard`: 본체 즉시 숨김
  - `weapon`, `self`: 짧은 임시 중력 더미 연출

## 룸 설정 포맷

```json
{
  "version": 1,
  "roomId": "room_alpha",
  "mode": "deathmatch",
  "teamMode": false,
  "maxPlayers": 4,
  "mapId": "arena_01",
  "timeLimitSec": 300,
  "stockLives": 3,
  "startHp": 100,
  "baseJumpCount": 1,
  "maxJumpCountLimit": 3,
  "friendlyFire": false
}
```

### 룸 설정 필드 설명

| 필드 | 설명 |
|------|------|
| `timeLimitSec` | 매치 시간 제한(초) |
| `stockLives` | 시작 생명 수 |
| `startHp` | 시작 HP |
| `baseJumpCount` | 기본 점프 수 |
| `maxJumpCountLimit` | 룸에서 허용하는 최대 점프 수 상한 |
| `friendlyFire` | 아군 피해 허용 여부 |

## 매치 스냅샷 포맷

```json
{
  "version": 1,
  "roomId": "room_alpha",
  "matchState": "running",
  "serverTick": 128,
  "players": [],
  "projectiles": [],
  "weaponPickups": [],
  "itemPickups": [],
  "countdownMs": null,
  "timeRemainingMs": 284000,
  "killFeed": [],
  "damageEvents": []
}
```

### 스냅샷 원칙

- MVP에서는 전체 스냅샷 브로드캐스트를 우선 사용한다.
- 최적화 전에는 delta-compression을 도입하지 않는다.
- `serverTick`은 클라이언트 보간 기준점으로 사용한다.
- 빔 무기도 동일 스냅샷 구조 안에서 처리하되, 필요 시 별도 이펙트 이벤트를 추가한다.

## 피격 이벤트 포맷

`world_snapshot.damageEvents` 와 `room_snapshot.damageEvents` 는 동일 구조를 공유한다.

```json
[
  {
    "id": "dmg_128_3",
    "occurredAt": 1712600001150,
    "victimId": "player_2",
    "attackerId": "player_1",
    "weaponId": "acorn_blaster",
    "damage": 12,
    "impactDirection": { "x": 1, "y": 0 },
    "impactPoint": { "x": 486, "y": 312 }
  }
]
```

### 피격 이벤트 규칙

- `impactDirection` 은 공격이 진행된 방향이다.
- `impactPoint` 는 몸통 근처의 근사 피격 지점이다.
- 현재 클라이언트는 이를 파티클 분산 방향과 사망 더미 launch 보정에 사용한다.
- 서버는 짧은 TTL 버퍼만 유지하고, 클라이언트는 `id` 로 중복 렌더를 막는다.

## 킬로그 포맷

`world_snapshot.killFeed` 와 `room_snapshot.killFeed` 는 동일 구조를 공유한다.

```json
[
  {
    "id": "kf_128_3",
    "occurredAt": 1712600001150,
    "victimId": "player_2",
    "cause": {
      "kind": "weapon",
      "killerId": "player_1",
      "weaponId": "acorn_blaster"
    }
  },
  {
    "id": "kf_130_1",
    "occurredAt": 1712600002500,
    "victimId": "player_3",
    "cause": { "kind": "fall_zone" }
  }
]
```

### 사망 원인 (`DeathCause`)

- `{ "kind": "fall_zone" }` — `fall_zone` hazard 진입으로 사망
- `{ "kind": "instant_kill_hazard" }` — `instant_kill_hazard` 진입으로 사망
- `{ "kind": "weapon", "killerId": ..., "weaponId": ... }` — 다른 플레이어 무기에 의한 사망
- `{ "kind": "self", "weaponId": ... }` — 자기 반동/자폭 등 스스로의 피해로 사망

### 킬로그 규칙

- `id` 는 서버가 발급하며, 클라이언트는 중복 렌더 방지용으로 사용한다.
- 서버는 `occurredAt` 기준 `3.5s` 동안 엔트리를 보존하고, 그 이후 tick cleanup 에서 제거한다.
- 버퍼 상한은 `16` 엔트리이며, 초과 시 가장 오래된 엔트리부터 제거한다.
- 클라이언트는 수신 시각 기준 `3s` 후 로컬에서 엔트리를 제거한다 (서버 TTL 과 독립).
- 재접속 또는 지각 합류한 클라이언트는 첫 `room_snapshot` 의 `killFeed` 로 현재 상태를 복원한다.

## 입력 포맷

클라이언트 입력은 프레임 상태가 아니라 **의도(intent)** 중심으로 보낸다.

```json
{
  "sequence": 14,
  "move": {
    "x": 1,
    "y": 0
  },
  "aim": {
    "x": 0.82,
    "y": -0.11
  },
  "jump": true,
  "attack": true,
  "dropWeapon": false
}
```

### 입력 규칙

- `jump`: 해당 틱의 점프 입력
- `attack`: 단발/채널/투척/그랩 무기의 공통 공격 입력
- `dropWeapon`: 현재 무기 버리기

## 상태 효과 포맷

```json
{
  "moveSpeedRank": 0,
  "maxJumpCount": 1,
  "effects": []
}
```

향후 확장 시 `effects`는 아래 구조를 따른다.

```json
{
  "id": "jump_boost",
  "kind": "mobility",
  "durationMs": 3000,
  "stacks": 1
}
```

다만 MVP에서는 `effects`를 비워 두고, 실제 적용값은 `moveSpeedRank`, `maxJumpCount`만 사용한다.
