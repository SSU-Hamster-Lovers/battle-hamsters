# Mini-Spec: VFX Runtime Phase 3 — beam/trail/particle 지원 + Bundle ID E2E 검증

**상태**: 📝 설계 확정 (2026-04-15)
**관련**: `mini-spec-vfx-runtime-phase2.md` 의 후속편
**참고**: `~/dev/bh-vfx-gen/docs/technical/alignment-battle-hamsters-phase5.md`
**완료 조건**: 5개 번들이 실제로 번들 기반으로 렌더링되고 (절차적 fallback 아님), beam/trail/particle 타입이 Phaser 에서 동작한다.

---

## 1. 목적

1. Phase 2 에서 `false` 반환으로 남겨둔 `beam / trail / particle` 렌더링을 Phaser 에 실제로 구현한다.
2. bh-vfx-gen 이 생성한 5개 번들이 `WEAPON_VFX_MAPPINGS` 의 ID 와 일치하는지 런타임에서 확인한다.

핵심 원칙(Phase 2 계승): **번들이 있으면 번들 렌더링 → 없으면 기존 절차적 렌더링(fallback)**.

---

## 2. 이번 범위 / 비목표

### 이번 범위

- `packages/vfx-runtime/renderer.ts` 의 `playEffect()` 에 beam/trail/particle 분기 추가
- `playEffect` 시그니처에 optional `opts: { x2?, y2? }` 추가 (beam 전용, 기존 호출부 호환)
- `preloadBundle()` / `canRender()` 에 beam/trail/particle 확장
- `apps/game/public/bundles/` 에 5개 번들 배치
- `apps/game/src/vfx-bundle-integration.ts` 의 `tryBundleFireVFX` 가 `opts` 를 받도록 확장
- `apps/game/src/main.ts` 의 laser_cutter 경로에 beam 종점 좌표 계산 → `opts.x2/y2` 로 전달
- 본 미니 스펙 문서 커밋

### 비목표 (이번에 하지 않음)

- `VFXHandle` follow/stop 모델 (옵션 C) — "8. 미래 확장" 항목에만 기록
- 지속 빔(hold beam) 무기 추가
- trail/particle 을 요구하는 **신규 무기 매핑 추가** — 별도 스텁 문서 `mini-spec-weapons-vfx-mapping-expansion.md` 에서 관리
- bh-vfx-gen Canvas 렌더러 변경
- 공유 타입(`vfx-bundle.ts`) 패키지화 — 수동 동기화 유지
- 번들 자산 CDN / Git LFS 분리
- `current-implementation.md` 의 VFX 섹션을 제외한 대규모 개편

### 건드리는 스펙

- `mini-spec-vfx-runtime-phase2.md` — 본 문서가 후속편임을 참조만 함(내용 불변)
- `current-implementation.md` — VFX 섹션을 PR3 에서 최소 갱신

### 검증 방법

- `pnpm typecheck` (packages/shared, packages/vfx-runtime, apps/game)
- 로컬 게임 실행 → 각 무기 발사/피격 시 번들 기반 렌더링 확인
- 의도적으로 번들 폴더 하나를 제거 → 절차적 fallback 회귀 확인

---

## 3. 렌더링 모델 결정 — B 모델 (단발 burst + beam 2점)

옵션 A (모두 burst) / B (beam 2점 + 나머지 burst) / C (VFXHandle follow/stop) 를 비교한 결과 **B 확정**.

| 선택 이유 |
|----------|
| 현재 매핑된 5개 번들 중 2점 표현이 필요한 건 beam 하나 |
| trail / particle 을 매핑한 무기가 없음 → burst 로 충분 |
| B→C 확장은 `opts` 에 `follow?` 를 추가하고 반환 타입을 `VFXHandle \| null` 로 바꾸는 additive 변경 → Phase 3 호출부 보존 |
| YAGNI: 실제 follow/stop 요구가 생길 때 C 로 승격 |

