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
  "spawnPoints": [
    { "id": "spawn_a", "x": 120, "y": 360 },
    { "id": "spawn_b", "x": 1160, "y": 360 }
  ],
  "terrain": [],
  "collision": [],
  "hazards": [],
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

| 필드 | 설명 |
|------|------|
| `weaponSpawns` | 무기 생성 위치 및 소멸 규칙 |
| `itemSpawns` | 아이템 생성 위치와 연출 |
| `spawnStyle` | `airdrop | fade_in | triggered` |
| `despawnStyle` | `shrink_pop` 등 디스폰 연출 |

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

| 필드 | 설명 |
|------|------|
| `hitType` | `melee | hitscan | projectile | beam` |
| `fireMode` | `single | burst | auto | channel` |
| `resourceModel` | `infinite | magazine | capacity` |
| `maxResource` | 최대 탄/에너지 |
| `resourcePerShot` | 발사당 소모량 |
| `resourcePerSecond` | 채널형 무기 초당 소모량 |
| `discardOnEmpty` | 자원 고갈 시 무기 제거 여부 |
| `worldDespawnMs` | 월드에 놓였을 때 자동 소멸 시간 |
| `specialEffect` | `grab | explode | none` 등 |

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
  "friendlyFire": false
}
```

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
  "timeRemainingMs": 284000
}
```

### 스냅샷 원칙

- MVP에서는 전체 스냅샷 브로드캐스트를 우선 사용한다.
- 최적화 전에는 delta-compression을 도입하지 않는다.
- `serverTick`은 클라이언트 보간 기준점으로 사용한다.
- 빔 무기도 동일 스냅샷 구조 안에서 처리하되, 필요 시 별도 이펙트 이벤트를 추가한다.

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
