# 미니 스펙 후보: 무기 확장 v3 (11~13번째 무기)

> 현재 10종 → 목표 16~20종. 이 문서는 다음 3종의 초안이다.
> 작업 시작 전 우선순위를 확정하고 별도 미니 스펙 파일로 분리한다.

---

## 후보 A — 도토리 대검 (`acorn_sword`) ★ 추천 1순위

### 테마
도토리 껍질을 날카롭게 벼린 대검. 강한 근접 단타 + 큰 넉백 + 자기 전진.
현재 Paws가 유일한 근접이지만 느리고 약함. 이 무기는 "쾌속 돌진 근접"으로 차별화.

### 주요 스탯

| 항목 | 값 |
|------|-----|
| hitType | `melee` |
| fireMode | `single` |
| resourceModel | `magazine` |
| maxResource | 8 |
| resourcePerShot | 1 |
| damage | 22 |
| knockback | 14 |
| selfRecoilForce | 6 (전방 돌진) |
| selfRecoilAngleDeg | 0 |
| attackIntervalMs | 400 |
| range (hit_end) | 50px |
| meleeConeNearHalfWidth | 8 |
| meleeConeFarHalfWidth | 22 |
| rarity | `uncommon` |
| specialEffect | `none` |
| aimProfile | -30° ~ +30° |

### 새 서버 로직

기존 `find_melee_target` + `selfRecoil` 완전 재사용. 신규 로직 없음.

### 비주얼
- Pickup: 넓은 단검 모양 (도토리 껍질 질감 + 갈색/황갈색)
- Equip: 얇고 짧은 검 오버레이 (24×8)
- Fire style: `slash_arc` — 넓은 호 모양 flash (부채꼴 Graphics arc)
- Impact: `blade_spark` — 금속성 파편 3~4개

### 난이도: ★☆☆☆ (기존 melee 인프라 100% 재사용, 스프라이트만 신규)

---

## 후보 B — 솔방울 수류탄 (`pinecone_grenade`) ★ 추천 2순위

### 테마
솔방울을 던지면 1.5초 후 폭발. 지연 폭발 + 광역 CC(넉백). 
전략적 선투척 → 폭발 타이밍 조작. 강한 한 방이지만 사용 난이도 높음.

### 주요 스탯

| 항목 | 값 |
|------|-----|
| hitType | `projectile` |
| fireMode | `single` |
| resourceModel | `magazine` |
| maxResource | 2 |
| resourcePerShot | 1 |
| damage | 0 (직접 타격 없음) |
| knockback | 0 |
| selfRecoilForce | 1.5 |
| attackIntervalMs | 800 |
| projectileSpeed | 500 |
| projectileGravityPerSec2 | 600 |
| range | 900 |
| rarity | `rare` |
| specialEffect | `{ kind: "timed_explode", delayMs: 1500, radius: 120, splashDamage: 55 }` |
| aimProfile | -60° ~ +60° |

### 새 서버 로직 — `timed_explode` specialEffect

```json
"specialEffect": { "kind": "timed_explode", "delayMs": 1500, "radius": 120, "splashDamage": 55 }
```

- 투사체 생성 시 `explode_at = now_ms + delay_ms` 필드 저장
- `step_projectiles`에서 `explode_at` 도달 시 기존 `apply_explosion` 재사용 후 소멸
- 지형 충돌 시에도 즉시 폭발 (기존 `explode` 동작 유지)
- 직접 타격 시에도 즉시 폭발

### 비주얼
- Pickup: 둥근 솔방울 + 안전핀 / 손잡이
- Equip: 작고 둥근 오버레이 (22×14)
- 투사체: 보라/갈색 타원 + 회전 + 퓨즈 스파크 파티클
- Fire style: `throw_arc` — 포물선 예측선 (mortar_arc 재사용 가능)
- 폭발 이펙트: `explosion_burst` 재사용 (확장 반지름)

### 난이도: ★★☆☆ (timed_explode 필드 추가, apply_explosion 재사용, 투사체 회전/퓨즈 파티클 신규)

---

## 후보 C — 고슴도치 스프레이 (`hedgehog_spray`) ★ 추천 3순위

### 테마
고슴도치 가시를 좁은 부채꼴로 여러 발 연속 발사. 근-중거리 제압.
Seed Shotgun보다 좁고 깊으며, 연속 발사가 가능. "근거리 압박" 포지션.

### 주요 스탯

| 항목 | 값 |
|------|-----|
| hitType | `projectile` |
| fireMode | `auto` |
| resourceModel | `magazine` |
| maxResource | 16 |
| resourcePerShot | 1 |
| pelletCount | 3 |
| spreadDeg | 12 |
| damage | 7 |
| knockback | 3 |
| selfRecoilForce | 1.5 |
| attackIntervalMs | 200 |
| projectileSpeed | 680 |
| projectileGravityPerSec2 | 180 |
| range | 500 |
| rarity | `uncommon` |
| specialEffect | `none` |
| aimProfile | -50° ~ +40° |

### 새 서버 로직

기존 `pelletCount > 1` + `auto fireMode` 완전 재사용. 신규 로직 없음.

### 비주얼
- Pickup: 통통한 고슴도치 모양 발사기 (가시 돌기 + 갈색/흰색)
- Equip: 짧은 통형 오버레이 (32×14)
- 투사체: 날카로운 작은 가시 타원 (3×7)
- Fire style: `spray_burst` — 좁은 3줄기 부채꼴 flash (seed_shotgun과 유사하지만 더 좁게)
- Impact: `thorn_puff` — 갈색 작은 파편 2~3개

### 난이도: ★☆☆☆ (기존 pelletCount + auto 인프라 100% 재사용)

---

## 구현 순서 제안

| 우선순위 | 후보 | 이유 |
|----------|------|------|
| 1차 | **후보 A** (도토리 대검) | 신규 인프라 없음, 가장 빠르게 근접 포지션 채움 |
| 2차 | **후보 C** (고슴도치 스프레이) | 신규 인프라 없음, 근-중거리 압박 포지션 채움 |
| 3차 | **후보 B** (솔방울 수류탄) | timed_explode 신규 구현 필요, 가장 전략적 다양성 추가 |

---

## 참고

- 기존 specialEffect 구현: `docs/archive/mini-specs/mini-spec-flamethrower-v1.md`
- explode 구현: `server/src/room_projectiles.rs::apply_explosion`
- melee 구현: `server/src/room_combat.rs::find_melee_target`
