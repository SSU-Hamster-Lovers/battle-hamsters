# Mini-Spec: VFX Runtime Phase 2 — battle-hamsters 어댑터

**상태**: ✅ 확정 (2026-04-14)  
**관련 로드맵**: `bh-vfx-gen/docs/design/roadmap-platform-v2.md` Phase 2  
**완료 조건**: seed_shotgun 발사 시 bundle.json 기반 VFX 렌더링 경로 확인

---

## 목적

bh-vfx-gen Generator가 출력하는 VFX Bundle JSON을 battle-hamsters 게임이 로드하고,  
기존 절차적 렌더링 대신 번들 데이터를 우선 사용하는 어댑터 레이어를 구축한다.

핵심 원칙: **번들이 있으면 번들 렌더링 → 없으면 기존 절차적 렌더링 (fallback)**

---

## 1. 번들 파일 배치 구조

게임은 번들 JSON + 에셋을 정적 파일로 제공받는다.

```
apps/game/public/
└── bundles/
    └── {bundle_id}/          (예: shotgun_spread_v1)
        ├── bundle.json
        ├── weapon/
        │   └── weapon_sprite.png
        ├── vfx/
        │   ├── muzzle_flash_sheet.png
        │   └── hit_vfx_sheet.png
        └── projectile/
            └── projectile_sprite.png
```

bh-vfx-gen에서 생성된 번들 폴더를 이 위치로 복사하면 게임이 로드한다.  
(Phase 3에서 동적 URL 로딩 또는 자동 복사 스크립트로 개선 가능)

---

## 2. 추가/변경 파일 목록

### packages/shared/
| 파일 | 변경 | 내용 |
|------|------|------|
| `vfx-bundle.ts` | 신규 | VFX Bundle 타입 (bh-vfx-gen 동기화) |
| `vfx-mappings.ts` | 신규 | WeaponVFXMapping 타입 + 3개 무기 데이터 |
| `index.ts` | 수정 | 위 두 파일 re-export 추가 |

### packages/vfx-runtime/ (신규 패키지)
| 파일 | 내용 |
|------|------|
| `package.json` | `@battle-hamsters/vfx-runtime`, workspace 의존성 |
| `tsconfig.json` | packages/shared 동일 구조 |
| `loader.ts` | `VFXBundleLoader` — fetch + parse + 인메모리 캐시 |
| `renderer.ts` | `VFXBundleRenderer` — VFXBundle → Phaser 렌더링 |
| `index.ts` | public API re-export |

### apps/game/
| 파일 | 변경 | 내용 |
|------|------|------|
| `package.json` | 수정 | `@battle-hamsters/vfx-runtime: workspace:*` 의존성 추가 |
| `tsconfig.json` | 수정 | `@battle-hamsters/vfx-runtime` 경로 alias 추가 |
| `src/weapon-presentation.ts` | 수정 | 번들 우선 조회 헬퍼 + fallback 패턴 |

---

## 3. 핵심 타입

```ts
// packages/shared/vfx-mappings.ts

export interface WeaponVFXMapping {
  weaponId: string;
  attackVFX?: string;   // 발사 시 사용할 bundle id
  hitVFX?: string;      // 피격 시 사용할 bundle id
}
```

---

## 4. VFXBundleLoader 인터페이스

```ts
// packages/vfx-runtime/loader.ts

class VFXBundleLoader {
  async load(bundleId: string, basePath: string): Promise<VFXBundle>
  get(bundleId: string): VFXBundle | undefined
  has(bundleId: string): boolean
  loadMappings(mappings: WeaponVFXMapping[], basePath: string): Promise<void>
}
```

- `basePath`: 번들 루트 경로 (기본값: `/bundles`)
- 캐시 히트 시 재요청 없이 반환
- fetch 실패 시 에러를 throw하지 않고 `undefined` 반환 (fallback 유지)

---

## 5. VFXBundleRenderer 인터페이스

