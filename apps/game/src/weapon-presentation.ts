import Phaser from "phaser";
import { weaponDefinitionById } from "@battle-hamsters/shared";

const WEAPON_HUD_ICON_PREFIX = "weapon-hud-icon";
const HUD_ICON_SIZE = 24;

const WEAPON_PICKUP_TEXTURE_PREFIX = "weapon-pickup";
const ACORN_PICKUP_TEXTURE_KEY = `${WEAPON_PICKUP_TEXTURE_PREFIX}-acorn-blaster`;
const EMBER_SPRINKLER_PICKUP_TEXTURE_KEY = `${WEAPON_PICKUP_TEXTURE_PREFIX}-ember-sprinkler`;
const WEAPON_EQUIP_TEXTURE_PREFIX = "weapon-equip";
const ACORN_EQUIP_TEXTURE_KEY = `${WEAPON_EQUIP_TEXTURE_PREFIX}-acorn-blaster`;
const EMBER_SPRINKLER_EQUIP_TEXTURE_KEY = `${WEAPON_EQUIP_TEXTURE_PREFIX}-ember-sprinkler`;

type WeaponPickupSource = "spawn" | "dropped" | "reward";

export type WeaponPickupPresentation = {
  textureKey: string | null;
  code: string;
  showNameLabel: boolean;
};

export type WeaponEquipPresentation = {
  textureKey: string | null;
  offsetX: number;
  offsetY: number;
  flipWithDirection: boolean;
  /** 이미지 센터에서 총구 끝까지의 거리(px). 총구 이펙트 원점 계산에 사용. */
  muzzleFromCenter: number;
};

export type WeaponFireStyle =
  | "generic_line"
  | "paws_pulse"
  | "muzzle_flash"
  | "flame_stream";

export type WeaponImpactStyle =
  | "generic_spark"
  | "acorn_spark"
  | "paws_dust";

