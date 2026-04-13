
# 미니 스펙 — 상태이상 시스템 1차 v1

## 작업명

상태이상 시스템 1차 v1

## 목표

향후 `Stun Gun`, `Ice Gun`, 화상/독 계열 무기를 수용하기 위해, 서버 authoritative 기반의 **짧고 읽기 쉬운 상태이상 시스템**을 도입한다.

이 단계의 상태이상은 전투를 멈추는 하드 CC 시스템이 아니라,
**이동 / 점프 / 조준 / 회복 / 낙사 위험**을 흔드는 보조 전투 축으로 설계한다.

초기 구현에서는 복잡한 속성 상성, 영구 상태이상, 긴 군중 제어를 배제하고,
짧은 지속시간과 예측 가능한 해제 규칙을 우선한다.

현재 데이터 포맷에는 향후 확장용 `effects` 자리가 이미 존재하지만, MVP에서는 비워 둔 상태다. 이번 작업은 이 필드를 실제 의미를 가진 런타임 계약으로 승격하는 단계다. 
또한 기존 게임 설계는 MVP에서 빙결/기절/화상/중독 같은 복잡한 상태이상을 미지원으로 두고 있으므로, 이번 스펙은 그 범위를 명시적으로 확장하는 첫 문서다. 

---

## 이번 범위

### 서버 (Rust)

* 플레이어에게 상태이상 인스턴스를 적용/갱신/만료하는 공용 시스템 추가
* 서버 tick에서 상태이상 지속시간 처리
* 상태이상에 따른 파생 능력치 계산
* 지속 피해(DoT) 처리
* 짧은 입력 제한(`micro_stun`) 처리
* `room_snapshot` / `world_snapshot` 에 상태이상 정보 반영
* 상태이상 관련 단위 테스트 추가

### shared 계약

* `PlayerSnapshot.effects`를 실제 사용 필드로 확정
* `StatusEffectInstance` 구조 정의
* 무기/투사체/기타 효과가 상태이상을 부여할 수 있도록 확장 후보 정의

### 클라이언트 (TypeScript / Phaser 3)

* 상태이상 아이콘 / tint / 간단한 파티클 등 최소 표현 규칙 추가
* 로컬/원격 플레이어에 대한 상태이상 시각 식별 가능하게 처리
* HUD 또는 오버레이에서 현재 걸린 상태이상 최소 표시

### 첫 지원 상태이상

* `burn`
* `chill`
* `shock`
* `poison`

---

## 건드리는 스펙/문서

* `docs/technical/data-formats.md`
* `docs/technical/sync-protocol.md`
* `docs/technical/current-implementation.md`
* 필요 시 `docs/game-design/weapon-design.md`
* 후속 연동 문서:

  * `docs/technical/mini-spec-combat-presentation-polish-v0.md`
  * `docs/technical/mini-spec-impact-feedback-v1.md`

현재 구현 기준으로는 `Acorn Blaster`, `Paws` 두 무기만 서버 판정이 있으며, beam / grab / throwable / 상태이상 무기는 아직 미구현이다. 따라서 이 문서는 신규 무기보다 먼저 **공용 기반 시스템**을 여는 역할을 한다. 

---

## 비목표

* 영구 상태이상
* 1초 이상 지속되는 hard stun / freeze / stone lock
* 속성 상성 시스템
* 저항력/면역/해제 스킬 시스템
* cleanse 아이템
* 상태이상 전용 음향 시스템 완성
* 화면 전체 셰이크/왜곡 연출
* beam / chain lightning / 고급 전이 규칙 완성
* 상태이상별 전용 atlas 최종 확정

---

## 핵심 결정

### 1. 상태이상은 “전투 정지”보다 “위치 붕괴” 중심이다

이 게임은 빠른 이동, 낙사 압박, 무기 순환이 핵심이므로, 상태이상은 롤식 긴 CC보다
**이동/점프/에임/회복 리듬을 망가뜨리는 짧은 디버프** 쪽이 어울린다.
즉, 상태이상이 킬을 직접 만들기보다, **낙사 / 후속 타격 / 실수 유도**를 돕는 구조를 우선한다.

