# 미니 스펙 초안: 무기 각도 + Dead zone v0

작업명:
무기 조준 각도 / 발사 가능 각도(Dead zone) / 오버레이 앵커 규칙 정리

목표:
마우스 에임 기반으로 캐릭터 시선과 무기 각도를 분리하고, 무기별 발사 가능 각도 제한과 자연스러운 손 위치 보정을 위한 공통 규칙을 정의한다.

이번 범위:
- 포인터 기반 에임 벡터 해석 규칙
- 이동 방향과 무관한 `facing` / backpedal 허용 규칙
- 무기별 발사 가능 각도(Dead zone) 모델 초안
- 상향/하향 조준 시 오버레이 앵커 이동 규칙
- 현재 `Paws`, `Acorn Blaster`, 미래 박격포류를 수용하는 데이터 구조 초안

건드리는 스펙/문서:
- `docs/game-design/weapon-design.md`
- `docs/technical/data-formats.md`
- `docs/technical/current-implementation.md`

비목표:
- 서버 판정 단계의 실제 angle clamp 구현
- 마우스 커서 기반 조준선 UI
- 박격포/레이저 신규 무기 추가
- 캐릭터 상반신/팔 본 애니메이션

검증 방법:
- 플레이 테스트로 상/하/좌/우 및 대각선 조준 가독성 확인
- backpedal 중 무기 방향과 발사 방향이 일치하는지 점검
- 무기별 Dead zone에서 입력 차단/보정이 예측 가능하게 느껴지는지 확인

## 1. 플레이어 목표와 컨텍스트

- 플레이어는 이동 방향과 별개로 마우스 포인터를 따라 조준할 수 있어야 한다.
- 이동 중에도 에임이 유지되어야 하며, 뒤로 걸으면서 쏘는(backpedal) 상황도 자연스러워야 한다.
- 무기마다 허용 각도가 달라질 수 있지만, "왜 지금 발사가 안 되는지"는 예측 가능해야 한다.

## 2. 조준 / 시선 / 발사 규칙

### 입력 벡터

- 클라이언트는 현재처럼 `aim: Vector2` 를 서버에 보낸다.
- `aim` 은 플레이어 중심에서 포인터 방향으로 정규화한 벡터다.

### 시선(`facing`) 규칙

- 이동 입력이 아니라 `aim.x` 를 우선 기준으로 시선을 정한다.
- `abs(aim.x) >= 0.12` 이면:
  - `aim.x < 0` → `left`
  - `aim.x > 0` → `right`
- `abs(aim.x) < 0.12` 이면 이전 시선을 유지한다.
- 즉, 거의 수직 조준일 때 좌우 시선이 떨리지 않게 한다.

### backpedal 허용

- 발사 방향은 항상 `aim` 기준이다.
- 이동 방향은 발사 방향을 덮어쓰지 않는다.
- 따라서 `move.x > 0` 이면서 `aim.x < 0` 인 뒤걸음 사격을 허용한다.

## 3. 무기 Dead zone 모델 초안

### 설계 원칙

- Dead zone은 "최소 피해 거리"가 아니라 **발사 가능한 각도 영역 제한**으로 정의한다.
- 입력을 무조건 막는 것보다, 먼저 **허용 각도로 clamp** 하고 필요 시만 발사 실패 처리한다.

### 제안 데이터 구조

`WeaponDefinition` 확장 후보:

```ts
type WeaponAimProfile = {
  mode: "free" | "horizontal_only" | "vertical_only";
  minAimDeg: number;
  maxAimDeg: number;
  deadZoneBehavior: "clamp" | "block";
};
```

- 각도는 캐릭터가 바라보는 방향을 기준으로 한 local angle 이다.
- `0deg` 는 정면 수평, `-90deg` 는 위, `+90deg` 는 아래로 본다.
- `left` 를 바라볼 때는 내부적으로 좌우를 반전한 local angle 로 해석한다.

### 기본 프로필 예시

- `Acorn Blaster`
  - `mode: "free"`
  - `minAimDeg: -55`
  - `maxAimDeg: 40`
  - `deadZoneBehavior: "clamp"`
- `Paws`
  - `mode: "horizontal_only"`
  - `minAimDeg: -30`
  - `maxAimDeg: 30`
  - `deadZoneBehavior: "clamp"`
- 미래 박격포류
  - `mode: "vertical_only"`
  - `minAimDeg: -115`
  - `maxAimDeg: -55`
  - `deadZoneBehavior: "block"` 또는 `clamp`

## 4. 오버레이 각도와 앵커 이동 규칙

### 무기 각도

- 시각 오버레이 각도는 clamp 된 `aim` 각도를 그대로 쓴다.
- 좌우 반전만 하는 현재 방식은 1차 구현으로 유지하되, 다음 단계에서 `rotation` 기반으로 교체한다.

### 앵커 이동

- 상향 조준:
  - 무기 시작점이 머리/상체 쪽으로 약간 올라간다.
  - 총열은 몸통 앞보다 위쪽에서 시작한다.
- 하향 조준:
  - 무기 시작점이 복부/다리 쪽으로 내려간다.
  - 총열은 몸통 아래쪽에서 시작한다.
- 수평 조준:
  - 현재 손 앞 offset 과 비슷한 위치를 기준으로 한다.

### 제안 보간 값

- `aim.y = -1` 일 때 `anchorY = baseY - 8`
- `aim.y = 0` 일 때 `anchorY = baseY`
- `aim.y = +1` 일 때 `anchorY = baseY + 8`
- `anchorX` 는 수직 조준일수록 2~4px 안쪽으로 살짝 당겨 과도한 공중부양처럼 보이지 않게 한다.

## 5. 단계별 구현 순서

1. 클라이언트 표현 1차
   - 오버레이 `rotation`
   - `aim` 기준 시선 고정
   - `anchorY` 보간
2. 무기별 visual clamp
   - 허용 각도를 넘어가면 표현 각도만 clamp
3. 서버 판정 clamp
   - `player_input.aim` 을 무기 프로필 기준으로 재해석
4. 발사 실패 피드백
   - `block` 타입 무기는 클릭 시 작은 경고 flash 또는 dry-fire 연출

## 6. 리스크

- 시선과 이동을 분리하면 기존 "달리는 방향 = 보는 방향" 감각과 달라져 초반 적응 비용이 생길 수 있다.
- 박격포류처럼 수직 전용 무기는 시선/발사 clamp 가 불명확하면 답답하게 느껴질 수 있다.
- 서버가 clamp 하지 않고 클라이언트만 회전시키면 화면과 실제 판정이 어긋날 수 있다.

## 7. 플레이 테스트 포인트

- 수직에 가깝게 조준할 때 좌우 시선이 흔들리지 않는가
- 뒤로 걸으면서 쏠 때 캐릭터/무기/탄 방향이 모두 일치하는가
- `Paws` 와 `Acorn Blaster` 의 허용 각도 차이가 직관적인가
- 위를 볼수록 무기가 머리 쪽, 아래를 볼수록 다리 쪽으로 자연스럽게 이동하는가