C 가 표현할 수 있으나 B 가 못하는 케이스(투사체 follow trail, 지속 빔, 부착 이펙트, 조기 종료)는 존재하지만 이번 매핑에선 요구 없음. "8. 미래 확장" 참조.

---

## 4. `renderer.ts` API 변경

### 4-1. `playEffect` 시그니처 확장 (후방 호환)

```ts
// Phase 2
playEffect(effectId: string, bundle: VFXBundle, x: number, y: number): boolean

// Phase 3
playEffect(
  effectId: string,
  bundle: VFXBundle,
  x: number,
  y: number,
  opts?: { x2?: number; y2?: number }
): boolean
```

- `opts` 는 optional → Phase 2 호출부 그대로 호환.
- `opts.x2/y2` 는 **beam 전용**. 다른 타입에선 무시.
- beam 인데 `x2/y2` 누락 → `false` 반환 후 fallback (명확한 실패 경로).

### 4-2. 타입별 동작

| type | 입력 | Phaser 객체 | lifetime |
|------|------|------------|---------|
| sprite | (x,y) | `Image` + alpha tween | 600ms fadeout (Phase 2 유지) |
| animation | (x,y) | `Sprite` + `play(anim)` | ANIMATION_COMPLETE 시 destroy (Phase 2 유지) |
| **beam** | (x,y)→(x2,y2) | `Image`(stretch) 또는 `TileSprite`(tile) + optional start/end cap | 150ms 표시 + 100ms fade → destroy |
| **trail** | (x,y) | `ParticleEmitter` | 300ms emit → stop → 자연 소멸 후 emitter destroy |
| **particle** | (x,y) | `ParticleEmitter` | 500ms emit → stop → 자연 소멸 후 emitter destroy |

### 4-3. beam 상세

- `BeamVFX.body` 텍스처는 `preloadBundle` 이 로드함.
- 공통 계산:
  - `length = Math.hypot(x2-x, y2-y)`
  - `angle  = Math.atan2(y2-y, x2-x)`
- `mode === "stretch"`:
  - `img = scene.add.image((x+x2)/2, (y+y2)/2, bodyTexKey)`
  - `img.setDisplaySize(length, textureHeight)`
  - `img.setRotation(angle)`
- `mode === "tile"`:
  - `tile = scene.add.tileSprite(x, y, length, textureHeight, bodyTexKey)`
  - `tile.setOrigin(0, 0.5)` + `tile.setRotation(angle)`
- start / end 캡 텍스처(optional):
  - `BeamVFX.start` 존재 시 `scene.add.image(x, y, startTexKey)` + `setRotation(angle)`
  - `BeamVFX.end`  존재 시 `scene.add.image(x2, y2, endTexKey)` + `setRotation(angle)`
- 150ms 후 `scene.tweens.add({ alpha: 0, duration: 100 })` → onComplete 에서 본체/캡 모두 destroy.

### 4-4. trail / particle 상세

- Phaser 3.60+ 의 `scene.add.particles(x, y, textureKey, config)` 사용.
- 단위 해석(bh-vfx-gen 스키마 명시 없음 → **초·도 단위로 가정**. 다르면 후속 이슈로 bh-vfx-gen 스키마에 단위 주석 추가):
  - `ParticleVFX.lifetime` : 초 → Phaser `lifespan`(ms) 로 `*1000`
  - `ParticleVFX.spread`   : 도 → Phaser `angle.min/max` 에 `±spread/2` 로 적용
  - `ParticleVFX.rate`     : 초당 입자 수 → Phaser `frequency = 1000 / rate`
  - `ParticleVFX.speed`    : px/s 로 Phaser `speed` 에 그대로
- `TrailVFX` 기본 config:
  ```ts
  { speed: { min: -30, max: 30 }, lifespan: trail.length * 30, quantity: 2, alpha: { start: 1, end: 0 } }
  ```
