// VFX Bundle Schema v2 + semantics extension
// ⚠️  이 파일은 bh-vfx-gen/frontend/lib/vfx-bundle.ts 와 동기화되어야 한다.
// 마지막 동기화: 2026-04-24
// 스키마 변경 시 두 파일을 같은 PR 사이클 내에 수정할 것.

export type VFXType = "sprite" | "animation" | "beam" | "particle" | "trail";

export type PlacementKind = "point" | "segment" | "follow" | "attached";
export type SemanticAnchor =
  | "center"
  | "emission_origin"
  | "impact_origin"
  | "projectile_tail"
  | "weapon_grip"
  | "swing_origin";
export type OrientationMode = "none" | "face_forward" | "follow_velocity" | "along_segment";
export type CompositionKind =
  | "item_sprite"
  | "radial_burst"
  | "directional_burst"
  | "trail_strip"
  | "segment_strip"
  | "arc_sweep";
export type MotionKind = "static" | "expand_fade" | "pulse" | "backward_scroll" | "arc_swing";

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface EffectSemantics {
  placement: {
    kind: PlacementKind;
    semanticAnchor: SemanticAnchor;
    pivot?: NormalizedPoint;
    orientation: OrientationMode;
  };
  composition: {
    kind: CompositionKind;
    contentBounds?: NormalizedRect;
    symmetry?: "radial" | "bilateral" | "asymmetric";
  };
  animation: {
    motion: MotionKind;
  };
}

// ── 개별 VFX Effect 타입 ──────────────────────────────────────────────

/** 정적 단일 이미지 */
export interface SpriteVFX {
  id: string;
  type: "sprite";
  texture: string;
  semantics?: EffectSemantics;
}

/** 프레임 애니메이션 (sprite sheet 기반) */
export interface AnimationVFX {
  id: string;
  type: "animation";
  sheet: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  semantics?: EffectSemantics;
}

/** 빔 — 두 점 사이를 잇는 선형 렌더링 */
export interface BeamVFX {
  id: string;
  type: "beam";
  body: string;
  start?: string;
  end?: string;
  mode: "stretch" | "tile";
  semantics?: EffectSemantics;
}

/**
 * 파티클 시스템 — 런타임이 직접 생성
 * Phase 1~2 렌더러 미지원: 렌더러가 이 타입을 조용히 스킵함
 */
export interface ParticleVFX {
  id: string;
  type: "particle";
  sprite: string;
  rate: number;
  lifetime: number;
  speed: number;
  spread: number;
  semantics?: EffectSemantics;
}

/** 트레일 */
export interface TrailVFX {
  id: string;
  type: "trail";
  texture: string;
  length: number;
  semantics?: EffectSemantics;
}

export type VFX = SpriteVFX | AnimationVFX | BeamVFX | ParticleVFX | TrailVFX;

// ── VFX Bundle ────────────────────────────────────────────────────────

export interface VFXBundle {
  id: string;
  schemaVersion: 2;
  generatedAt?: string;
  tags?: string[];
  effects: VFX[];
}
