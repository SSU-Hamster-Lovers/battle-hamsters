# 미니 스펙 — 상태이상 1차 (Burn DoT)

## 작업명

상태이상 1차 — Burn DoT 단일 효과

## 목표

상태이상 시스템의 **뼈대를 최소 범위로 세우고**, `burn` 한 종을 end-to-end로 동작시킨다.

이전 `mini-spec-status-effects-v1.md`는 burn/chill/shock/poison 4종을 동시에 다뤘으나,
단계적으로 검증하기 위해 이번에는 **burn만** 구현한다.
나머지 종류는 별도 후속 스펙으로 분리한다.

---

## 이번 범위

### Shared 계약

* `StatusEffectInstance` 타입 정의 (kind를 `"burn"`으로 한정)
* `PlayerSnapshot.effects: StatusEffectInstance[]` 추가
* `DeathCause`에 상태이상 사망 케이스 추가 (`{ kind: "status"; killerId?: string; weaponId: string; effectKind: "burn" }`)

### 서버 (Rust)

* `PlayerRuntime`에 active effects 저장
* burn apply / refresh 헬퍼
* 매 tick burn DoT 처리 (500ms 간격, 피해 2)
* burn으로 사망 시 kill attribution 처리
* respawn 시 effects 초기화
* 단위 테스트: apply / expire / DoT / respawn 초기화

### 클라이언트 (Phaser 3)

* `PlayerSnapshot.effects`를 보고 burn 중이면 플레이어 위에 작은 불씨 파티클 표시
* 본체 오렌지 tint (선택)
* 원격 플레이어도 동일하게 표시

### Paws 임시 연결

* `paws.json`의 `specialEffect`를 `"kind": "burn"` 으로 임시 변경하여 테스트
* 별도 전용 burn 무기는 후속 스펙(`mini-spec-status-weapon-v1.md`)에서 추가

---

## 건드리는 스펙/문서

* `docs/technical/data-formats.md`
* `docs/technical/sync-protocol.md`
* `docs/technical/current-implementation.md`
* `packages/shared/protocol.ts`
* `packages/shared/weapons/paws.json`
* `server/src/lib.rs`
* `server/src/room_combat.rs`
* `apps/game/src/main.ts`

---

## 비목표

* chill / shock / poison
* 상태이상 저항/면역/해제 시스템
* HUD 상태이상 아이콘 (후속)
* 상태이상 전용 damageEvents
* burn 이동속도 증가 부수효과 (후속 — 양면 설계는 검증 후 결정)
* `StatusDerivedStats` 파생 능력치 파이프라인 전체 (DoT만 처리)
* `applicationChance` — 결정적이지 않아 서버 비결정성 문제를 일으키므로 제거

---

## 핵심 결정

### 1. burn은 적중 즉시 확정 적용이다

`applicationChance` 없음. 무기 적중 = burn 확정.
확률 기반 상태이상은 서버 재현성을 깬다.

### 2. 재적용은 refresh 규칙이다

이미 burn 중인 대상에 다시 적중하면 지속시간만 갱신.
스택/추가 피해 없음.

### 3. burn 이동속도 증가는 이번 단계에서 제외한다

이동속도 파생값 파이프라인(`moveSpeedRank`)이 복잡해지므로 후속 단계에서 추가.
1차에서는 DoT만 확인한다.

### 4. weaponId 명명을 현재 DeathCause와 일관되게 유지한다

기존 `DeathCause::Weapon { killer_id, weapon_id }`와 동일한 패턴으로 `weaponId` 사용.
`sourceWeaponId` 사용하지 않음.

---

## 데이터 구조

### shared (TypeScript)

```ts
// packages/shared/protocol.ts

export type StatusEffectKind = "burn"; // 이번 단계만

export type StatusEffectInstance = {
  kind: StatusEffectKind;
  killerId: string | null;   // 부여한 플레이어 ID
  weaponId: string;          // 원인 무기 ID
  expiresAt: number;         // ms 타임스탬프
  nextTickAt: number;        // 다음 DoT 처리 시각
};

// PlayerSnapshot에 추가:
// effects: StatusEffectInstance[];
```

### Rust (서버)

```rust
// server/src/lib.rs

pub struct StatusEffectInstance {
    pub kind: StatusEffectKind,
    pub killer_id: Option<String>,
    pub weapon_id: String,
    pub expires_at: u64,
    pub next_tick_at: u64,
}

pub enum StatusEffectKind {
    Burn,
}

// PlayerRuntime에 추가:
// pub active_effects: Vec<StatusEffectInstance>,
```

### burn 수치

| 항목 | 값 |
|------|-----|
| 지속시간 | 2200ms |
| DoT 간격 | 500ms |
| 틱당 피해 | 2 |
| 총 기대 피해 | 약 8 |
| 재적용 규칙 | refresh (지속시간만 갱신) |

---

## 서버 구현 흐름

```
on_hit(attacker, victim, weapon):
  if weapon.specialEffect.kind == "burn":
    apply_or_refresh_burn(victim, attacker.id, weapon.id, now)

tick_status_effects(player, now):
  player.active_effects.retain_mut(|effect| {
    if now >= effect.expires_at: return false  // 만료 제거
    if now >= effect.next_tick_at:
      apply_dot_damage(player, burn_tick_damage)
      effect.next_tick_at += BURN_TICK_INTERVAL_MS
    true
  })

on_respawn(player):
  player.active_effects.clear()
```

---

## 완료 조건

* `PlayerSnapshot.effects`가 실제 런타임 데이터가 된다
* Paws로 적중하면 burn이 적용되어 2200ms 동안 500ms마다 피해 2가 들어간다
* burn으로 사망 시 kill이 공격자에게 귀속된다
* 클라이언트에서 burn 중인 플레이어 위에 파티클이 보인다
* respawn 시 burn이 초기화된다
* 단위 테스트가 통과한다

---

## 후속 작업

이 문서 이후 우선순위:

1. `mini-spec-status-weapon-v1.md` — Stun Gun(shock), Ice Gun(chill) 전용 무기 추가
2. `mini-spec-status-effects-full-v2.md` — chill/shock/poison 추가, moveSpeedRank 파이프라인, HUD 아이콘
3. burn 이동속도 증가 부수효과 추가 (balance 검증 후)
