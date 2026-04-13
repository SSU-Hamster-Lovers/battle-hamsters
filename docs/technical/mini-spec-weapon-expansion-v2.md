# 미니 스펙 — 무기 확장 v2

## 작업명

무기 확장 v2 — Visual Clamp + Seed Shotgun + Hand Cannon

## 목표

두 가지 작업을 순서대로 처리한다.

1. **Visual Clamp**: 무기별 허용 조준 각도를 데이터로 정의하고, 클라이언트 오버레이 회전 표현에 적용한다.
2. **신규 무기 2종**: `Seed Shotgun` (산탄 hitscan)과 `Hand Cannon` (고위력 단발)을 런타임 후보로 추가한다.

이번 단계에서는 **상태이상 없이**, 기존 hitscan 판정 구조 안에서 최대한 처리한다.

---

## 이번 범위

### Phase A — Visual Clamp (브랜치: `feat/weapon-visual-clamp-v1`)

* `WeaponDefinition`에 옵셔널 `aimProfile` 필드 추가
* `acorn-blaster.json`, `paws.json`에 `aimProfile` 값 추가
* 클라이언트 `updateWeaponOverlay()`에서 `aimProfile` 기반 각도 clamp 적용
* clamp는 **표시 전용** (서버 판정 clamp는 후속 Step 3)

### Phase B — 신규 무기 (브랜치: `feat/weapon-expansion-v2`)

* `seed-shotgun.json` 정의 추가
* `hand-cannon.json` 정의 추가
* 서버 hitscan 판정이 `pelletCount > 1`일 때 burst 루프를 처리하도록 확장
* 맵 `weaponSpawns`에 두 무기 추가
* `current-implementation.md` 갱신

---

## 건드리는 스펙/문서

* `docs/game-design/weapon-design.md`
* `docs/technical/data-formats.md`
* `docs/technical/current-implementation.md`
* `packages/shared/weapons.ts`
* `packages/shared/weapons/acorn-blaster.json`
* `packages/shared/weapons/paws.json`
* `packages/shared/weapons/seed-shotgun.json` (신규)
* `packages/shared/weapons/hand-cannon.json` (신규)
* `packages/shared/maps/training-arena.json`
* `server/src/room_combat.rs`
* `apps/game/src/main.ts`

---

## 비목표

* 서버 판정 각도 clamp (Step 3)
* 발사 실패 피드백 연출 (Step 4)
* Berry Launcher / 발사체 물리
* Grenade Pack / AoE 폭발
* 전용 pickup / equip 스프라이트 (fallback으로 처리)
* 상태이상 연동

---

## 핵심 결정

### Visual Clamp

* `aimProfile`은 `WeaponDefinition` 선택 필드. 없으면 무제한 회전 허용.
* 각도 기준: 캐릭터 바라보는 방향을 `0deg`, 위가 음수, 아래가 양수.
  * `Acorn Blaster`: `minAimDeg: -55`, `maxAimDeg: 40`
  * `Paws`: `minAimDeg: -30`, `maxAimDeg: 30`
* clamp 후에도 aim 벡터 자체(서버 전송값)는 수정하지 않는다.

### Seed Shotgun

* `pelletCount: 5`, `spreadDeg: 22`, `hitType: "hitscan"`
* 서버에서 pellet 개별 판정. 같은 타겟에 여러 pellet이 맞으면 모두 독립 피해.
* 단발당 탄 소모 1. 총 4발 탄창.
* 희귀도 `uncommon`.

### Hand Cannon

* `pelletCount: 1`, 높은 `damage` / `knockback` / `selfRecoilForce`
* 긴 `attackIntervalMs`. 에임이 중요한 숙련형.
* 총 4발 탄창. 희귀도 `rare`.

---

## 데이터 구조

### `aimProfile` 타입 (packages/shared/weapons.ts)

```ts
export type WeaponAimProfile = {
  minAimDeg: number; // 위 방향 음수 (e.g. -55)
  maxAimDeg: number; // 아래 방향 양수 (e.g. 40)
};

// WeaponDefinition에 추가:
// aimProfile?: WeaponAimProfile;
```

### seed-shotgun.json 초안

```json
{
  "version": 1,
  "id": "seed_shotgun",
  "name": "Seed Shotgun",
  "hitType": "hitscan",
  "fireMode": "single",
  "resourceModel": "magazine",
  "damage": 7,
  "knockback": 4,
  "selfRecoilForce": 1.5,
  "selfRecoilAngleDeg": 0,
  "selfRecoilAngleJitterDeg": 5,
  "selfRecoilGroundMultiplier": 1,
  "selfRecoilAirMultiplier": 1.2,
  "attackIntervalMs": 700,
  "range": 400,
  "projectileSpeed": 0,
  "spreadDeg": 22,
  "pelletCount": 5,
  "maxResource": 4,
  "resourcePerShot": 1,
  "resourcePerSecond": 0,
  "discardOnEmpty": true,
  "pickupWeight": 8,
  "rarity": "uncommon",
  "worldDespawnMs": 10000,
  "specialEffect": { "kind": "none" }
}
```

### hand-cannon.json 초안

```json
{
  "version": 1,
  "id": "hand_cannon",
  "name": "Hand Cannon",
  "hitType": "hitscan",
  "fireMode": "single",
  "resourceModel": "magazine",
  "damage": 28,
  "knockback": 18,
  "selfRecoilForce": 3.5,
  "selfRecoilAngleDeg": 0,
  "selfRecoilAngleJitterDeg": 3,
  "selfRecoilGroundMultiplier": 0.8,
  "selfRecoilAirMultiplier": 1.5,
  "attackIntervalMs": 900,
  "range": 700,
  "projectileSpeed": 0,
  "spreadDeg": 3,
  "pelletCount": 1,
  "maxResource": 4,
  "resourcePerShot": 1,
  "resourcePerSecond": 0,
  "discardOnEmpty": true,
  "pickupWeight": 5,
  "rarity": "rare",
  "worldDespawnMs": 10000,
  "specialEffect": { "kind": "none" }
}
```

---

## 서버 burst 처리 개요

**파일**: `server/src/room_combat.rs`

현재 hitscan은 단일 레이. `pellet_count > 1`일 때 `spread_deg` 범위에서 균등 분산:

```
spread_step = spread_deg / (pellet_count - 1)  (pellet_count >= 2)
pellet_angles[i] = base_angle - (spread_deg / 2) + i * spread_step
```

각 pellet은 독립적으로 판정. 같은 타겟 복수 적중 = 복수 피해.

---

## 완료 조건

### Phase A
* `aimProfile` 없는 무기는 기존과 동일하게 무제한 회전
* Acorn Blaster 수직 상향(-90°) 조준 시 -55°에서 overlay 멈춤
* Paws -30°/+30° 범위 clamp 확인

### Phase B
* Seed Shotgun / Hand Cannon이 맵에 spawn되어 주울 수 있다
* Seed Shotgun 발사 시 서버가 5개 pellet을 개별 판정한다
* Hand Cannon 발사 시 높은 넉백/반동이 체감된다
* `current-implementation.md`가 갱신된다
