import type { AnimationVFX, SpriteVFX, VFX, VFXBundle } from "@battle-hamsters/shared";

// Phaser를 타입으로만 참조한다 (peerDependency).
// 런타임 import는 게임 번들에서 제공된다.
type PhaserScene = import("phaser").Scene;

export interface PlayEffectOptions {
  flipX?: boolean;
  showSemanticsDebug?: boolean;
}

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
  playEffect(
    effectId: string,
    bundle: VFXBundle,
    x: number,
    y: number,
    options: PlayEffectOptions = {},
  ): boolean {
    const effect = bundle.effects.find((e) => e.id === effectId);
    if (!effect) return false;

    const textureKey = this._textureKey(bundle.id, effectId);
    if (!this.scene.textures.exists(textureKey)) return false;
    const pivot = this._resolvePivot(effect);

    if (effect.type === "sprite") {
      const img = this.scene.add.image(x, y, textureKey);
      img.setOrigin(pivot.x, pivot.y);
      img.setFlipX(Boolean(options.flipX));
      img.setDepth(10);
      const cleanupDebug = this._createSemanticsDebugOverlay(
        effect,
        img,
        Boolean(options.flipX),
        Boolean(options.showSemanticsDebug),
      );
      this.scene.tweens.add({
        targets: img,
        alpha: 0,
        duration: 600,
        onComplete: () => {
          cleanupDebug?.();
          img.destroy();
        },
      });
      return true;
    }

    if (effect.type === "animation") {
      const animKey = this._animKey(bundle.id, effectId);
      if (!this.scene.anims.exists(animKey)) return false;
      const sprite = this.scene.add.sprite(x, y, textureKey);
      sprite.setOrigin(pivot.x, pivot.y);
      sprite.setFlipX(Boolean(options.flipX));
      sprite.setDepth(10);
      const cleanupDebug = this._createSemanticsDebugOverlay(
        effect,
        sprite,
        Boolean(options.flipX),
        Boolean(options.showSemanticsDebug),
      );
      sprite.play(animKey);
      sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        cleanupDebug?.();
        sprite.destroy();
      });
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

  private _resolvePivot(effect: VFX): { x: number; y: number } {
    const pivot = effect.semantics?.placement.pivot;
    if (!pivot) return { x: 0.5, y: 0.5 };

    return {
      x: Phaser.Math.Clamp(pivot.x, 0, 1),
      y: Phaser.Math.Clamp(pivot.y, 0, 1),
    };
  }

  private _createSemanticsDebugOverlay(
    effect: VFX,
    node: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite,
    flipX: boolean,
    visible: boolean,
  ): (() => void) | null {
    const semantics = effect.semantics;
    if (!visible || !semantics) return null;

    const graphics = this.scene.add.graphics().setDepth(node.depth + 1);
    const label = this.scene.add
      .text(0, 0, "", {
        fontSize: "10px",
        color: "#a7f3d0",
        backgroundColor: "#00110acc",
        padding: { left: 4, right: 4, top: 2, bottom: 2 },
      })
      .setDepth(node.depth + 1)
      .setOrigin(0.5, 1);

    const width = node.displayWidth;
    const height = node.displayHeight;
    const left = node.x - node.displayOriginX;
    const top = node.y - node.displayOriginY;
    const direction = flipX ? -1 : 1;
    const arrowLength = Math.max(18, width * 0.28);

    graphics.lineStyle(1.5, 0x34d399, 0.95);
    graphics.strokeRect(left, top, width, height);

    if (semantics.composition.contentBounds) {
      const bounds = semantics.composition.contentBounds;
      const contentLeft = flipX ? left + width * (1 - bounds.right) : left + width * bounds.left;
      const contentRight = flipX ? left + width * (1 - bounds.left) : left + width * bounds.right;
      const contentTop = top + height * bounds.top;
      const contentBottom = top + height * bounds.bottom;

      graphics.lineStyle(1, 0xfbbf24, 0.95);
      graphics.strokeRect(
        contentLeft,
        contentTop,
        contentRight - contentLeft,
        contentBottom - contentTop,
      );
    }

    graphics.lineStyle(1.5, 0xf472b6, 0.95);
    graphics.lineBetween(node.x - 6, node.y, node.x + 6, node.y);
    graphics.lineBetween(node.x, node.y - 6, node.x, node.y + 6);
    graphics.fillStyle(0xf472b6, 1);
    graphics.fillCircle(node.x, node.y, 2.5);

    if (semantics.placement.orientation !== "none") {
      graphics.lineStyle(1.5, 0x60a5fa, 0.95);
      graphics.lineBetween(node.x, node.y, node.x + direction * arrowLength, node.y);
      graphics.lineBetween(
        node.x + direction * arrowLength,
        node.y,
        node.x + direction * (arrowLength - 5),
        node.y - 4,
      );
      graphics.lineBetween(
        node.x + direction * arrowLength,
        node.y,
        node.x + direction * (arrowLength - 5),
        node.y + 4,
      );
    }

    const pivot = semantics.placement.pivot ?? { x: 0.5, y: 0.5 };
    label.setText(
      [
        `${effect.id}  ${semantics.placement.semanticAnchor}`,
        `pivot ${pivot.x.toFixed(2)}, ${pivot.y.toFixed(2)}  ${semantics.composition.kind}`,
      ].join("\n"),
    );
    label.setPosition(node.x, top - 6);

    return () => {
      graphics.destroy();
      label.destroy();
    };
  }
}
