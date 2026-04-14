import type { VFXBundle } from "@battle-hamsters/shared";
import type { WeaponVFXMapping } from "@battle-hamsters/shared";

/**
 * VFXBundleLoader — bundle.json을 fetch하여 인메모리 캐시에 보관한다.
 *
 * 기본 경로: `/bundles/{bundleId}/bundle.json`
 * 번들 파일은 apps/game/public/bundles/ 아래에 정적 파일로 배치한다.
 * fetch 실패 시 에러를 throw하지 않고 undefined를 캐시하여 fallback이 동작하게 한다.
 */
export class VFXBundleLoader {
  private readonly cache = new Map<string, VFXBundle | null>();

  /**
   * 단일 번들을 로드하여 캐시에 저장한다.
   * 이미 캐시에 있으면 재요청하지 않는다.
   * @returns 로드된 VFXBundle 또는 undefined (fetch/parse 실패 시)
   */
  async load(bundleId: string, basePath = "/bundles"): Promise<VFXBundle | undefined> {
    if (this.cache.has(bundleId)) {
      return this.cache.get(bundleId) ?? undefined;
    }

    const url = `${basePath}/${bundleId}/bundle.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        this.cache.set(bundleId, null);
        return undefined;
      }
      const data = (await res.json()) as VFXBundle;
      this.cache.set(bundleId, data);
      return data;
    } catch {
      this.cache.set(bundleId, null);
      return undefined;
    }
  }

  /**
   * WeaponVFXMapping 배열에서 참조하는 모든 bundle id를 병렬로 로드한다.
   * 게임 씬 preload/create 단계에서 한 번 호출한다.
   */
  async loadMappings(mappings: WeaponVFXMapping[], basePath = "/bundles"): Promise<void> {
    const ids = new Set<string>();
    for (const m of mappings) {
      if (m.attackVFX) ids.add(m.attackVFX);
      if (m.hitVFX) ids.add(m.hitVFX);
    }
    await Promise.all([...ids].map((id) => this.load(id, basePath)));
  }

  /** 캐시에서 번들을 동기 조회한다. 없거나 실패한 번들은 undefined. */
  get(bundleId: string): VFXBundle | undefined {
    return this.cache.get(bundleId) ?? undefined;
  }

  has(bundleId: string): boolean {
    const v = this.cache.get(bundleId);
    return v !== undefined && v !== null;
  }
}
