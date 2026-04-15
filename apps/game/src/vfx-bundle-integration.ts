/**
 * VFX Bundle 통합 모듈
 *
 * 게임 씬과 vfx-runtime 패키지를 연결한다.
 * - 씬 create() 에서 initVFXBundleSystem(scene) 을 fire-and-forget으로 호출
 * - 번들이 로드되는 동안은 tryBundle* 함수가 false를 반환 → 절차적 fallback 동작
 * - 로드 완료 후부터 번들 기반 렌더링 경로로 전환됨
 */

import { VFXBundleLoader, VFXBundleRenderer } from "@battle-hamsters/vfx-runtime";
import { WEAPON_VFX_MAPPINGS, getWeaponVFXMapping } from "@battle-hamsters/shared";
import type Phaser from "phaser";

const BUNDLES_BASE_PATH = "/bundles";

let _loader: VFXBundleLoader | null = null;
let _renderer: VFXBundleRenderer | null = null;

/**
 * VFX Bundle 시스템을 초기화한다.
 * 씬 create() 에서 `void initVFXBundleSystem(this)` 로 호출한다 (fire-and-forget).
 *
 * 번들 파일이 apps/game/public/bundles/{bundle_id}/ 에 존재해야 로드된다.
 * 파일이 없으면 loader.has()가 false를 반환하고 절차적 fallback이 동작한다.
 */
export async function initVFXBundleSystem(scene: Phaser.Scene): Promise<void> {
  _loader = new VFXBundleLoader();
  _renderer = new VFXBundleRenderer(scene);

  // 모든 매핑된 번들 병렬 로드 (fetch)
  await _loader.loadMappings(WEAPON_VFX_MAPPINGS, BUNDLES_BASE_PATH);

  // 로드 성공한 번들의 텍스처를 Phaser 로더에 등록
  const bundleIds = new Set<string>();
  for (const m of WEAPON_VFX_MAPPINGS) {
    if (m.attackVFX) bundleIds.add(m.attackVFX);
    if (m.hitVFX) bundleIds.add(m.hitVFX);
  }

  let hasTexturesToLoad = false;
  for (const bundleId of bundleIds) {
    const bundle = _loader.get(bundleId);
    if (!bundle) continue;
    _renderer.preloadBundle(bundleId, bundle, BUNDLES_BASE_PATH);
    hasTexturesToLoad = true;
  }

  if (hasTexturesToLoad) {
    await new Promise<void>((resolve) => {
      scene.load.once("complete", () => {
        _registerAnimations(bundleIds);
        resolve();
      });
      scene.load.start();
    });
  } else {
    _registerAnimations(bundleIds);
  }
}

function _registerAnimations(bundleIds: Set<string>): void {
  if (!_loader || !_renderer) return;
  for (const bundleId of bundleIds) {
    const bundle = _loader.get(bundleId);
    if (bundle) _renderer.registerAnimations(bundleId, bundle);
  }
}

/**
 * 발사(attack) VFX를 번들로 렌더링 시도한다.
 * @returns true = 번들로 처리됨 (절차적 렌더링 스킵), false = fallback 필요
 */
export function tryBundleFireVFX(weaponId: string, x: number, y: number): boolean {
  if (!_loader || !_renderer) return false;
  const mapping = getWeaponVFXMapping(weaponId);
  if (!mapping?.attackVFX) return false;
  const bundle = _loader.get(mapping.attackVFX);
  if (!bundle || !_renderer.canRender(bundle)) return false;
  return _renderer.playEffect("muzzle", bundle, x, y);
}

/**
 * 피격(hit) VFX를 번들로 렌더링 시도한다.
 * @returns true = 번들로 처리됨 (절차적 렌더링 스킵), false = fallback 필요
 */
export function tryBundleHitVFX(weaponId: string, x: number, y: number): boolean {
  if (!_loader || !_renderer) return false;
  const mapping = getWeaponVFXMapping(weaponId);
  if (!mapping?.hitVFX) return false;
  const bundle = _loader.get(mapping.hitVFX);
  if (!bundle || !_renderer.canRender(bundle)) return false;
  return _renderer.playEffect("hit", bundle, x, y);
}
