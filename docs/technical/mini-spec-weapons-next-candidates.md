# 미니 스펙 후보: 다음 무기 3종

> 이 문서는 다음 구현할 무기 후보 3종의 초안이다.
> 실제 작업 시작 전 1종을 선택하고 별도 미니 스펙 파일로 분리한다.

---

## 후보 A — 블루베리 박격포 (`blueberry_mortar`)

### 테마
블루베리를 곡사포로 쏘는 포 — 포물선이 크고 땅에 닿으면 **폭발 범위 피해**.  
첫 AoE 무기. 예측샷 + 지형 압박 + 낙사 유도.

### 주요 스탯 (초안)

| 항목 | 값 |
|------|-----|
| hitType | `projectile` |
| fireMode | `single` |
| resourceModel | `magazine` |
| maxResource | 5 |
| damage (직접) | 30 |
| damage (폭발 범위) | 15 (반경 80px 내) |
| knockback | 18 |
| attackIntervalMs | 1200 |
| projectileSpeed | 420 px/s |
| projectileGravityPerSec2 | 1800 (강한 포물선) |
| rarity | uncommon |

### 새 서버 로직 — `explode` specialEffect

```json
"specialEffect": { "kind": "explode", "radius": 80, "splashDamage": 15 }
```

- 투사체가 지형 충돌 또는 플레이어 직격 시 폭발 → 반경 내 모든 플레이어에게 범위 피해 + 넉백
- 직접 맞은 경우 direct damage + splash damage 모두 적용

### 비주얼
- Pickup/Equip: 짧은 발사관 + 블루베리 탄환
- Fire style: `mortar_arc` — 고각도 포물선 총구 화염
- 투사체: 보라/파란 동그란 타원 (radius 5)
- 폭발 이펙트: 보라/흰색 원형 파동 + 파편

### 난이도: ★★★☆ (explode specialEffect 서버 신규 구현 필요)

---

## 후보 B — 다람쥐 기관총 (`squirrel_gatling`)

### 테마
도토리 탄창을 무한에 가깝게 퍼붓는 속사 총 — 낮은 데미지 × 빠른 연사.  
맞추는 것 자체는 쉬우나 한 발 피해가 낮아 이동 중 집중이 관건.

### 주요 스탯 (초안)

| 항목 | 값 |
|------|-----|
| hitType | `hitscan` |
| fireMode | `auto` |
| resourceModel | `magazine` |
| maxResource | 30 |
| resourcePerShot | 1 |
| damage | 5 |
| knockback | 2 |
| attackIntervalMs | 80 |
| rarity | uncommon |

### 새 서버 로직 — `auto` fireMode

- 현재 `single`만 있음. `auto`는 attack 버튼 누르는 동안 `attackIntervalMs`마다 자동 발사.
- `fire-and-forget` 로직(attack_was_down + attack_queued)을 auto로 확장.

### 비주얼
- Pickup/Equip: 다람쥐 꼬리 모양 개머리판 + 긴 총신 + 드럼 탄창
- Fire style: `auto_flash` — 빠른 총구 flash (70ms)
- 투사체: fallback 기존 hitscan tracer

### 난이도: ★★☆☆ (auto fireMode 서버 추가 필요, 하지만 비교적 단순)

---

## ~~후보 C — 솔방울 저격총 (`pine_sniper`)~~ ✅ feat/pine-sniper-v1 완료

### 테마
솔방울을 초고속으로 날리는 저격총 — 단발 고데미지, 느린 재장전, 긴 사거리.  
기존 인프라 100% 재사용, 가장 구현이 단순한 후보.

### 주요 스탯 (초안)

| 항목 | 값 |
|------|-----|
| hitType | `hitscan` |
| fireMode | `single` |
| resourceModel | `magazine` |
| maxResource | 3 |
| damage | 55 |
| knockback | 20 |
| selfRecoilForce | 15 |
| attackIntervalMs | 1400 |
| range | 1100 |
| aimProfile | -8° ~ +8° (좁은 조준각) |
| rarity | rare |

### 서버 로직: 기존 hitscan 완전 재사용

### 비주얼
- Pickup/Equip: 가늘고 긴 총신 + 솔방울 모양 개머리판 + 스코프 돌기
- Fire style: `sniper_flash` — 길고 가는 tracer (화면 너비까지)
- 발사 연출: 총구에서 길고 가는 빔 같은 선

### 난이도: ★☆☆☆ (기존 인프라 그대로, 스프라이트만 신규)

---

## 구현 순서 제안

| 우선순위 | 상태 | 이유 |
|----------|----|------|
| 1차: **후보 C** (솔방울 저격총) | ✅ 완료 | 신규 서버 로직 없음, 빠르게 무기 종수 확보 가능 |
| 2차: **후보 B** (다람쥐 기관총) | 🔜 다음 | auto fireMode는 중간 복잡도, 게임플레이 다양성 큰 폭 향상 |
| 3차: **후보 A** (블루베리 박격포) | 대기 | explode 시스템 신규 구현, 가장 복잡하지만 가장 임팩트 있음 |

---

## 참고

- 기존 무기 스프라이트 패턴: `docs/archive/mini-specs/mini-spec-weapon-sprites-v2.md`
- 기존 specialEffect 구현: `docs/archive/mini-specs/mini-spec-flamethrower-v1.md`
