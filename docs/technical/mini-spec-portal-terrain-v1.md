# 미니 스펙: 포탈 / 순환형 지형지물 v1

## 작업명

`feat/portal-terrain-v1`

## 목표

맵에 **포탈 쌍(A↔B)**을 배치해, 포탈을 통과하는 플레이어를 반대편 포탈 출구로 순간이동시킨다. 이동 중 속도 벡터는 유지된다.

---

## 설계 결정

### 포탈 vs 순환형 맵

| 방식 | 장점 | 단점 |
|------|------|------|
| **포탈 쌍** (채택) | 기존 맵에 추가 용이, 배치 자유도 높음 | 입구/출구 개념 설명 필요 |
| 순환형 맵 (좌=우, 상=하) | 직관적 | 카메라 처리 복잡, 클라이언트 렌더링 복잡 |

1차는 **포탈 쌍** 방식 채택.

### 눈속임 (시각적 깊이)

- 포탈 입구를 "터널 입구" 형태로 렌더링 — 뒤로 갈수록 어두워지는 gradient 터널
- 포탈 통과 시 짧은 화면 flash 또는 원형 wipe 연출

---

## 데이터 구조

### `packages/shared/maps/*.json` 에 추가

```json
"portals": [
  {
    "id": "portal_left_to_right",
    "entranceX": 80,
    "entranceY": 400,
    "exitX": 1520,
    "exitY": 400,
    "width": 40,
    "height": 80,
    "pairedPortalId": "portal_right_to_left"
  },
  {
    "id": "portal_right_to_left",
    ...
  }
]
```

### `packages/shared/maps.ts` (타입)

```typescript
export interface PortalDefinition {
  id: string;
  entranceX: number;
  entranceY: number;
  exitX: number;
  exitY: number;
  width: number;
  height: number;
  pairedPortalId: string;
}
```

---

## 서버 동작

`room_runtime.rs` 이동 처리 후:

1. 플레이어 AABB와 포탈 AABB 교차 판정
2. 교차 시 → `player.position = (exitX, exitY)`, `velocity` 유지
3. 같은 포탈로 연속 텔레포트 방지: `last_portal_exit_at` 쿨다운 200ms

---

## 클라이언트 동작

- `world_snapshot`에는 위치만 포함 → 포탈 통과 후 위치가 점프한 것처럼 보임
- 로컬 플레이어 텔레포트 감지: 이전 프레임 위치와 현재 위치 차이가 임계값 초과 → 텔레포트 flash 재생
- 포탈 렌더링: 터널형 그라디언트 원 (두 포탈 모두)
- 포탈 통과 파티클: 짧은 소용돌이 이펙트

---

## 이번 범위

- `packages/shared/maps.ts` — `PortalDefinition` 타입 추가
- `packages/shared/maps/training-arena.json` — 포탈 쌍 1개 추가 (테스트용)
- `server/src/game_data.rs` — 포탈 정의 로딩
- `server/src/room_runtime.rs` — 포탈 통과 판정 + 텔레포트 처리
- `apps/game/src/main.ts` — 포탈 렌더링 + 텔레포트 연출

## 비목표

- 포탈 입장 중 중간 애니메이션 (1차는 즉시 텔레포트)
- 원-웨이 포탈 (1차는 항상 양방향)
- 포탈 개수 제한 없는 배치 (1차는 맵 1쌍만)
- 투사체 포탈 통과

---

## 건드리는 파일

| 파일 | 변경 |
|------|------|
| `packages/shared/maps.ts` | PortalDefinition 타입 |
| `packages/shared/maps/training-arena.json` | 포탈 쌍 추가 |
| `server/src/game_data.rs` | 포탈 로딩 |
| `server/src/room_runtime.rs` | 텔레포트 판정 |
| `apps/game/src/main.ts` | 포탈 렌더 + 이펙트 |

---

## 검증 방법

- 포탈 A 진입 시 포탈 B 출구에 즉시 나타나는지 확인
- B → A 방향도 동작하는지 확인
- 속도 벡터가 유지되어 포탈 통과 후 연속 이동 가능한지 확인
- 텔레포트 순간 flash 이펙트 재생 확인
- `cargo test` 전체 통과