### 2. hard CC는 최소화한다

* `shock` 계열만 짧은 `micro_stun` 허용
* 1초 이상 조작 불가 상태는 금지
* 완전 빙결(`freeze`) / 석화(`petrify`)는 이번 범위에서 제외

### 3. 상태이상은 모두 비영구적이다

* 대부분 `1.0s ~ 3.0s`
* DoT 계열도 짧게 끝난다
* 재적용 시 기본은 `refresh` 규칙을 따른다

### 4. 일부 상태이상은 디메리트와 메리트를 동시에 가질 수 있다

단순 디버프만 있으면 전투가 무거워진다.
따라서 일부 상태이상은 위험하지만 재미있는 양면성을 가진다.

대표 예시:

* `burn`: 지속 피해를 주지만 이동 속도가 잠깐 올라간다
* `chill`: 느려지지만 공중에서 덜 튀게 보정 가능
* `heavy` 같은 후속 상태는 넉백 저항이 올라가지만 기동력이 감소하는 식으로 설계 가능

이번 1차 범위에서는 **burn**에 이 양면성을 적용한다.

### 5. 상태이상은 공용 구조 하나로 관리한다

무기마다 별도 하드코딩하지 않고,
플레이어가 가진 `effects[]` 인스턴스를 기준으로 최종 파생값을 계산한다.

즉:

* 무기는 “효과를 부여”
* 플레이어 상태 시스템은 “효과를 유지/만료/합산”
* 이동/전투 시스템은 “최종 파생값을 사용”

---

## 설계 원칙

### 원칙 A — 예측 가능성

상태이상은 걸렸을 때 플레이어가 즉시 이해해야 한다.

* 왜 느려졌는지
* 왜 점프가 낮아졌는지
* 왜 에임이 흔들리는지
* 왜 HP가 줄고 있는지

### 원칙 B — 짧은 지속

난전 게임에서 긴 디버프는 재미보다 억울함을 만든다.
기본 지속은 짧게, 재적용 빈도는 무기 자원과 사거리로 제어한다.

### 원칙 C — 시각적 가독성

최소한 아래 둘 중 하나는 반드시 제공한다.

* 캐릭터 본체 tint
* 상태 아이콘

가능하면 여기에 간단한 파티클을 추가한다.

### 원칙 D — 서버 authoritative

상태이상 적용, 갱신, 만료, DoT, 입력 제한은 모두 서버 기준이다.
클라이언트는 표현과 보간만 담당한다.

---

## 1차 지원 상태이상 목록

## 1. `burn`

### 의도

불타는 동안 HP가 서서히 줄지만, 당황해서 더 빨리 뛰는 느낌을 준다.
즉 **위험하지만 순간 기동력은 오르는 양면 상태이상**이다.

### 효과

* 지속 피해
* `moveSpeedRank +1`
* 선택적으로 `+2`까지 열어둘 수 있으나 초기값은 `+1`

### 기본 수치 초안

* 지속시간: `2200ms`
* 틱 간격: `500ms`
* 틱당 피해: `2`
* 총 기대 피해: 약 `8 ~ 10`

### 주의

* 이동속도 상승이 있으므로, 단순 약화 상태가 아니다
* 도주/추격 양쪽에 모두 쓰일 수 있다

---

## 2. `chill`

### 의도

완전 빙결이 아니라, **몸이 굳어서 이동/점프/공중 제어가 둔해지는 상태**다.
낙사 맵에서 위협적이어야 하지만, 맞는 즉시 게임이 멈춰선 안 된다.

### 효과

* `moveSpeedRank -1`
* 점프 힘 감소
* 공중 제어 약화

### 기본 수치 초안

* 지속시간: `1800ms`
* 점프 힘 배수: `0.88`
* 공중 제어 배수: `0.85`

### 주의