- emit 종료:
  - 300ms / 500ms 경과 후 `emitter.stop()` (신규 입자 생성 중단)
  - 입자 lifespan 이 끝날 때까지 대기 후 `emitter.destroy()`

### 4-5. `preloadBundle` 확장

- beam:
  - `scene.load.image(bodyKey, body)`
  - `start` 있으면 `scene.load.image(startKey, start)`
  - `end`   있으면 `scene.load.image(endKey,   end)`
- trail: `scene.load.image(key, trail.texture)`
- particle: `scene.load.image(key, particle.sprite)`

텍스처 키 네이밍:

- 공통: `vfx__{bundleId}__{effectId}`
- beam 캡: `vfx__{bundleId}__{effectId}__start`, `vfx__{bundleId}__{effectId}__end`

### 4-6. `canRender` 확장

- 현재: sprite / animation 만 검사.
- 변경 후: beam / trail / particle 의 **주 텍스처** 존재도 검사.
- beam 은 `body` 만 필수, `start`/`end` 는 optional.

---

## 5. `vfx-bundle-integration.ts` / 호출부 변경

### 5-1. `tryBundleFireVFX` 오버로드 확장

```ts
// Phase 2
export function tryBundleFireVFX(
  weaponId: string,
  x: number,
  y: number,
  mappings: WeaponVFXMapping[]
): boolean

// Phase 3
export function tryBundleFireVFX(
  weaponId: string,
  x: number,
  y: number,
  mappings: WeaponVFXMapping[],
  opts?: { x2?: number; y2?: number }
): boolean
```

내부: `_bundleRenderer.playEffect("muzzle", bundle, x, y, opts)` 로 전달. opts 누락 시 Phase 2 동작과 동일.

### 5-2. `main.ts` laser_cutter 분기

```ts
// 의사 코드
if (weaponId === "laser_cutter") {
  const { endX, endY } = computeLaserEndpoint(x, y, facing, laserRange);
  if (tryBundleFireVFX(weaponId, x, y, WEAPON_VFX_MAPPINGS, { x2: endX, y2: endY })) return;
} else {
  if (tryBundleFireVFX(weaponId, x, y, WEAPON_VFX_MAPPINGS)) return;
}
// fallback 절차적 렌더링 경로
```

**TODO (PR2 시작 시)**: 기존 절차적 laser 렌더링 코드에서 종점 좌표 계산 위치를 먼저 찾아 재사용한다. 없으면 해당 상수 하나를 뽑아 공유한다. 새 계산식을 창조하지 않는다.

### 5-3. `tryBundleHitVFX`

단일 좌표 burst 만 필요 → 시그니처 그대로 유지. 변경 없음.

### 5-4. 로딩 시점

- Phase 2 의 부트스트랩 경로(`initVFXBundleSystem`, `loader.loadMappings`) 유지.
- beam_electric_v1 번들이 없는 중간 상태(PR2 머지 직후, PR3 머지 전) 에는 `loader.get()` 이 `undefined` 반환 → `tryBundleFireVFX` 가 `false` 반환 → 절차적 laser fallback. 허용 가능한 상태.

---

## 6. 번들 배치 규약

### 6-1. 디렉토리

```
apps/game/public/bundles/{bundle_id}/
  bundle.json
  weapon/...
  vfx/...
  projectile/...
```

bh-vfx-gen 의 export 출력 구조를 그대로 복사.

### 6-2. 5개 번들 체크리스트

| bundle_id | 주요 VFX 타입 | 검증 PR | 렌더러 요구 |
|-----------|--------------|--------|------------|
| `shotgun_spread_v1` | sprite / animation | PR1 | Phase 2 |
| `cannon_blast_v1`   | sprite / animation | PR1 | Phase 2 |
| `seed_hit_v1`       | sprite / animation | PR1 | Phase 2 |
| `cannon_impact_v1`  | sprite / animation | PR1 | Phase 2 |
| `beam_electric_v1`  | beam               | PR3 | Phase 3 |

