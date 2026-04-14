import type { AnimationVFX, SpriteVFX, VFXBundle } from "@battle-hamsters/shared";

// Phaser를 타입으로만 참조한다 (peerDependency).
// 런타임 import는 게임 번들에서 제공된다.
type PhaserScene = import("phaser").Scene;

/**
 * VFXBundleRenderer — VFXBundle 데이터를 Phaser 씬에 렌더링한다.
 *
 * Phase 2 지원 타입:
 *   - sprite    → Phaser.GameObjects.Image (0.6초 후 destroy)
 *   - animation → Phaser.GameObjects.Sprite + anims (재생 후 destroy)
 *
 * Phase 3에서 추가 예정:
 *   - beam, trail, particle → 기존 절차적 렌더링 활용
 */
export class VFXBundleRenderer {
  constructor(private readonly scene: PhaserScene) {}

  /**
   * 번들의 에셋을 Phaser 텍스처 매니저에 등록한다.
   * 씬 preload 또는 create 단계에서 호출한다.
   * 이미 등록된 텍스처는 재등록하지 않는다.
   */
  preloadBundle(bundleId: string, bundle: VFXBundle, basePath = "/bundles"): void {
    for (const effect of bundle.effects) {
      const textureKey = this._textureKey(bundleId, effect.id);
      if (this.scene.textures.exists(textureKey)) continue;

      if (effect.type === "sprite") {
        const e = effect as SpriteVFX;
        this.scene.load.image(textureKey, `${basePath}/${bundleId}/${e.texture}`);
      } else if (effect.type === "animation") {
        const e = effect as AnimationVFX;
        this.scene.load.spritesheet(textureKey, `${basePath}/${bundleId}/${e.sheet}`, {
          frameWidth: e.frameWidth,
          frameHeight: e.frameHeight,
        });
      }
      // beam, trail, particle — Phase 3
    }
  }

  /**
   * 번들 에셋 로드 후 Phaser 애니메이션을 등록한다.
   * 씬 create 단계에서 호출한다.
   */
  registerAnimations(bundleId: string, bundle: VFXBundle): void {
    for (const effect of bundle.effects) {
      if (effect.type !== "animation") continue;
      const e = effect as AnimationVFX;
      const textureKey = this._textureKey(bundleId, effect.id);
      const animKey = this._animKey(bundleId, effect.id);
      if (this.scene.anims.exists(animKey)) continue;

      this.scene.anims.create({
        key: animKey,
        frames: this.scene.anims.generateFrameNumbers(textureKey, {
          start: 0,
          end: e.frameCount - 1,
        }),
        frameRate: e.fps,
        repeat: e.loop ? -1 : 0,
      });
    }
  }

  /**
   * 번들의 특정 effect를 (x, y) 위치에 재생한다.
   * Phase 2: sprite / animation 지원. 나머지는 false 반환.
   * @returns 렌더링 처리 여부 (false면 절차적 fallback 사용)
   */
  playEffect(effectId: string, bundle: VFXBundle, x: number, y: number): boolean {
    const effect = bundle.effects.find((e) => e.id === effectId);
    if (!effect) return false;

    const textureKey = this._textureKey(bundle.id, effectId);
    if (!this.scene.textures.exists(textureKey)) return false;

    if (effect.type === "sprite") {
      const img = this.scene.add.image(x, y, textureKey);
      img.setDepth(10);
      this.scene.tweens.add({
        targets: img,
        alpha: 0,
        duration: 600,
        onComplete: () => img.destroy(),
      });
      return true;
    }

    if (effect.type === "animation") {
      const animKey = this._animKey(bundle.id, effectId);
      if (!this.scene.anims.exists(animKey)) return false;
      const sprite = this.scene.add.sprite(x, y, textureKey);
      sprite.setDepth(10);
      sprite.play(animKey);
      sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
      return true;
    }

    // beam, trail, particle — Phase 3
    return false;
  }

  /**
   * 이 번들을 렌더러가 처리할 수 있는지 확인한다.
   * sprite 또는 animation 타입이 하나라도 있고 텍스처가 로드됐으면 true.
   */
  canRender(bundle: VFXBundle): boolean {
    return bundle.effects.some((e) => {
      if (e.type !== "sprite" && e.type !== "animation") return false;
      return this.scene.textures.exists(this._textureKey(bundle.id, e.id));
    });
  }

  private _textureKey(bundleId: string, effectId: string): string {
    return `vfx__${bundleId}__${effectId}`;
  }

  private _animKey(bundleId: string, effectId: string): string {
    return `vfx_anim__${bundleId}__${effectId}`;
  }
}