* freeze는 미지원
* 점프 수 자체를 깎지 않고, 점프 품질을 떨어뜨리는 방향이 안전하다

---

## 3. `shock`

### 의도

긴 기절이 아니라, **짧은 리듬 붕괴 + 조준 방해** 상태다.
즉, 순간적으로 컨트롤을 무너뜨리는 전기 충격에 가깝다.

### 효과

* `micro_stun`
* 짧은 에임 흔들림
* 선택적으로 아주 약한 이동 감속

### 기본 수치 초안

* 지속시간: `900ms`
* `micro_stun`: 시작 시 `220ms`
* 에임 jitter: `±5deg`
* 추가 감속은 초기 버전에서 생략 가능

### 주의

* 1초 이상 행동 불가 금지
* 연속 감전 무기로 lock을 만들지 않도록 재적용 규칙이 중요하다

---

## 4. `poison`

### 의도

즉시 전투 제압이 아니라, **회복 방해 + 누적 부담**을 주는 상태다.
burn보다 느리고 음침한 압박 역할이다.

### 효과

* 약한 지속 피해
* 회복량 감소
* 후속 상태이상 지속시간을 소폭 늘리는 확장 가능성

### 기본 수치 초안

* 지속시간: `3000ms`
* 틱 간격: `600ms`
* 틱당 피해: `1`
* heal multiplier: `0.5`

### 주의

* heal reduction은 현재 회복 아이템이 적기 때문에 영향이 제한적일 수 있다
* 후속 확장 전에는 “약한 DoT + 회복 방해”만으로도 충분하다

---

## 제외 상태이상

이번 범위에서 아래는 제외한다.

* `freeze`
* `petrify`
* `airborne`
* `knockup`
* `fear`
* `silence`
* `root`
* `blind`
* `disarm`

이유:

* 2D 사이드뷰 낙사형 난전과 잘 안 맞거나
* 기존 이동/조준 구조와 충돌하거나
* 억울함이 너무 크거나
* 무기 고유성보다 상태이상 자체가 게임을 지배할 위험이 큼

---

## 상태이상 데이터 구조

현재 문서에는 `effects` 확장 방향만 간단히 남겨져 있다. 이번 단계에서는 이를 아래 구조로 구체화한다. 

```ts
type StatusEffectKind =
  | "burn"
  | "chill"
  | "shock"
  | "poison";

type StatusStackBehavior =
  | "refresh"
  | "max_only"
  | "stack_duration"
  | "stack_magnitude";

type StatusEffectInstance = {
  id: string;
  kind: StatusEffectKind;
  sourcePlayerId?: string | null;
  sourceWeaponId?: string | null;
  startedAt: number;
  expiresAt: number;
  stacks: number;
  magnitude?: number | null;
  stackBehavior: StatusStackBehavior;
  nextTickAt?: number | null;
};
```

### 필드 설명

| 필드               | 설명            |
| ---------------- | ------------- |
| `id`             | 서버 발급 인스턴스 ID |
| `kind`           | 상태이상 종류       |
| `sourcePlayerId` | 부여자           |
| `sourceWeaponId` | 원인 무기         |
| `startedAt`      | 시작 시각         |
| `expiresAt`      | 종료 시각         |
| `stacks`         | 중첩 수          |
| `magnitude`      | 강도 보정값        |
| `stackBehavior`  | 재적용 규칙        |
| `nextTickAt`     | DoT용 다음 처리 시각 |

---

## PlayerSnapshot 확장안

현재 `PlayerSnapshot`에는 `effects` 필드가 없다기보다, 상태 포맷 예시에서 향후 확장 자리가 열려 있는 상태다. 1차 구현에서는 스냅샷에 실제로 노출한다.  