```ts
// packages/vfx-runtime/renderer.ts

class VFXBundleRenderer {
  constructor(scene: Phaser.Scene)
  preloadBundle(bundleId: string, bundle: VFXBundle, basePath: string): void
  playEffect(effectId: string, bundle: VFXBundle, x: number, y: number): void
  canRender(bundle: VFXBundle): boolean
}
```

**Phase 2에서 지원하는 VFX 타입**:

| type | 렌더링 방식 | Phase |
|------|------------|-------|
| `sprite` | Phaser Image 생성 후 fade out | Phase 2 |
| `animation` | Phaser Sprite + anims 재생 | Phase 2 |
| `beam` | 기존 절차적 fallback | Phase 3 |
| `trail` | 기존 절차적 fallback | Phase 3 |
| `particle` | 기존 절차적 fallback | Phase 3 |

---

## 6. weapon-presentation.ts 변경 패턴

```ts
// 번들 캐시 인스턴스 (game scene에서 주입)
let _bundleLoader: VFXBundleLoader | null = null;
let _bundleRenderer: VFXBundleRenderer | null = null;

export function initVFXBundleSystem(
  loader: VFXBundleLoader,
  renderer: VFXBundleRenderer
): void {
  _bundleLoader = loader;
  _bundleRenderer = renderer;
}

// 기존 resolveWeaponFireStyle 앞에 번들 체크 추가
export function tryBundleFireVFX(
  weaponId: string,
  x: number,
  y: number,
  mappings: WeaponVFXMapping[]
): boolean {
  const mapping = mappings.find(m => m.weaponId === weaponId);
  if (!mapping?.attackVFX || !_bundleLoader || !_bundleRenderer) return false;
  const bundle = _bundleLoader.get(mapping.attackVFX);
  if (!bundle || !_bundleRenderer.canRender(bundle)) return false;
  _bundleRenderer.playEffect("muzzle", bundle, x, y);
  return true;  // true = 번들로 처리됨, 절차적 렌더링 스킵
}
```

main.ts 호출부:
```ts
// 번들로 처리되면 기존 렌더링 스킵
if (!tryBundleFireVFX(weaponId, x, y, WEAPON_VFX_MAPPINGS)) {
  const fireStyle = resolveWeaponFireStyle(weaponId);
  // ... 기존 절차적 렌더링
}
```

---

## 7. 초기 무기 매핑 (3개)

```ts
export const WEAPON_VFX_MAPPINGS: WeaponVFXMapping[] = [
  { weaponId: "seed_shotgun",  attackVFX: "shotgun_spread_v1", hitVFX: "seed_hit_v1" },
  { weaponId: "laser_cutter",  attackVFX: "beam_electric_v1",  hitVFX: undefined },
  { weaponId: "walnut_cannon", attackVFX: "cannon_blast_v1",   hitVFX: "cannon_impact_v1" },
];
```

번들 파일이 실제로 `public/bundles/{id}/bundle.json`에 존재해야 로더가 성공한다.  
없을 경우 `loader.get(id)`가 `undefined`를 반환하고 fallback 경로로 진행한다.

---

## 8. 구현 순서 (브랜치별)

1. `feat/phase2-vfx-shared-types` → `packages/shared/` 타입 추가
2. `feat/phase2-vfx-runtime-pkg` → `packages/vfx-runtime/` 패키지 생성
3. `feat/phase2-game-integration` → `apps/game/` 의존성 + `weapon-presentation.ts` 연동

---

## 9. 검증 체크리스트

- [ ] `packages/shared` 타입 체크 통과 (`pnpm -F @battle-hamsters/shared typecheck`)
- [ ] `packages/vfx-runtime` 타입 체크 통과 (`pnpm -F @battle-hamsters/vfx-runtime typecheck`)
- [ ] `apps/game` 타입 체크 통과 (`pnpm -F @battle-hamsters/game typecheck`)
- [ ] seed_shotgun 발사 시 `tryBundleFireVFX()` 호출 경로 존재 확인
- [ ] 번들 파일 없을 때 fallback 절차적 렌더링 정상 동작
- [ ] `vfx-bundle.ts` 타입이 bh-vfx-gen `frontend/lib/vfx-bundle.ts`와 동일