### 6-3. 번들 작성 절차 (사용자 수동)

1. bh-vfx-gen `localhost:8100` 접속.
2. 위 표의 `bundle_id` 기대값을 역으로 계산해 `name` 입력:
   - `"Shotgun Spread"` → `shotgun_spread_v1`
   - `"Cannon Blast"`   → `cannon_blast_v1`
   - `"Seed Hit"`       → `seed_hit_v1`
   - `"Cannon Impact"`  → `cannon_impact_v1`
   - `"Beam Electric"`  → `beam_electric_v1`
3. 출력된 `output/{id}_{ts}/` 폴더의 `bundle.json` 에서 `id` 필드가 기대값과 일치하는지 **육안 확인**.
4. 폴더를 `{bundle_id}` 로 리네임(타임스탬프 제거)하여 `apps/game/public/bundles/{bundle_id}/` 로 복사.
5. 게임 실행 → 해당 무기 발사 → 번들 렌더링 확인.

### 6-4. 저장소 커밋 정책

- `apps/game/public/bundles/` 는 `.gitignore` 대상 아님 → 번들 폴더 그대로 커밋.
- 이유: 리뷰 재현성, 데모 가능성, 용량 작음(번들당 PNG 수 개).
- 용량 문제 발생 시 CDN / LFS 논의는 Phase 4+ 로 연기 (비목표).

### 6-5. 검증 실패 시 정책

`bundle.json` 의 `id` 가 기대값과 다르면:

1. bh-vfx-gen 의 name 입력을 재확인.
2. 여전히 다르면 **bh-vfx-gen exporter 쪽 버그** → bh-vfx-gen 저장소에 이슈 기록 후 Phase 3 는 그 번들 하나만 제외하고 진행.
3. `WEAPON_VFX_MAPPINGS` 의 ID 를 바꾸지 않는다 (게임 코드가 exporter 규칙을 따라가게 하지 않음 — 스펙상 exporter 가 규칙을 지킨다).

---

## 7. PR 분할 · 병합 순서 · 충돌 방지

### 7-1. PR 구성

| PR | 브랜치 | 분기 대상 | 주요 파일 |
|----|-------|----------|----------|
| PR1 | `feat/phase3-e2e-verify-sprite-anim` | develop | `apps/game/public/bundles/{4개}/`, 본 문서 §9.1 |
| PR2 | `feat/phase3-beam-trail-particle`    | develop (PR1 과 병렬) | `packages/vfx-runtime/renderer.ts`, `apps/game/src/vfx-bundle-integration.ts`, `apps/game/src/main.ts`, 본 문서 §9.2 |
| PR3 | `feat/phase3-beam-verify`            | develop (PR2 머지 후) | `apps/game/public/bundles/beam_electric_v1/`, 본 문서 §9.3, `current-implementation.md`, `mini-spec-weapons-vfx-mapping-expansion.md` (스텁) |

### 7-2. 병합 순서 / rebase

- PR1 과 PR2 는 파일 교집합이 없으므로 동시에 열어도 됨.
- 권장 머지 순서: **PR1 → PR2 → PR3**.
- PR1 이 먼저 머지되면 PR2 는 develop rebase 후 push (충돌 없음).
- PR2 가 먼저 준비되면 PR1 을 기다리지 않고 PR2 먼저 머지해도 무방(파일 겹침 없음).
- PR3 는 반드시 **PR2 머지 후 develop 에서 새 브랜치로** 분기.

### 7-3. 충돌 방지 장치

- 본 문서 §9 의 체크리스트를 **PR 별 섹션으로 물리 분리** (§9.1 / §9.2 / §9.3) → 각 PR 은 자기 섹션만 수정.
- `current-implementation.md` 갱신은 PR3 에서만 수행 → 세 PR 이 같은 요약 섹션을 건드리지 않음.
- 번들 폴더는 PR 별로 서로 다른 `{bundle_id}` 디렉토리만 추가 → 경로 충돌 없음.

