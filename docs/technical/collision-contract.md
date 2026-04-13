# 좌표 / 충돌 계약

## 목적

이 문서는 Battle Hamsters에서 **보이는 맵과 실제 충돌 판정이 같은 좌표 규칙**을 따르도록 하기 위한 기술 계약을 정의한다.
이 계약은 서버 판정, 클라이언트 렌더링, 향후 맵 에디터/맵 JSON 구조의 공통 기준이 된다.

## 문제 정의

현재는 다음과 같은 문제가 발생할 수 있다.

- 바닥/원웨이 플랫폼이 보이는 위치와 실제 착지 위치가 약간 다르게 느껴짐
- kill zone(낙사 구역)이 보이는 위치와 실제 낙사 판정 위치가 다를 수 있음
- 플레이어 collider와 렌더링된 사각형/스프라이트의 기준점이 다르면 박혀 보이거나 떠 보임

이 문제를 막기 위해 **좌표 기준점**과 **충돌면 정의 방식**을 문서로 고정한다.

## 핵심 원칙

1. 서버와 클라이언트는 같은 월드 좌표계를 사용한다.
2. 플레이어 좌표와 지형 좌표의 기준점을 명시적으로 구분한다.
3. 충돌면이 먼저이고, 렌더링은 충돌면을 따라야 한다.
4. 향후 맵 데이터(JSON)는 시각 레이어와 충돌 레이어를 분리한다.
5. 디버그 오버레이로 항상 확인 가능해야 한다.

## 좌표계

### 월드 단위
- 기본 단위는 **픽셀(px)** 로 둔다.
- 서버와 클라이언트는 같은 픽셀 좌표를 사용한다.

### 축 방향
- `x`는 오른쪽으로 증가
- `y`는 아래쪽으로 증가

## 플레이어 좌표 기준

### 계약
- 플레이어 `position`은 **collider 중심(center)** 기준이다.
- `velocity` 역시 center 기준 위치 변화량에 대응한다.

### 이유
- 현재 shared/server/client 구조와 가장 자연스럽게 맞는다.
- 수평/수직 속도 계산이 단순하다.
- rectangle / capsule collider 확장이 쉽다.

### 결과
- 클라이언트는 플레이어를 렌더링할 때 center 기준으로 배치해야 한다.
- 서버 충돌도 center + collider half size로 계산한다.

## 플레이어 충돌 크기

### 계약
- 플레이어 충돌 크기는 별도의 collider 규격으로 정의한다.
- 현재 구현은 rectangle collider를 전제로 한다.

예시:

```text
playerWidth = 28
playerHeight = 28
playerHalfWidth = 14
playerHalfHeight = 14
```

### 규칙
- 서버와 클라이언트는 같은 collider 크기를 참조해야 한다.
- 스프라이트 크기와 collider 크기는 같을 수도 있고 다를 수도 있지만, 다를 경우 collider가 authoritative다.

## 바닥 / 플랫폼 좌표 기준

### 계약
- 바닥과 플랫폼은 **surface top 기준**으로 정의한다.
- 즉 바닥/플랫폼의 중요한 좌표는 `topY`다.

예시:

```text
groundTopY = 540
oneWayPlatformTopY = 380
```

### 이유
- 플랫폼 게임에서 실제 판정은 윗면 착지 여부가 핵심이다.
- center 기준 rectangle보다 top 기준 surface가 충돌 계약으로 더 명확하다.

### 결과
- 서버는 `playerBottom >= platformTopY` 같은 형태로 착지를 판정한다.
- 클라이언트는 시각 도형을 그릴 때도 `topY` 기준으로 계산해야 한다.
- 시각 도형의 center가 아니라 **surface 위치가 진실**이다.

## 원웨이 플랫폼 계약

### 계약
- 원웨이 플랫폼은 **위에서 내려올 때만 착지 가능한 surface**다.
- 아래에서 위로 통과는 허용한다.
- `아래 + 점프` 입력 시 일정 시간 동안 해당 플랫폼 충돌을 무시할 수 있다.

### 현재 구현 (fix/one-way-drop-through-v1 이후)

- 플레이어가 원웨이 플랫폼 위에서 `아래 + 점프`를 누르면, **해당 플랫폼의 ID**를 `drop_through_platform_id`에 저장한다.
- 착지 판정 시 `drop_through_platform_id`와 일치하는 플랫폼만 건너뛴다. 다른 모든 원웨이 플랫폼은 즉시 정상 착지 후보다.
- 플레이어 바닥이 source 플랫폼 아래로 `DROP_CLEAR_MARGIN(8px)` 이상 내려가면 source ignore를 자동 해제한다.
- `dropThroughUntil` 타임스탬프는 클라이언트 시각 표현용으로 스냅샷에 유지되며, source ID가 해제될 때 함께 초기화된다.

### 필요한 데이터
- `id` (맵 JSON의 `one_way_platform`에 필수)
- `leftX`
- `rightX`
- `topY`

### 판정 원칙
- 이전 프레임의 player bottom이 `topY` 위에 있었고
- 현재 프레임의 player bottom이 `topY` 아래로 내려왔고
- 해당 플랫폼이 `drop_through_platform_id`와 다르면
- 착지 처리 가능

## 투사체 / 원웨이 플랫폼 계약

### 현재 v2 정책