```ts
type PlayerSnapshot = {
  id: string;
  name: string;
  position: Vector2;
  velocity: Vector2;
  direction: "left" | "right";
  hp: number;
  lives: number;
  moveSpeedRank: number;
  maxJumpCount: number;
  jumpCountUsed: number;
  grounded: boolean;
  dropThroughUntil: number | null;
  respawnAt: number | null;
  equippedWeaponId: string;
  equippedWeaponResource: number | null;
  grabState: GrabState | null;
  lastDeathCause: DeathCause | null;
  kills: number;
  deaths: number;
  state: "alive" | "respawning" | "eliminated";

  effects: StatusEffectInstance[];
};
```

### 스냅샷 원칙

* 클라이언트는 `effects[]`를 보고 표현만 한다
* 실제 판정은 서버가 한다
* 디버그 HUD나 운영자 오버레이에서 남은 시간 표시가 가능해야 한다

---

## 파생 능력치 모델

상태이상 자체가 곧 이동/전투 코드를 오염시키면 유지보수가 어려워진다.
따라서 매 tick 또는 필요 시점마다 `StatusDerivedStats`를 계산해 사용한다.

```ts
type StatusDerivedStats = {
  moveSpeedRankDelta: number;
  jumpPowerMultiplier: number;
  airControlMultiplier: number;
  healMultiplier: number;
  aimJitterDeg: number;
  inputLockedUntil: number | null;
};
```

### 기본값

```ts
{
  moveSpeedRankDelta: 0,
  jumpPowerMultiplier: 1.0,
  airControlMultiplier: 1.0,
  healMultiplier: 1.0,
  aimJitterDeg: 0,
  inputLockedUntil: null
}
```

### 상태별 파생 규칙

#### burn

* `moveSpeedRankDelta += 1`

#### chill

* `moveSpeedRankDelta -= 1`
* `jumpPowerMultiplier *= 0.88`
* `airControlMultiplier *= 0.85`

#### shock

* `aimJitterDeg = max(aimJitterDeg, 5)`
* 시작 시 `inputLockedUntil = now + 220ms`

#### poison

* `healMultiplier *= 0.5`

---

## 지속 피해(DoT) 규칙

### 공통 원칙

* DoT는 서버 tick에서만 적용
* 클라이언트는 HP 감소와 `damageEvents` 또는 후속 상태이상 전용 이벤트를 보고 표현
* DoT 사망도 정상 킬 귀속 또는 self/environment와 구분되어야 한다

### burn

* 500ms마다 피해 2

### poison

* 600ms마다 피해 1

### 킬 귀속

* `sourcePlayerId`가 있으면 해당 플레이어에게 킬 귀속
* source가 없거나 만료 후 환경사와 섞이면 기존 death cause 규칙과 충돌하지 않게 별도 처리 필요

초기 기준 제안:

```ts
DeathCause =
  | { kind: "fall_zone" }
  | { kind: "instant_kill_hazard" }
  | { kind: "weapon"; killerId: string; weaponId: string }
  | { kind: "self"; weaponId?: string }
  | { kind: "status"; killerId?: string; effectKind: StatusEffectKind; sourceWeaponId?: string };
```

---

## 재적용 / 중첩 규칙

이 항목을 먼저 고정하지 않으면 밸런스와 버그가 같이 터진다.

## 공통 기본값

* 같은 종류 상태이상 재적용 시 기본은 `refresh`
* 다른 종류 상태이상은 동시 존재 가능
* 같은 무기 연속 적중으로 hard lock이 생기지 않게 clamp 필요

### burn

* `refresh`
* 중첩 없음
* 이미 burn 중이면 지속시간만 갱신

### chill

* `refresh`
* magnitude를 나중에 둘 수 있지만 1차는 단일 강도

### shock

* `max_only`
* 이미 shock 중이면 더 긴 shock만 남김
* `micro_stun`은 재적용해도 즉시 220ms씩 계속 연장되지 않도록 보호 필요

권장:

* 동일 대상은 `shock`으로 인한 입력 잠금 재발동에 `600ms` 내부 쿨다운 부여

### poison

* `refresh`
* 추후 누적형으로 바꿀 수 있으나 1차는 단순 유지

---

## 해제 규칙

### 기본 해제

* `expiresAt <= now`면 제거

### respawn 시