---

## 8. 미래 확장 (이번 범위 아님, 기록용)

- **VFXHandle follow/stop 모델 (옵션 C)**
  - `playEffect` 반환 타입을 `VFXHandle | null` 로 승격.
  - `opts` 에 `follow?: { target, onStop? }` 추가.
  - 투사체 follow trail, 지속 빔, 부착 이펙트, 조기 종료 지원.
  - 기존 `boolean` 호출부는 `!!handle` 로 호환 가능 → B 호출부 보존.
- **지속 빔(hold beam) 무기 추가**.
- **trail / particle 요구 신규 무기 매핑 확장** — `mini-spec-weapons-vfx-mapping-expansion.md` 스텁 문서에서 관리 (PR3 에서 생성).
- **번들 자산 CDN / Git LFS 분리**.
- **`vfx-bundle.ts` 공유 타입 패키지화** — 3번째 프로젝트가 생기거나 동기화 주기가 1개월을 넘을 때 재검토.

---

## 9. 검증 체크리스트 (PR 단위 물리 분리)

### 9.1 PR1 — sprite/animation 4개 번들 E2E

- [ ] `shotgun_spread_v1` 번들 배치
- [ ] `cannon_blast_v1` 번들 배치
- [ ] `seed_hit_v1` 번들 배치
- [ ] `cannon_impact_v1` 번들 배치
- [ ] 각 번들의 `bundle.json.id` 가 기대값과 일치 (육안 확인)
- [ ] seed_shotgun 발사 시 `shotgun_spread_v1` muzzle 렌더링 확인 (절차적 fallback 아님)
- [ ] walnut_cannon 발사 시 `cannon_blast_v1` muzzle 렌더링 확인
- [ ] seed 탄 피격 시 `seed_hit_v1` 렌더링 확인
- [ ] walnut 탄 피격 시 `cannon_impact_v1` 렌더링 확인
- [ ] fallback 회귀 확인 — 번들 하나를 일시 제거했을 때 기존 절차적 렌더링으로 복귀

### 9.2 PR2 — beam/trail/particle 구현

- [ ] `renderer.ts` `playEffect` 에 beam 분기 (stretch + tile + optional start/end cap)
- [ ] `renderer.ts` `playEffect` 에 trail 분기 (300ms burst, 자연 소멸 후 emitter destroy)
- [ ] `renderer.ts` `playEffect` 에 particle 분기 (500ms burst, 초/도 단위 가정)
- [ ] `preloadBundle` 이 beam/trail/particle 텍스처 로드 (beam 캡 포함)
- [ ] `canRender` 가 beam/trail/particle 주 텍스처 존재 여부까지 검사
- [ ] `vfx-bundle-integration.ts` `tryBundleFireVFX` 에 optional `opts` 파라미터 추가
- [ ] `main.ts` laser_cutter 분기에 종점 좌표 계산 → `opts.x2/y2` 전달
- [ ] 기존 laser 절차적 종점 계산을 찾아 재사용 (창조 금지)
- [ ] `packages/shared` / `packages/vfx-runtime` / `apps/game` typecheck 통과

### 9.3 PR3 — beam E2E + 문서화

- [ ] `beam_electric_v1` 번들 배치
- [ ] 번들의 `bundle.json.id` 가 `beam_electric_v1` 과 일치
- [ ] laser_cutter 발사 시 beam 번들 렌더링 확인 (절차적 laser 아님)
- [ ] beam 의 start/end 캡이 번들에 포함된 경우 양 끝 렌더링 확인
- [ ] `current-implementation.md` VFX 섹션 갱신 (Phase 3 반영)
- [ ] `mini-spec-weapons-vfx-mapping-expansion.md` 스텁 생성 (후속 작업 예약)
- [ ] 본 문서 상태를 ✅ 완료로 갱신