- `floor` 와 `solid_wall` 은 투사체를 항상 막는다.
- `one_way_platform` 은 **top surface를 위에서 아래로 통과할 때만** 투사체를 막는다.
- 아래에서 위로 지나가는 투사체는 통과한다.
- 옆으로 스치는 얇은 플랫폼 edge 차단은 현재 하지 않는다. one-way는 두께가 있는 벽이 아니라 top surface로 본다.

### 이유

- 플레이어 착지 규칙과 같은 직관을 유지할 수 있다.
- 아래쪽 armory / lower route에서 위쪽 전장을 향해 쏘는 탄이 자연스럽게 통과한다.
- 향후 무기별 예외 규칙(예: 폭발탄은 플랫폼에 부딪힘, 관통탄은 통과)을 추가하더라도 기본 계약이 단순하다.

### 향후 확장 포인트

- 무기별 `collisionProfile` 또는 동등한 정책 필드
- `one_way_platform`을 위에서 맞히면 터지고, 아래에서는 통과하는 폭발탄
- 포물선 탄도에서 착탄면과 충돌 반응 세분화

## solid wall 계약

### 계약
- `solid wall`은 **세로 segment 기준**으로 정의한다.
- 좌우 이동 차단이 목적이며, floor / one-way platform과 분리된 primitive로 취급한다.

예시:

```text
pitWallLeft = { x: 330, topY: 540, bottomY: 600 }
pitWallRight = { x: 470, topY: 540, bottomY: 600 }
```

### 판정 원칙
- 플레이어 collider의 좌우 변이 wall의 `x`를 가로지르는지 확인한다.
- wall의 `topY ~ bottomY` 구간과 플레이어 collider가 겹칠 때만 충돌시킨다.
- x축 충돌 해소와 y축 착지 해소는 분리해 두는 쪽을 권장한다.

## fall zone / instant kill hazard 계약

### 계약
- `fall zone`과 `instant kill hazard`는 모두 **rect 영역 기준**으로 정의한다.
- 시각 표현도 같은 rect를 기준으로 표시한다.

예시:

```text
fallZone = { x, y, width, height }
instantKillHazard = { x, y, width, height }
```

### 권장 방향
장기적으로는 rect 기반 표현을 권장한다.
이유는:
- 맵 에디터와 연동이 쉽고
- 서버/클라이언트에서 같은 구조를 공유하기 쉽기 때문이다.

### 구분 원칙
- `fall zone`은 바닥이 없는 구간 아래쪽 낙사 영역이다.
- `instant kill hazard`는 바닥 위/옆에도 둘 수 있는 즉사 함정 영역이다.
- 둘 다 사망/리스폰 결과를 만들 수 있어도 **데이터 타입은 분리**한다.

## 렌더링 계약

### 원칙
- 클라이언트는 “예쁘게” 그리기보다 “충돌면에 맞게” 그려야 한다.
- 현재 placeholder 렌더링도 같은 규칙을 따라야 한다.

### 플레이어
- `position` center 기준 렌더
- 필요하면 collider outline 디버그 가능

### 바닥 / 플랫폼
- `topY` 기준 surface 표시
- 시각 rectangle을 그릴 때도 topY가 실제 충돌면과 어긋나지 않게 계산

### wall / fall zone / instant kill hazard
- wall은 실제 충돌 line과 같은 위치에 표시
- `fall zone`과 `instant kill hazard`는 실제 판정 rect와 같은 위치에 표시
- 디버그용 색상/라벨로 서로 구분 가능해야 함

## 디버그 오버레이 계약

다음 구현 단계에서 클라이언트는 아래 디버그 오버레이를 지원하는 것이 좋다.

- 플레이어 collider outline
- ground collision line
- one-way platform collision line
- solid wall line
- fall zone rect
- instant kill hazard rect
- spawn point marker

### 목적
- 보이는 위치와 실제 판정 위치가 같은지 즉시 확인
- collider/anchor 오차를 빠르게 잡기 위함

## 맵 데이터 authoritative source

### 장기 계약
향후에는 **맵 JSON 하나가 서버와 클라이언트의 공통 진실(source of truth)** 이 되어야 한다.

즉 같은 맵 데이터를:
- 서버는 충돌/낙사/스폰 판정에 사용
- 클라이언트는 렌더링/디버그 표시 기준에 사용

### 권장 구조
- `terrain` — 시각 배치
- `collision` — floor / one-way platform / solid wall
- `hazards` — fall zone / instant kill hazard
- `spawnPoints` — 리스폰 위치
- `weaponSpawns`
- `itemSpawns`

## 현재 구현과의 관계

현재 구현은 일부 좌표를 서버와 클라이언트 각각 하드코딩하고 있다.
이 브랜치 이후의 목표는 다음과 같다.

1. 하드코딩된 좌표를 계약 문서 기준으로 정리
2. 디버그 오버레이 추가
3. 이후 공통 맵 정의(JSON/shared 타입)로 이동

## 요약 계약

- 플레이어 `position` = **center 기준**
- 바닥/플랫폼 = **top surface 기준**
- wall = **vertical segment 기준**
- fall zone / instant kill hazard = **rect 기준**
- 서버 충돌과 클라이언트 렌더링은 **같은 맵 데이터/같은 기준점**을 사용한다
- 충돌이 먼저고, 렌더링은 충돌 계약을 따라간다
