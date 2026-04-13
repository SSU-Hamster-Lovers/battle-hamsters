# 미니 스펙: 무기 에임 각도 + Facing 1차 v1

작업명:
무기 오버레이 rotation + 에임 기반 캐릭터 facing 방향 1차 구현

목표:
마우스 에임 방향으로 무기 오버레이가 실시간 회전하도록 하고, 이동 방향이 아닌 에임 방향을 캐릭터 시선의 1차 기준으로 삼아 backpedal 사격이 자연스럽게 동작하게 만든다.

이번 범위:

**서버 (Rust)**
- `room_runtime.rs` `step_player()`: direction 결정 기준을 이동 우선 → 에임 우선(deadzone 0.12)으로 변경
  - `abs(aim.x) >= 0.12` → aim.x 부호로 Left/Right 결정
  - `abs(aim.x) < 0.12` → 이전 방향 유지 (수직 조준 시 시선 떨림 방지)

**클라이언트 (TypeScript / Phaser 3)**
- `private latestAim` 필드 추가: 마지막으로 계산한 에임 단위벡터를 보관
- `sendLatestInput()`: aim 계산 후 `this.latestAim` 갱신
- `updateWeaponOverlay()`: aim 파라미터 추가
  - 오버레이 **rotation**: `aim` 벡터를 기반으로 `setRotation()` 적용
  - **anchorY 보간**: `aim.y * 8` px 범위로 총구 위치 상하 이동
  - **anchorX pull**: 수직 조준 시 `abs(aim.y) * 3` px만큼 몸통 쪽으로 당김 (공중부양 방지)
- 로컬 플레이어 → `this.latestAim` 전달, 원격 플레이어 → direction 기반 fallback

건드리는 파일:
- `server/src/room_runtime.rs`
- `apps/game/src/main.ts`
- `docs/technical/current-implementation.md`

비목표:
- 서버 판정 단계의 angle clamp (v0 spec §5 Step 3)
- 발사 불가 구간(Dead zone) 실제 block 처리 (v0 spec §5 Step 4)
- `WeaponAimProfile` 타입 정의 및 무기별 허용 각도 데이터 추가
- 박격포 / beam 등 신규 무기
- 마우스 커서 커스텀 / 조준선 UI

검증 방법:
- `cd server && cargo test` (기존 39개 + 서버 방향 관련 테스트)
- `corepack pnpm --dir apps/game typecheck`
- `corepack pnpm --dir apps/game build`
- 실제 플레이: 마우스 상하 조준 시 총구가 따라 움직이는지, backpedal 사격(이동 방향과 반대로 조준) 시 무기 방향이 일치하는지 확인

---

## 1. 서버 facing 로직 변경

`server/src/room_runtime.rs` `step_player()`, 기존 코드:

```rust
if move_x < 0.0 {
    player.snapshot.direction = Direction::Left;
} else if move_x > 0.0 {
    player.snapshot.direction = Direction::Right;
} else if input.aim.x < 0.0 {
    player.snapshot.direction = Direction::Left;
} else if input.aim.x > 0.0 {
    player.snapshot.direction = Direction::Right;
}
```

변경 후:

```rust
if input.aim.x.abs() >= 0.12 {
    player.snapshot.direction = if input.aim.x < 0.0 {
        Direction::Left
    } else {
        Direction::Right
    };
}
// abs(aim.x) < 0.12 → 이전 방향 유지 (수직 조준 deadzone)
```

**의도**: 이동 방향이 아니라 에임 방향이 캐릭터 시선을 결정한다.
- backpedal(오른쪽 이동 + 왼쪽 조준) 시 캐릭터는 왼쪽을 바라보며 오른쪽으로 움직인다.
- 수직 조준(abs(aim.x) < 0.12)일 때는 직전 방향 유지로 떨림을 방지한다.

---

## 2. 클라이언트 오버레이 rotation 수식

무기 텍스처 기준: `acorn_blaster` 텍스처는 총구가 +X 방향(오른쪽)을 향해 그려져 있다.

Phaser 3 transform 순서: position → rotation → scale(flipX)

| direction | setFlipX | setRotation 수식 | 설명 |
|-----------|----------|-----------------|------|
| `right`   | false    | `atan2(aim.y, aim.x)` | 총구 방향 = aim 벡터 |
| `left`    | true     | `atan2(aim.y, -aim.x)` | flipX로 텍스처 반전 후 rotation 적용 |

**검증 예시 (left-facing)**:
- aim = (-1, 0): `atan2(0, 1) = 0°` → rotation 0 → flipX 후 총구 왼쪽 ✓
- aim = (-0.7, -0.7): `atan2(-0.7, 0.7) = -45°` → flipX + rotation -45° → 총구 상좌 ✓
- aim = (-0.7, +0.7): `atan2(0.7, 0.7) = 45°` → flipX + rotation 45° → 총구 하좌 ✓

---

## 3. anchorY/X 보간 수치

| 파라미터 | 수식 | 범위 |
|---------|------|------|
| `anchorYOffset` | `aim.y * 8` | -8px (위 조준) ~ +8px (아래 조준) |
| `anchorXPull` | `abs(aim.y) * 3` | 0 ~ 3px (몸통 방향으로 당김) |

- `aim.y ∈ [-1, 1]` → 총 수직 이동 범위 16px
- 수직 조준일수록 총이 몸통 쪽으로 약간 당겨져 공중부양처럼 보이지 않게 한다.

---

## 4. 원격 플레이어 fallback

원격 플레이어는 클라이언트에서 aim을 알 수 없으므로 direction 기반 수평 fallback을 사용한다.

```typescript
const fallbackAim = snapshot.direction === "left"
  ? { x: -1, y: 0 }
  : { x: 1, y: 0 };
```

- 원격 플레이어 무기 오버레이는 수평만 flip되고 rotation은 0으로 유지된다.
- 추후 `player_input` aim 을 스냅샷에 포함시키면 원격 플레이어도 실제 에임 각도 표현 가능.
