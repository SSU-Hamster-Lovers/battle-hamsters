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

### 필요한 데이터
- `leftX`
- `rightX`
- `topY`
- `dropThroughUntil` 또는 동등한 상태

### 판정 원칙
- 이전 프레임의 player bottom이 `topY` 위에 있었고
- 현재 프레임의 player bottom이 `topY` 아래로 내려왔고
- `dropThrough` 상태가 아니면
- 착지 처리 가능

## kill zone / hazard 계약

### 계약
- kill zone은 **rect 영역 기준**으로 정의한다.
- 시각 표현도 같은 rect를 기준으로 표시한다.

예시:

```text
killZone = { x, y, width, height }
```

또는

```text
pitLeftX, pitRightX, killZoneY
```

### 권장 방향
장기적으로는 rect 기반 표현을 권장한다.
이유는:
- 맵 에디터와 연동이 쉽고
- 서버/클라이언트에서 같은 구조를 공유하기 쉽기 때문이다.

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

### kill zone
- 실제 낙사 판정 영역과 같은 위치에 표시
- 디버그용 색상으로 명확히 구분 가능해야 함

## 디버그 오버레이 계약

다음 구현 단계에서 클라이언트는 아래 디버그 오버레이를 지원하는 것이 좋다.

- 플레이어 collider outline
- ground collision line
- one-way platform collision line
- kill zone rect
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
- `collision` — 실제 바닥/벽
- `oneWayPlatforms` — 원웨이 플랫폼
- `hazards` — 낙사/즉사 영역
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
- kill zone = **rect 기준**
- 서버 충돌과 클라이언트 렌더링은 **같은 맵 데이터/같은 기준점**을 사용한다
- 충돌이 먼저고, 렌더링은 충돌 계약을 따라간다
