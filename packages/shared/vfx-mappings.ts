// VFX Bundle — Weapon ID ↔ Bundle ID 매핑
// 게임의 weaponId가 bh-vfx-gen에서 생성된 bundle id를 가리킨다.
// 번들 파일이 apps/game/public/bundles/{bundle_id}/ 에 존재해야 로더가 성공한다.
// 없으면 VFXBundleLoader.get()이 undefined를 반환하고 절차적 렌더링으로 fallback된다.

export interface WeaponVFXMapping {
  weaponId: string;
  /** 발사(attack) 시 사용할 bundle id. undefined면 절차적 렌더링 */
  attackVFX?: string;
  /** 피격(hit/impact) 시 사용할 bundle id. undefined면 절차적 렌더링 */
  hitVFX?: string;
}

/**
 * Phase 2 초기 매핑 — 3개 무기
 * bundle id는 bh-vfx-gen에서 생성 시 name 필드로 결정된다.
 * 실제 번들 생성 후 id가 다르면 이 값을 업데이트할 것.
 */
export const WEAPON_VFX_MAPPINGS: WeaponVFXMapping[] = [
  {
    weaponId: "seed_shotgun",
    attackVFX: "shotgun_spread_v1",
    hitVFX: "seed_hit_v1",
  },
  {
    weaponId: "laser_cutter",
    attackVFX: "beam_electric_v1",
    hitVFX: undefined,
  },
  {
    weaponId: "walnut_cannon",
    attackVFX: "cannon_blast_v1",
    hitVFX: "cannon_impact_v1",
  },
];

/** weaponId로 매핑을 빠르게 조회하는 헬퍼 */
export function getWeaponVFXMapping(weaponId: string): WeaponVFXMapping | undefined {
  return WEAPON_VFX_MAPPINGS.find((m) => m.weaponId === weaponId);
}
