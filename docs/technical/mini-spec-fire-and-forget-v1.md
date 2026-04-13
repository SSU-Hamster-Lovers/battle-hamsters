# 미니 스펙: 투사체 무기 연속 발사(Fire & Forget) 수정 v1

## 작업명

`fix/fire-and-forget-v1`

## 목표

투사체 무기(Seed Shotgun, Hand Cannon)를 들고 공격 버튼을 누르고 있을 때, 쿨다운이 끝나는 즉시 자동으로 다음 발사가 이루어지도록 한다. 현재는 버튼을 한 번 더 눌러야만 발사된다.

## 현상

- Seed Shotgun / Hand Cannon으로 발사 후, 공격 버튼을 계속 누르고 있어도 쿨다운 이후 자동 재발사가 되지 않는다.
- 버튼을 완전히 놓았다가 다시 눌러야 발사된다.
- 결과적으로 투사체가 날아가는 동안 다음 발사가 불가능한 것처럼 느껴진다.

## 근본 원인

서버에서 발사 여부는 `attack_queued` 플래그로 결정된다.

```rust
// ws_runtime.rs / apply_input
if input.attack_pressed {   // ← 버튼을 누른 순간(edge trigger)에만 true
    player.attack_queued = true;
}
```

`attack_pressed`는 클라이언트에서 버튼이 **처음 눌리는 프레임**에만 `true`로 보내진다.  
버튼을 계속 누르고 있는 동안은 `attack = true` (held state)만 전송되고, `attack_pressed = false`다.

따라서 쿨다운이 끝나도 `attack_queued = false`인 상태가 유지되어 발사가 일어나지 않는다.

### 왜 투사체가 살아있는 동안 발사가 안 되는 것처럼 느껴지는가?

우연의 일치다:
- Seed Shotgun: cooldown 700ms / 사거리 400px / speed 600px/s → 투사체 생존 시간 ≈667ms
- Hand Cannon: cooldown 900ms / 사거리 500px / speed 900px/s → 투사체 생존 시간 ≈556ms

쿨다운과 투사체 수명이 거의 비슷한 시간이기 때문에, 투사체가 사라질 때쯤 쿨다운도 끝나야 발사 가능한 것처럼 보인다. 서버에는 활성 투사체 수로 발사를 막는 로직이 없다.

## 이번 범위

- `tick_gameplay`에서 `handle_weapon_attack` 호출 전, `attack_was_down && cooldown 만료` 조건을 확인해 자동 재큐잉(auto-requeue) 추가
- Paws / Acorn Blaster 등 모든 무기에 동일하게 적용 (cooldown 짧으면 사실상 차이 없음)

## 건드리는 파일

| 파일 | 변경 |
|------|------|
| `server/src/room_runtime.rs` | `tick_gameplay` 내 auto-requeue 로직 추가 |

## 비목표

- 클라이언트 입력 처리 변경
- `attackIntervalMs` 밸런스 수정
- 투사체 최대 동시 개수 제한 (Fire & Forget이므로 제한 없음이 의도)

## 구현 방향

`room_runtime.rs`의 `tick_gameplay`에서:

```rust
for player_id in &player_ids {
    // ... 기존 로직 ...
    self.handle_weapon_attack(player_id, now_ms, &mut deaths, &mut dying_this_tick);
}
```

`handle_weapon_attack` 호출 전에:

```rust
if let Some(player) = self.players.get_mut(player_id) {
    if player.attack_was_down
        && !player.attack_queued
        && now_ms >= player.next_attack_at
    {
        player.attack_queued = true;
    }
}
```

이 조건은 다음을 모두 만족할 때 자동 재큐잉한다:
1. 공격 버튼을 계속 누르고 있다 (`attack_was_down = true`)
2. 아직 대기 중인 발사가 없다 (`!attack_queued`)
3. 쿨다운이 끝났다 (`now_ms >= next_attack_at`)

## 검증 방법

- Seed Shotgun 들고 공격 버튼 계속 누름 → 쿨다운 700ms마다 자동 재발사되는지 확인
- Hand Cannon 들고 같은 방식으로 확인
- Paws 근접 공격도 동일하게 자동 재발사되는지 확인 (기존 동작 유지)
- `cargo test` 전체 통과

## 참고

- 현재 `attackIntervalMs` 기준: Paws 350ms / Acorn Blaster 300ms / Seed Shotgun 700ms / Hand Cannon 900ms
- `attack_was_down`은 `apply_input`에서 이미 `input.attack` (held state) 기준으로 갱신되고 있음
