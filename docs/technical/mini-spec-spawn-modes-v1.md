# 미니 스펙: 스폰 모드 v1

작업명:
스폰 모드 v1 정의

목표:
맵 제작자가 하나의 스폰 후보 지점 집합으로 `고정 스폰`과 `동적 스폰`을 함께 설계할 수 있게 하고, 룸/모드가 어떤 규칙으로 이를 해석하는지 정리한다.

이번 범위:
- 플레이어 스폰을 `fixed` / `dynamic` 두 모드로 정의한다.
- 맵 `spawnPoints`가 두 모드의 후보 지점 역할을 함께 가질 수 있는 데이터 방향을 정리한다.
- 룸/모드가 어떤 스폰 규칙을 선택하는지와 기본 fallback 규칙을 정리한다.

건드리는 스펙/문서:
- `docs/game-design/map-design.md`
- `docs/technical/data-formats.md`
- `docs/technical/current-implementation.md`

비목표:
- 실제 서버 스폰 알고리즘 구현
- 스폰 무적/보호막 규칙 추가
- 팀전 전용 스폰 로직 확정

검증 방법:
- 후속 구현에서 `packages/shared/world.ts` 의 `SpawnPoint` 확장으로 바로 분해 가능한지 확인
- 맵 JSON 한 벌로 `free_play` 와 `deathmatch` 가 각각 다른 스폰 규칙을 사용할 수 있는지 검토

## 1. 배경

현재 `spawnPoints` 는 단순 좌표 목록이라, 매치형 고정 스폰과 프리월드/자유맵형 랜덤 스폰을 같은 맵 데이터에서 유연하게 다루기 어렵다.

앞으로는 맵이 스폰 후보 지점의 전체 집합을 제공하고, 룸이 어떤 스폰 모드를 사용할지를 결정하는 구조로 간다.

## 2. 용어

- `fixed spawn`
  - 플레이어 슬롯과 스폰 지점이 안정적으로 매핑되는 방식
- `dynamic spawn`
  - 리스폰 시점마다 후보 집합에서 안전한 위치를 골라 배치하는 방식
- `spawn candidate`
  - 맵 안에 정의된 개별 스폰 후보 지점

## 3. 스폰 모드 정의

### A. `fixed`

- 플레이어 수와 슬롯 순서에 영향을 받는다.
- 각 플레이어는 안정적인 스폰 위치를 가진다.
- 매치룸, 대칭 아레나, 경쟁형 룰의 기본값으로 둔다.
- 같은 룸에서 반복 리스폰해도 기본적으로 같은 슬롯 지점을 우선 사용한다.

### B. `dynamic`

- 플레이어 수와 슬롯 고정 배치에 직접 묶지 않는다.
- 리스폰 시점마다 후보 집합에서 하나를 선택한다.
- `free_play`, 개방형 맵, 대형 맵, 이벤트성 룰의 기본값으로 둔다.
- 같은 플레이어라도 매번 다른 지점에서 시작할 수 있다.

## 4. 맵 데이터 방향

기존 `spawnPoints` 배열은 유지하되, 각 지점이 두 모드의 사용 가능 여부를 함께 가질 수 있게 확장한다.

예시 방향:

```json
{
  "id": "spawn_mid_left",
  "x": 240,
  "y": 120,
  "modes": {
    "fixed": {
      "enabled": true,
      "slotIndex": 1
    },
    "dynamic": {
      "enabled": true,
      "weight": 1
    }
  },
  "tags": ["platform", "safe"]
}
```

핵심 규칙:

- 같은 후보 지점은 아래 네 가지 모두 가능해야 한다.
  - `fixed` 만 사용
  - `dynamic` 만 사용
  - 둘 다 사용
  - 둘 다 사용 안 함
- 맵 제작자는 좌표를 이중으로 복제하지 않고도 두 룰을 동시에 준비할 수 있어야 한다.
- 현재 단순 `spawnPoints` 는 v1 구현 시 위 구조로 확장한다.

## 5. 제안 필드

`SpawnPoint` 확장 초안:

- `id`, `x`, `y`
- `modes.fixed.enabled: boolean`
- `modes.fixed.slotIndex?: number`
- `modes.dynamic.enabled: boolean`
- `modes.dynamic.weight?: number`
- `tags?: string[]`

의도:

- `slotIndex`
  - 고정 스폰일 때 플레이어 슬롯과 연결하는 안정적인 순서 키
- `weight`
  - 동적 스폰일 때 동일 후보군 내부 가중치
- `tags`
  - 추후 `high_ground`, `edge`, `safe`, `contest` 같은 해석 확장을 위한 예약 필드

## 6. 룸/모드 해석 규칙

룸은 `spawnMode` 를 가진다.

- `free_play`
  - 기본값 `dynamic`
- `deathmatch`
  - 기본값 `fixed`
- 후속 확장
  - 룸 생성 시 명시적으로 override 가능

예시 방향:

```ts
type RoomSpawnMode = "fixed" | "dynamic";
```

## 7. 선택 규칙

### `fixed`

- `modes.fixed.enabled === true` 인 후보만 사용한다.
- `slotIndex` 오름차순으로 정렬한다.
- 플레이어 슬롯 `n` 은 가능한 한 `slotIndex = n` 지점을 우선 사용한다.
- 필요한 슬롯 수보다 후보가 적으면 남은 슬롯은 기존 순서 기준 fallback 을 사용한다.

### `dynamic`

- `modes.dynamic.enabled === true` 인 후보만 사용한다.
- 후보가 여러 개면 `weight` 기반 랜덤을 기본으로 둔다.
- 후속 구현에서 아래 안전도 규칙을 추가할 수 있다.
  - 현재 살아 있는 다른 플레이어와 너무 가까운 지점은 우선순위를 낮춘다.
  - 최근 사망 지점과 매우 가까운 후보는 우선순위를 낮춘다.

## 8. 기본 fallback 규칙

- `fixed` 후보가 하나도 없으면 전체 `spawnPoints` 를 기존 순서대로 사용한다.
- `dynamic` 후보가 하나도 없으면 전체 `spawnPoints` 를 균등 랜덤으로 사용한다.
- 맵이 두 모드 필드를 아직 제공하지 않는 과도기 동안도 런타임이 깨지지 않아야 한다.

## 9. 맵 제작 규칙

- 2인/4인 경쟁형 아레나는 `fixed` 후보를 우선 설계한다.
- 개방형 맵과 자유맵은 `dynamic` 후보를 넉넉하게 배치한다.
- 낙사 구역, 함정 바로 위, 즉시 교전이 발생하는 위치는 `dynamic` 기본 후보로 남용하지 않는다.
- `dynamic` 후보는 플레이어 수에 무관하게 충분한 분산을 제공해야 한다.

## 10. 현재 구현과의 관계

- 현재 구현은 `spawnPoints` 의 단순 순서 기반 리스폰이다.
- 이 문서는 다음 단계에서 shared 타입, 맵 JSON, 서버 리스폰 선택 로직을 함께 확장하기 위한 기준이다.

## 11. 구현 순서 제안

1. `packages/shared/world.ts` 의 `SpawnPoint` 확장
2. `docs/technical/data-formats.md` 의 맵 예시와 필드 설명 갱신
3. 서버 리스폰 선택 로직에 `RoomSpawnMode` 도입
4. 테스트 맵에 `fixed` / `dynamic` 예시 지점 추가
5. 클라이언트 디버그 오버레이에서 모드별 스폰 후보 시각화 추가