export function ensureWeaponPickupTextures(scene: Phaser.Scene) {
  if (!scene.textures.exists(ACORN_PICKUP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawAcornBlasterPickupTexture(graphics);
    graphics.generateTexture(ACORN_PICKUP_TEXTURE_KEY, 56, 40);
    graphics.destroy();
  }

  if (!scene.textures.exists(ACORN_EQUIP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawAcornBlasterEquipTexture(graphics);
    graphics.generateTexture(ACORN_EQUIP_TEXTURE_KEY, 28, 20);
    graphics.destroy();
  }

  if (!scene.textures.exists(EMBER_SPRINKLER_PICKUP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawEmberSprinklerPickupTexture(graphics);
    graphics.generateTexture(EMBER_SPRINKLER_PICKUP_TEXTURE_KEY, 56, 40);
    graphics.destroy();
  }

  if (!scene.textures.exists(EMBER_SPRINKLER_EQUIP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawEmberSprinklerEquipTexture(graphics);
    graphics.generateTexture(EMBER_SPRINKLER_EQUIP_TEXTURE_KEY, 36, 20);
    graphics.destroy();
  }
}

export function resolveWeaponPickupPresentation(
  weaponId: string,
): WeaponPickupPresentation {
  if (weaponId === "acorn_blaster") {
    return {
      textureKey: ACORN_PICKUP_TEXTURE_KEY,
      code: "AB",
      showNameLabel: false,
    };
  }

  if (weaponId === "ember_sprinkler") {
    return {
      textureKey: EMBER_SPRINKLER_PICKUP_TEXTURE_KEY,
      code: "ES",
      showNameLabel: false,
    };
  }

  return {
    textureKey: null,
    code: abbreviateWeaponCode(weaponId),
    showNameLabel: true,
  };
}

export function weaponPickupAccentColor(source: WeaponPickupSource): number {
  switch (source) {
    case "spawn":
      return 0x38bdf8;
    case "dropped":
      return 0xf97316;
    case "reward":
      return 0xfacc15;
  }
}

export function resolveWeaponEquipPresentation(
  weaponId: string,
): WeaponEquipPresentation {
  if (weaponId === "acorn_blaster") {
    return {
      textureKey: ACORN_EQUIP_TEXTURE_KEY,
      offsetX: 13,
      offsetY: 1,
      flipWithDirection: true,
      // 텍스처 28px, 이미지 센터 x=14, 총구 끝 x=24 → 총구까지 10px
      muzzleFromCenter: 10,
    };
  }

  if (weaponId === "ember_sprinkler") {
    return {
      textureKey: EMBER_SPRINKLER_EQUIP_TEXTURE_KEY,
      offsetX: 13,
      offsetY: 2,
      flipWithDirection: true,
      // 캔버스 36px, 센터 x=18, 노즐 출구 x=33 → 센터에서 15px
      muzzleFromCenter: 15,
    };
  }

  return {
    textureKey: null,
    offsetX: 0,
    offsetY: 0,
    flipWithDirection: false,
    muzzleFromCenter: 0,
  };
}

export function resolveWeaponFireStyle(weaponId: string): WeaponFireStyle {
  if (weaponId === "acorn_blaster") {
    return "muzzle_flash";
  }

  if (weaponId === "paws") {
    return "paws_pulse";
  }

  if (weaponId === "ember_sprinkler") {
    return "flame_stream";
  }

  return "generic_line";
}

export function resolveWeaponImpactStyle(weaponId: string): WeaponImpactStyle {
  if (weaponId === "acorn_blaster") {
    return "acorn_spark";
  }

  if (weaponId === "paws") {
    return "paws_dust";
  }

  return "generic_spark";
}

// ── HUD 무기 아이콘 ──────────────────────────────────────────────────────

export function ensureWeaponHudTextures(scene: Phaser.Scene) {
  for (const weaponId of Object.keys(weaponDefinitionById)) {
    const key = `${WEAPON_HUD_ICON_PREFIX}-${weaponId}`;
    if (scene.textures.exists(key)) continue;
    const g = new Phaser.GameObjects.Graphics(scene);
    if (weaponId === "paws") drawPawsHudIcon(g);
    else if (weaponId === "acorn_blaster") drawAcornBlasterHudIcon(g);
    else if (weaponId === "ember_sprinkler") drawEmberSprinklerHudIcon(g);
    else drawFallbackHudIcon(g);
    g.generateTexture(key, HUD_ICON_SIZE, HUD_ICON_SIZE);
    g.destroy();
  }
}

export function getWeaponHudTextureKey(weaponId: string): string {
  const key = `${WEAPON_HUD_ICON_PREFIX}-${weaponId}`;
  return key;
}

function drawPawsHudIcon(g: Phaser.GameObjects.Graphics) {
  g.clear();
  // 손바닥 베이스
  g.fillStyle(0xd4a574, 1);
  g.fillCircle(12, 15, 8);
  // 너클 4개
  g.fillStyle(0xe8c49a, 1);
  for (let i = 0; i < 4; i++) {
    g.fillCircle(4.5 + i * 4.5, 8.5, 2.8);
  }
  // 아웃라인
  g.lineStyle(1.5, 0x7a3f1e, 1);
  g.strokeCircle(12, 15, 8);
  for (let i = 0; i < 4; i++) {
    g.strokeCircle(4.5 + i * 4.5, 8.5, 2.8);
  }
}

function drawAcornBlasterHudIcon(g: Phaser.GameObjects.Graphics) {
  g.clear();
  // 총신
  g.fillStyle(0x7c4a2c, 1);
  g.fillRoundedRect(4, 9, 15, 7, 2);
  // 총구
  g.fillStyle(0x5b3922, 1);
  g.fillRoundedRect(17, 10, 5, 4, 1);
  // 손잡이
  g.fillStyle(0x7c4a2c, 1);
  g.fillRoundedRect(7, 15, 5, 7, 1);
  // 악센트 포인트
  g.fillStyle(0x38bdf8, 1);
  g.fillCircle(5, 12, 2);
  // 아웃라인
  g.lineStyle(1.5, 0x2f1d12, 1);
  g.strokeRoundedRect(4, 9, 15, 7, 2);
  g.strokeRoundedRect(7, 15, 5, 7, 1);
}

function drawFallbackHudIcon(g: Phaser.GameObjects.Graphics) {
  g.clear();
  g.fillStyle(0x555555, 1);
  g.fillCircle(12, 12, 10);
  g.lineStyle(1.5, 0x888888, 1);
  g.strokeCircle(12, 12, 10);
}

function drawEmberSprinklerHudIcon(g: Phaser.GameObjects.Graphics) {
  g.clear();
  // 탱크 몸체
  g.fillStyle(0xea580c, 1);
  g.fillRoundedRect(1, 9, 16, 10, 3);
  // 탱크 하단 음영
  g.fillStyle(0xc2410c, 1);
  g.fillRoundedRect(1, 15, 16, 4, 3);
  // 탱크 아웃라인
  g.lineStyle(1.5, 0x7c2d12, 1);
  g.strokeRoundedRect(1, 9, 16, 10, 3);
  // 노즐
  g.fillStyle(0x9a3412, 1);
  g.fillRoundedRect(17, 11, 5, 6, 1);
  g.lineStyle(1, 0x7c2d12, 1);
  g.strokeRoundedRect(17, 11, 5, 6, 1);
  // 화염: 노란 코어
  g.fillStyle(0xfde047, 0.95);
  g.fillEllipse(24, 11, 4, 3);
  // 화염: 주황
  g.fillStyle(0xfb923c, 0.88);
  g.fillEllipse(24, 14, 4, 4);
  // 화염: 붉은 외곽
  g.fillStyle(0xef4444, 0.8);
  g.fillEllipse(23, 17, 4, 3);
}

function abbreviateWeaponCode(weaponId: string): string {
  const fallbackName = weaponDefinitionById[weaponId]?.name ?? weaponId;
  const parts = fallbackName
    .split(/[\s_-]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return parts
      .slice(0, 3)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }

  return fallbackName.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase();
}

function drawAcornBlasterPickupTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();

  const outline = 0x4a2f1b;
  const crate = 0x7c4a2c;
  const crateShade = 0x60361d;
  const acornCap = 0x8a5a36;
  const acornBody = 0xc88a4a;
  const acornHighlight = 0xf5c67a;

  graphics.fillStyle(crate, 1);
  graphics.fillRoundedRect(8, 9, 40, 22, 6);

  graphics.fillStyle(crateShade, 1);
  graphics.fillRoundedRect(8, 24, 40, 7, 6);
  graphics.fillRect(17, 9, 5, 22);
  graphics.fillRect(34, 9, 5, 22);

  graphics.lineStyle(2, outline, 1);
  graphics.strokeRoundedRect(8, 9, 40, 22, 6);
  graphics.lineBetween(17, 10, 17, 30);
  graphics.lineBetween(39, 10, 39, 30);

  graphics.fillStyle(acornCap, 1);
  graphics.fillEllipse(28, 15, 13, 8);
  graphics.fillStyle(acornBody, 1);
  graphics.fillEllipse(28, 20.5, 11, 12);
  graphics.fillStyle(acornHighlight, 0.9);
  graphics.fillEllipse(26, 20, 3.5, 5.5);

  graphics.fillStyle(outline, 1);
  graphics.fillRect(27, 8, 2, 4);
}

function drawAcornBlasterEquipTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();

  const outline = 0x2f1d12;
  const barrel = 0x7c4a2c;
  const barrelHighlight = 0xc88a4a;
  const grip = 0x5b3922;
  const accent = 0x38bdf8;

  graphics.fillStyle(barrel, 1);
  graphics.fillRoundedRect(8, 7, 12, 5, 2);
  graphics.fillStyle(barrelHighlight, 1);
  graphics.fillRoundedRect(18, 8, 6, 3, 1);

  graphics.fillStyle(grip, 1);
  graphics.fillRoundedRect(10, 11, 4, 7, 1);

  graphics.fillStyle(accent, 1);
  graphics.fillCircle(8, 9.5, 2.2);

  graphics.lineStyle(1.5, outline, 1);
  graphics.strokeRoundedRect(8, 7, 12, 5, 2);
  graphics.strokeRoundedRect(10, 11, 4, 7, 1);
}

function drawEmberSprinklerEquipTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();

  // 탱크 몸체 — 가로형 실린더 (36×20 캔버스, 오른쪽 방향 기준)
  graphics.fillStyle(0xea580c, 1);
  graphics.fillRoundedRect(1, 3, 20, 14, 4);

  // 하단 음영
  graphics.fillStyle(0xc2410c, 1);
  graphics.fillRoundedRect(1, 12, 20, 5, 4);

  // 탱크 아웃라인
  graphics.lineStyle(1.5, 0x7c2d12, 1);
  graphics.strokeRoundedRect(1, 3, 20, 14, 4);

  // 노즐 연결부
  graphics.fillStyle(0x9a3412, 1);
  graphics.fillRoundedRect(21, 6, 11, 5, 2);
  graphics.lineStyle(1, 0x7c2d12, 1);
  graphics.strokeRoundedRect(21, 6, 11, 5, 2);

  // 노즐 출구 화염 점 (muzzleFromCenter 기준점: x=33)
  graphics.fillStyle(0xfde047, 0.9);
  graphics.fillEllipse(33, 7, 3, 3);
  graphics.fillStyle(0xfb923c, 0.75);
  graphics.fillEllipse(33, 11, 3, 3);
}

function drawEmberSprinklerPickupTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();

  const outline = 0x7c2d12;
  const tankBody = 0xea580c;
  const tankShade = 0xc2410c;
  const nozzleColor = 0x9a3412;

  // 탱크 몸체
  graphics.fillStyle(tankBody, 1);
  graphics.fillRoundedRect(4, 10, 32, 22, 6);

  // 탱크 하단 음영
  graphics.fillStyle(tankShade, 1);
  graphics.fillRoundedRect(4, 24, 32, 8, 6);

  // 탱크 세로 구분선
  graphics.fillStyle(tankShade, 1);
  graphics.fillRect(18, 10, 4, 22);

  // 탱크 아웃라인
  graphics.lineStyle(2, outline, 1);
  graphics.strokeRoundedRect(4, 10, 32, 22, 6);
  graphics.lineBetween(18, 11, 18, 31);
  graphics.lineBetween(22, 11, 22, 31);

  // 노즐 베이스
  graphics.fillStyle(nozzleColor, 1);
  graphics.fillRoundedRect(36, 15, 14, 8, 2);
  graphics.lineStyle(1.5, outline, 1);
  graphics.strokeRoundedRect(36, 15, 14, 8, 2);

  // 화염: 노란 코어
  graphics.fillStyle(0xfde047, 0.95);
  graphics.fillEllipse(53, 15, 5, 4);
  graphics.fillEllipse(54, 22, 4, 3);

  // 화염: 주황
  graphics.fillStyle(0xfb923c, 0.9);
  graphics.fillEllipse(51, 19, 7, 5);

  // 화염: 붉은 외곽
  graphics.fillStyle(0xef4444, 0.82);
  graphics.fillEllipse(49, 19, 5, 4);
}
