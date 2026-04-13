# 미니 스펙: 훈련 아레나 맵 재설계 v2 ✅ 완료

## 작업명

`feat/map-rework-v2`

## 목표

현재 `training-arena.json`의 두 가지 근본 문제를 해결하고 게임플레이 다양성을 높인다.

1. **점프 불가 문제**: 지상(y=680)에서 현재 모든 원웨이 플랫폼(y=340~520)까지의 거리가 최대 점프 높이(~116px)를 초과해 지상 낙하 후 복귀 불가.
2. **단조로운 레이아웃**: 함정 1종, 셸터 없음, 스폰 4개 상단 고정, 무기 스폰이 한쪽에 집중.

---

## 점프 높이 제약

| 상수 | 값 |
|------|-----|
| 점프 초속 | 18 px/tick (위 방향) |
| 중력 | 1.4 px/tick² |
| **최대 도달 높이** | **≈ 116 px** |

→ 각 플랫폼 간 수직 간격은 **≤ 110 px**로 설계해야 단일 점프로 오를 수 있다.

---

## 새 레이아웃 설계 원칙

```
y=60:  [플레이어 스폰 존 — 맵 전역 분산]

y=350: [상단 레벨 — 건물 지붕 + 고위험 지역]
y=460: [중간 레벨 — 건물 내부 / mid-lane]
y=570: [저층 레벨 — 지상 인접, 건물 입구]
y=680: [지상 — 좌우 바닥 + 중앙 피트]
y=980: [낙사 존]
```

각 레이어 간 수직 차이: 110px 전후 → 점프 1회로 순차 이동 가능.

---

## 구조물 / 건물 (3개)

### 건물 A — 왼쪽 벙커 (소형)

- 위치: x=60~280, 지상~중간 레벨
- 구성:
  - 좌우 `solid_wall` (입구 갭 포함)
  - 내부 저층 `one_way_platform` at y=570
  - 상층 `one_way_platform` at y=460
  - 지붕 perch `one_way_platform` at y=350
- 역할: 초반 피난처, 내부 무기 스폰 1개

### 건물 B — 중앙 타워 (중형)

- 위치: x=680~920 (기존 피트 위)
- 구성:
  - 피트 위 `one_way_platform` 브릿지 at y=570
  - 상단 `one_way_platform` 테라스 at y=460
  - 중앙 crown `one_way_platform` at y=350
  - 좌우 반벽으로 위에서 내려쏘기 가능
- 역할: 고-위험/고-보상 중앙 제어 지점, 중앙 무기 스폰

### 건물 C — 오른쪽 벙커 (소형, A의 미러)

- 위치: x=1320~1540, 지상~중간 레벨
- 구성: 건물 A 좌우 반전

---

## 함정 재설계

### 유지
- `pit_fall_zone`: 중앙 피트 (x=640~960, y=860~980)

### 추가
- `spike_left` (instant_kill_hazard): 좌측 지상 일부에 가시 지대
- `spike_right` (instant_kill_hazard): 우측 지상 일부에 가시 지대
- `spike_pit_edge_left/right` (instant_kill_hazard): 피트 입구 모서리 가시

### 가시 스프라이트 (클라이언트)
- 기존 단색 빨간 사각형 hazard → 위쪽 가시 삼각형 패턴 (5~7개/텍스처)
- `instant_kill_hazard`는 가시 스프라이트, `fall_zone`은 기존 어두운 오버레이 유지

---

## 무기 스폰 재설계

기존 armory shelf 집중 배치 → **맵 전역 분산**:

| 위치 | 무기 | 스폰 모드 |
|------|------|-----------|
| 건물 A 내부 | acorn_blaster | fixed |
| 건물 B 상단 | walnut_cannon | fixed (airdrop) |
| 건물 C 내부 | seed_shotgun | fixed |
| 지상 좌측 | ember_sprinkler | fixed |
| 중간 레벨 좌 | acorn_blaster / seed_shotgun | random_candidates |
| 중간 레벨 우 | acorn_blaster / seed_shotgun | random_candidates |

기존 armory 고정 스폰 4개 → 삭제.

우측 신규 무기 슬롯은 이번 브랜치에서 좌표만 예약하고 런타임 스폰에는 넣지 않는다.

---

## 플레이어 스폰 재설계

기존 스폰 4개 (모두 y=80, 상단 집중) → **6~8개, 맵 전역 고르게 분산**:

| ID | 위치 | 레벨 |
|----|------|------|
| spawn_topleft | x=200, y=60 | 상단 좌 |
| spawn_topright | x=1400, y=60 | 상단 우 |
| spawn_midleft | x=250, y=336 | 좌측 roof perch |
| spawn_midright | x=1350, y=336 | 우측 roof perch |
| spawn_center_high | x=800, y=60 | 상단 중앙 |
| spawn_lowleft | x=230, y=556 | 저층 좌 |
| spawn_lowright | x=1370, y=556 | 저층 우 |

`spawnPoints` 배열, 서버 random 선택.

---

## 이번 범위

- `packages/shared/maps/training-arena.json` — 전면 재작성
- `apps/game/src/main.ts` — `renderHazards` 함수에 가시 스프라이트 추가

## 비목표

- 새 맵 추가 (training-arena만)
- 함정 타입 세분화 (별도 작업 예정)
- 카메라 정책 변경
- 새 무기 추가 (무기 브랜치와 분리)

---

## 건드리는 파일

| 파일 | 변경 |
|------|------|
| `packages/shared/maps/training-arena.json` | 전면 재작성 |
| `apps/game/src/main.ts` | 가시 스프라이트 렌더링 추가 |
| `docs/technical/current-implementation.md` | 업데이트 |

---

## 검증 방법

- 지상에서 1회 점프로 저층 플랫폼 도달 가능 확인
- 저층 → 중층 → 상층 순차 점프 가능 확인
- 모든 무기 스폰이 맵 전역에 분산되어 나타나는지 확인
- 가시 스프라이트가 instant_kill_hazard 위치에 렌더링되는지 확인
- `cargo test` 전체 통과 (스폰 개수 테스트 업데이트 포함)