* 모든 상태이상 제거

### death 시

* 사망 즉시 제거
* 단, kill/death feed용 원인 정보는 별도 보존 가능

### cleanse 없음

* 이번 범위에는 해제 스킬/아이템 없음

---

## 입력 제한 규칙

`shock`의 `micro_stun`만 1차에서 입력을 직접 제한한다.

### 차단 대상

* 이동 입력
* 점프 입력
* 공격 입력

### 차단하지 않는 것

* 시선 방향 전환 데이터 자체는 받아도 무방
* 다만 최종 발사/행동은 무시

### 이유

* 조준선이 살아 있는 편이 “완전 얼어붙음”보다 덜 답답하다
* 짧은 전기 쇼크로 몸이 움찔하는 느낌과도 더 맞다

---

## 회복 아이템과의 상호작용

현재 `health_pack_small`이 존재하므로 poison은 회복 방해와 연결할 수 있다. 현재 아이템 체계는 회복과 점프 증가가 구현되어 있다.  

### 규칙

* poison 중 회복 적용 시 `healMultiplier` 반영
* burn / chill / shock는 회복량에 직접 영향 없음

---

## 무기 연동용 데이터 구조 후보

초기 구현은 무기 하드코딩으로 시작해도 되지만, 상태이상 무기를 추가하려면 곧 데이터화가 필요하다.
따라서 아래 구조를 `WeaponDefinition` 후속 확장 후보로 둔다.

```ts
type WeaponAppliedEffect = {
  kind: "burn" | "chill" | "shock" | "poison";
  durationMs: number;
  magnitude?: number;
  applicationChance: number;
  stackBehavior?: "refresh" | "max_only" | "stack_duration" | "stack_magnitude";
};

type WeaponDefinition = {
  // 기존 필드 유지
  ...
  onHitEffects?: WeaponAppliedEffect[];
};
```

### 1차 적용 대상 무기

이번 문서에서는 실제 상태이상 무기 구현을 하지 않더라도, 아래 확장을 염두에 둔다.

* `stun_gun` → `shock`
* `ice_gun` → `chill`
* `flame_sprayer` 또는 후속 화상 무기 → `burn`
* `toxic_launcher` 또는 후속 독 무기 → `poison`

---

## 클라이언트 표현 규칙

기존 무기/피격/사망 표현 문서와 마찬가지로, 상태이상 표현도 판정과 분리된 presentation layer로 둔다. 무기 표현 문서도 pickup / equip / fire를 presentation layer로 분리하자고 제안하고 있으며, 피격 표현 문서 역시 정확 이벤트와 fallback 시각효과를 나눠 다룬다. 같은 철학을 상태이상에도 적용한다.  

### 최소 표현 규칙

각 상태이상은 아래 셋 중 최소 둘 이상 제공한다.

* 본체 tint
* 머리 위 작은 아이콘
* 약한 파티클

### 상태별 제안

#### burn

* 주황/적색 tint
* 작은 불씨 파티클
* 아이콘: flame

#### chill

* 푸른 tint
* 약한 서리 입자
* 아이콘: snowflake

#### shock

* 노란/청백 tint
* 짧은 번쩍임
* 아이콘: lightning

#### poison

* 녹색 tint
* 작은 독기 방울
* 아이콘: drop/skull

### HUD

* 로컬 플레이어 카드 근처에 상태 아이콘 최대 3개 표시
* 남은 시간이 매우 짧으면 점멸 가능
* 디버그 모드에서는 남은 ms 텍스트 허용

---

## 상태이상 이벤트와 damageEvents 관계

현재 피격 표현은 `damageEvents`를 우선 사용하고, 없을 때 HP 감소 fallback을 사용한다. 상태이상도 이와 유사하게 설계할 수 있다.  

### 1차 제안

상태이상 전용 이벤트를 당장 추가하지 않아도 된다.
우선은 스냅샷의 `effects[]` 변화를 보고 표현한다.

### 후속 후보

