# 미니 스펙: Paws 근접 전투 + HUD 1차 v1

작업명:
Paws 근접 판정 구현 + 하단 HUD 플레이어 카드 1차

목표:
Paws 무기에 서버 근접 히트 판정(원뿔 cone)을 추가하고, 기존 텍스트 덤프 형태 HUD를
하단 고정 플레이어 카드 바로 교체한다. 무기 아이콘 레지스트리를 도입해 HUD와 킬로그를
동일한 아이콘으로 통일한다.

이번 범위:

**서버 (Rust)**
- `room_combat.rs`: paws early-return 제거 → `find_melee_target()` 추가 (원뿔 판정)
- Paws 데미지/넉백/damageEvents/사망 처리 추가 (hitscan 동일 패턴)
- `cargo test` + Paws 원뿔 판정 단위 테스트 추가

**클라이언트 (TypeScript / Phaser 3)**
- `showAttackFlash()`: `paws_pulse` 원 2겹 → 사다리꼴(truncated cone) 시각 효과
- 무기 아이콘 레지스트리: `getWeaponIconTexture(weaponId)` → RenderTexture 코드 생성 아이콘
- HUD 하단 고정 바 (y=520~600): 플레이어 카드 × 2 + 중앙 타이머
- 킬로그 카드 → Container 기반 (공격자 | 무기 아이콘 | 피해자)

건드리는 스펙/문서:
- `docs/technical/sync-protocol.md`
- `docs/technical/current-implementation.md`
- `docs/game-design/weapon-design.md`

비목표:
- 실제 atlas/spritesheet 기반 자산
- Paws 이외 추가 무기 구현
- 래그돌/시체 연출
- 피격 화면 테두리 flash
- 팀전 레이아웃 (2+ 팀 구분)

검증 방법:
- `cargo test`
- `corepack pnpm --dir apps/game typecheck`
- `corepack pnpm --dir apps/game build`
- 실제 플레이: Paws로 상대 타격 가능 여부, HUD 정상 표시

---

## 1. Paws 원뿔 판정 수치

플레이어 크기: `PLAYER_HALF_SIZE = 14.0` (28×28px 정사각형)
JSON 정의 수치: `damage=8`, `knockback=3`, `attackIntervalMs=350`, `range=42`

| 항목 | 수치 |
|------|------|
| 판정 시작 (center 기준) | `+14px` (몸 절반, PLAYER_HALF_SIZE) |
| 판정 끝 (center 기준) | `+56px` (14 + 42) |
| 근처 반폭 (14px 지점) | `7px` (PLAYER_HALF_SIZE × 0.5) |
| 원거리 반폭 (56px 지점) | `21px` (PLAYER_HALF_SIZE × 1.5) |
| 타겟 수 | 단일 (가장 가까운 1명) |
| 자기 반동 | 없음 (selfRecoilForce=0) |

### 원뿔 판정 알고리즘

```
to_target = target_pos - attacker_pos
d_forward = dot(to_target, aim_normalized)  // 에임 축 투영
d_perp = |cross_2d(to_target, aim_normalized)|  // 수직 거리

d_forward ∈ [14, 56] 이고
d_perp ≤ lerp(7, 21, (d_forward - 14) / 42)  // 선형 보간 반폭
```

---

## 2. Paws 시각 효과 (client)

사다리꼴(truncated cone) flash. 방향: 에임 방향.

| 지점 | 거리 | 반폭 |
|------|------|------|
| 근처 (좁은 쪽) | 12px | 6px |
| 원거리 (넓은 쪽) | 76px | 24px |

- 채우기: `0xFB923C` (오렌지), alpha 0.80
- 외곽선: `0xFEF08A` (밝은 황색), 2px, alpha 0.95
- 유지 시간: `90ms`

---

## 3. HUD 하단 고정 바

뷰포트: `800×600`. HUD 바: `y=512~600` (높이 88px).

```
[0──────────────290]  [295──────505]  [510──────────800]
 로컬 플레이어 카드         타이머       상대 카드 (없으면 비어있음)
```

### 플레이어 카드 구조 (1P vs 2P, 적은 인원)

카드 크기: 약 280×84px, 반투명 다크 배경 (둥근 모서리).

```
┌────────────────────────────────────┐
│  [Face]  NickName                  │
│  [Face]  Kill icons (X-eye skull)  │
│  [HP bar ─ vertical segments ─]    │
│  [Life seeds ── ── ── ──]          │
└────────────────────────────────────┘
```

**HP 바** (vertical, 4구간 세그먼트):
- 구간마다 사선(45°) 구분선
- 색: 75~100% 녹색, 50~75% 연두, 25~50% 황색, 0~25% 적색
- 감소 영역: 어두운 회색으로 표시 (깎인 HP 시각화)

**생명(씨앗) 아이콘**: 해바라기씨 모양 placeholder (타원 코드 생성), 4개씩 그룹화.

**킬 아이콘**: 햄스터 얼굴에 눈이 X인 skull 아이콘, 4개씩 그룹화.

**유저 페이스**:
- 로컬 플레이어: 갈색 햄스터 원형 실루엣
- 상대 플레이어: 어두운 햄스터 원형 실루엣

### 타이머 (중앙)

- 형식: `MM:SS` (또는 `SS` if < 1분)
- 10초 이하: 적색 강조
- 배경: 좁은 다크 패널

### 많은 인원 (3명 이상 매치, 추후 확장)

현재는 우측 패널에 킬 최다 상대 1명만 표시. 추가 확장은 다음 브랜치.

---

## 4. 무기 아이콘 레지스트리

`getWeaponIconTexture(scene, weaponId, size)` → `string` (Phaser texture key)

| 무기 | 아이콘 설명 |
|------|------------|
| `paws` | 주먹 실루엣: 원(손바닥) + 4개 작은 반원(너클) |
| `acorn_blaster` | 총 실루엣: 몸체 사각형 + 총구 + 손잡이 |
| fallback | 흰 원 + 이니셜 2자 텍스트 |

---

## 5. 킬로그 카드 Container화

기존: `Phaser.GameObjects.Text` 단일 문자열

변경: `Phaser.GameObjects.Container`
- 좌: 공격자 이름 Text
- 중: 무기 아이콘 Image (16×16, `getWeaponIconTexture` 재사용)
- 우: 피해자 이름 Text

---

## 6. HUD 스타일 추천

햄스터 게임 특성에 맞는 **Warm Dark + Earthy Accent** 스타일 제안:

- 카드 배경: `#1C1410` (짙은 갈색), alpha 0.88
- 카드 테두리: `#5C3D1E` (나무색), 1.5px
- HP 바: 녹색→황→적 그라디언트 계열
- 생명 씨앗: `#F5C518` (해바라기 노란색)
- 킬 skull: `#E87040` (오렌지-레드)
- 타이머 텍스트: `#F9E4C8` (따뜻한 흰색)
- 기본 텍스트: `#D4B89A` (베이지)

이 스타일은 게임 분위기(빠른 난전)를 유지하면서도 귀엽고 따뜻한 톤을 줍니다.
모던하고 깔끔한 걸 원하면 대신 `#0F1117` 배경 + `#22D3EE` 청록 액센트 조합도 가능합니다.
