# 미니 스펙 — 킬 어사인먼트 1차 (복합 사망 원인 판정)

## 작업명

킬 어사인먼트 1차

## 목표

넉백으로 인해 낙사 또는 즉사 함정으로 죽은 경우에도
마지막으로 피해를 입힌 플레이어의 킬로 귀속한다.

현재: `Player B → 낙사`
개선: `Player A → Acorn Blaster → Player B`

## 이번 범위

- `PlayerRuntime` 에 `last_hit_by: Option<LastHitInfo>` 필드 추가
- 무기 피격 시 `last_hit_by` 갱신 (killer_id, weapon_id, hit_at_ms)
- 낙사/함정 사망 판정 시:
  - `last_hit_by` 가 **기여 시간(TTL, 기본 5초)** 이내 → `DeathCause::Weapon { killer_id, weapon_id }`
  - 그 외 (시간 초과 또는 last_hit 없음) → 기존 `FallZone` / `InstantKillHazard` 그대로
- 사망(리스폰) 후 `last_hit_by` 초기화
- `dying_this_tick` 가드와 통합 — 이미 먼저 kills 로 판정된 cause 를 덮어쓰지 않는다

## 건드리는 스펙/문서

- `docs/technical/sync-protocol.md` (DeathCause 는 이미 갱신됨)
- `docs/technical/current-implementation.md`
- `server/src/room_combat.rs`, `server/src/main.rs` (`PlayerRuntime`)

## 비목표

- 복수 타격 이력 추적 (가장 최근 1개만)
- 연속 데미지(beam 등) 에 의한 누적 기여도
- 자살 판정 (반동으로 자기 낙사) — 별도 후속 작업
- 처치 어시스트 (assist)

## 핵심 결정

### A. 기여 TTL 은 5초

- 마지막 피해 시각 기준으로 5초 이내면 "킬 기여" 로 본다.
- 직관적인 기준: 쏘고 5초 안에 상대가 낙사하면 내 킬.
- 5초가 지나면 상대가 스스로 위험 지역에 들어간 것으로 본다.

### B. 서버 `PlayerRuntime` 에 `last_hit_by` 를 1개 보관

```rust
struct LastHitInfo {
    killer_id: String,
    weapon_id: String,
    hit_at_ms: u64,
}

struct PlayerRuntime {
    // ...기존 필드...
    last_hit_by: Option<LastHitInfo>,
}
```

### C. 판정 우선순위

동일 tick 안에서:
1. 피해량이 0 이 되어 즉사 (hp == 0 by weapon) → 기존 Weapon 판정
2. 피해 없이 hazard 진입 → last_hit_by TTL 체크 후 Weapon 또는 FallZone/InstantKillHazard

### D. 서버 reset_general_combat_state 에서 last_hit_by 도 초기화

리스폰 시 초기화되지 않으면 이전 매치의 last_hit_by 가 남아있을 수 있다.

## 완료 조건

- Player A 가 B 를 총으로 맞히고 B 가 5초 이내 낙사하면 킬피드에 `A → 무기 → B` 표시
- Player A 가 B 를 맞혔지만 5초 이상 지난 뒤 낙사하면 `B → 낙사` 표시
- 즉사 함정도 동일하게 적용
- 기존 hp == 0 에 의한 즉사 킬 귀속은 변화 없음
- 단위 테스트: `last_hit_by` TTL 이내 낙사 → Weapon cause, 초과 낙사 → FallZone cause

## 검증 방법

- 직접 플레이: 상대 쏘고 구멍 쪽으로 날려보내 낙사시키기
- 쏘고 5초 대기 후 상대 구멍 낙사 → `낙사` 로 표시되는지 확인
- `cargo test` 새 단위 테스트 통과

## 참고

- 현재 `DeathCause` 타입은 `docs/technical/sync-protocol.md` 및 `packages/shared/world.ts` 에 정의됨
- `dying_this_tick: HashSet<String>` 가드 (`feature/hazard-feedback-v1` PR #31) 가 이미 같은 tick 중복 push 를 차단하므로, last_hit_by 판정은 그 이전 단계에서 적용하면 된다.