```ts
type StatusAppliedEvent = {
  id: string;
  occurredAt: number;
  victimId: string;
  applierId?: string | null;
  sourceWeaponId?: string | null;
  effectKind: StatusEffectKind;
};
```

초기에는 과하므로 보류 가능하다.

---

## 서버 구현 단계 제안

### 1단계

* shared 타입 정의
* `effects[]` 직렬화/역직렬화
* 플레이어 구조체에 active effects 저장

### 2단계

* 상태이상 apply / refresh / expire 헬퍼 구현
* 파생 능력치 계산 함수 구현

### 3단계

* movement / jump / heal / attack 루프에 파생 능력치 연결
* `shock` 입력 잠금 연결

### 4단계

* DoT tick 처리
* 사망 / respawn / kill attribution 처리

### 5단계

* 클라이언트 아이콘 / tint / 간단한 파티클 추가
* current-implementation 문서 갱신

---

## 권장 헬퍼 함수 예시

```ts
apply_status_effect(player, effect, now)
refresh_or_merge_effect(existing, incoming, now)
compute_derived_stats(player.effects, now)
tick_status_effects(player, now)
clear_status_effects_on_respawn(player)
```

---

## 테스트 포인트

### 서버 단위 테스트

1. burn 적용 시 일정 시간 뒤 자동 제거되는가
2. burn 중 이동속도 rank가 +1 되는가
3. chill 중 점프 힘이 감소하는가
4. shock 적용 시 220ms 동안 공격 입력이 무시되는가
5. poison 중 회복량이 절반으로 줄어드는가
6. DoT로 사망 시 death cause가 올바르게 기록되는가
7. respawn 시 effects가 비워지는가
8. 같은 effect 재적용 시 refresh 규칙이 맞는가

### 실제 플레이 테스트

1. burn이 빠르지만 위험하다는 감각이 있는가
2. chill이 낙사 유도에 기여하지만 과도하게 답답하지 않은가
3. shock이 리듬을 흔들되 연속 스턴 락이 발생하지 않는가
4. poison이 장기 압박은 되지만 존재감이 너무 약하지 않은가
5. tint / 아이콘만으로도 상태를 즉시 읽을 수 있는가

---

## 밸런스 리스크

### burn

* 속도 증가가 너무 강하면 오히려 버프처럼만 느껴질 수 있음
* DoT보다 기동 이득이 큰지 체크 필요

### chill

* 감속 + 점프 약화가 같이 들어가면 지나치게 무거워질 수 있음
* 낙사 맵에서 지나친 억제력이 없는지 확인 필요

### shock

* 짧은 stun이어도 연사 무기에 붙으면 락이 될 수 있음
* 내부 재발동 쿨다운 필요 가능성 높음

### poison

* 회복 수단이 적은 현재 메타에서는 heal reduction 존재감이 낮을 수 있음
* DoT 수치를 너무 높이면 burn과 역할이 겹침

---

## 완료 조건

* 서버 authoritative 상태이상 시스템이 동작한다
* `PlayerSnapshot.effects`가 실제 런타임 데이터가 된다
* `burn`, `chill`, `shock`, `poison` 네 종류를 적용/유지/만료할 수 있다
* 이동/점프/입력/회복/DoT에 상태이상이 반영된다
* 클라이언트가 최소한 tint + 아이콘 수준으로 식별 가능하다
* death / respawn / kill attribution과 충돌하지 않는다
* `docs/technical/current-implementation.md`가 새 시스템을 반영한다

---

## 후속 작업

이 문서 이후 우선순위는 아래를 권장한다.

1. `미니 스펙 — 상태이상 무기 v1`

   * `Stun Gun`
   * `Ice Gun`

2. `미니 스펙 — 상태이상 표현 polish v0`

   * 전용 파티클
   * 상태이상 HUD 개선
   * 상태이상 적용 이벤트 연출

3. `미니 스펙 — 호출형 무기 / 전장 경고 시스템 v1`

   * 공습
   * 구역 경고
   * 지연 발동 AoE