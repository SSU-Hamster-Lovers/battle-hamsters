import Phaser from "phaser";
import { weaponDefinitionById } from "@battle-hamsters/shared";

const WEAPON_HUD_ICON_PREFIX = "weapon-hud-icon";
const HUD_ICON_SIZE = 24;

const WEAPON_PICKUP_TEXTURE_PREFIX = "weapon-pickup";
const ACORN_PICKUP_TEXTURE_KEY = `${WEAPON_PICKUP_TEXTURE_PREFIX}-acorn-blaster`;
const EMBER_SPRINKLER_PICKUP_TEXTURE_KEY = `${WEAPON_PICKUP_TEXTURE_PREFIX}-ember-sprinkler`;
const SEED_SHOTGUN_PICKUP_TEXTURE_KEY = `${WEAPON_PICKUP_TEXTURE_PREFIX}-seed-shotgun`;
const WALNUT_CANNON_PICKUP_TEXTURE_KEY = `${WEAPON_PICKUP_TEXTURE_PREFIX}-walnut-cannon`;
const WEAPON_EQUIP_TEXTURE_PREFIX = "weapon-equip";
const ACORN_EQUIP_TEXTURE_KEY = `${WEAPON_EQUIP_TEXTURE_PREFIX}-acorn-blaster`;
const EMBER_SPRINKLER_EQUIP_TEXTURE_KEY = `${WEAPON_EQUIP_TEXTURE_PREFIX}-ember-sprinkler`;
const SEED_SHOTGUN_EQUIP_TEXTURE_KEY = `${WEAPON_EQUIP_TEXTURE_PREFIX}-seed-shotgun`;
const WALNUT_CANNON_EQUIP_TEXTURE_KEY = `${WEAPON_EQUIP_TEXTURE_PREFIX}-walnut-cannon`;
const PINE_SNIPER_PICKUP_TEXTURE_KEY = `${WEAPON_PICKUP_TEXTURE_PREFIX}-pine-sniper`;
const PINE_SNIPER_EQUIP_TEXTURE_KEY = `${WEAPON_EQUIP_TEXTURE_PREFIX}-pine-sniper`;
const SQUIRREL_GATLING_PICKUP_TEXTURE_KEY = `${WEAPON_PICKUP_TEXTURE_PREFIX}-squirrel-gatling`;
const SQUIRREL_GATLING_EQUIP_TEXTURE_KEY = `${WEAPON_EQUIP_TEXTURE_PREFIX}-squirrel-gatling`;
const BLUEBERRY_MORTAR_PICKUP_TEXTURE_KEY = `${WEAPON_PICKUP_TEXTURE_PREFIX}-blueberry-mortar`;
const BLUEBERRY_MORTAR_EQUIP_TEXTURE_KEY = `${WEAPON_EQUIP_TEXTURE_PREFIX}-blueberry-mortar`;

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
  | "flame_stream"
  | "shotgun_spread"
  | "cannon_blast"
  | "sniper_flash"
  | "auto_flash"
  | "mortar_arc";

export type WeaponImpactStyle =
  | "generic_spark"
  | "acorn_spark"
  | "paws_dust"
  | "seed_burst"
  | "cannon_impact"
  | "explosion_burst";

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

  if (!scene.textures.exists(SEED_SHOTGUN_PICKUP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawSeedShotgunPickupTexture(graphics);
    graphics.generateTexture(SEED_SHOTGUN_PICKUP_TEXTURE_KEY, 60, 36);
    graphics.destroy();
  }

  if (!scene.textures.exists(SEED_SHOTGUN_EQUIP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawSeedShotgunEquipTexture(graphics);
    graphics.generateTexture(SEED_SHOTGUN_EQUIP_TEXTURE_KEY, 40, 14);
    graphics.destroy();
  }

  if (!scene.textures.exists(WALNUT_CANNON_PICKUP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawWalnutCannonPickupTexture(graphics);
    graphics.generateTexture(WALNUT_CANNON_PICKUP_TEXTURE_KEY, 56, 40);
    graphics.destroy();
  }

  if (!scene.textures.exists(WALNUT_CANNON_EQUIP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawWalnutCannonEquipTexture(graphics);
    graphics.generateTexture(WALNUT_CANNON_EQUIP_TEXTURE_KEY, 32, 18);
    graphics.destroy();
  }

  if (!scene.textures.exists(PINE_SNIPER_PICKUP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawPineSniperPickupTexture(graphics);
    graphics.generateTexture(PINE_SNIPER_PICKUP_TEXTURE_KEY, 72, 40);
    graphics.destroy();
  }

  if (!scene.textures.exists(PINE_SNIPER_EQUIP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawPineSniperEquipTexture(graphics);
    graphics.generateTexture(PINE_SNIPER_EQUIP_TEXTURE_KEY, 52, 16);
    graphics.destroy();
  }

  if (!scene.textures.exists(SQUIRREL_GATLING_PICKUP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawSquirrelGatlingPickupTexture(graphics);
    graphics.generateTexture(SQUIRREL_GATLING_PICKUP_TEXTURE_KEY, 64, 40);
    graphics.destroy();
  }

  if (!scene.textures.exists(SQUIRREL_GATLING_EQUIP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawSquirrelGatlingEquipTexture(graphics);
    graphics.generateTexture(SQUIRREL_GATLING_EQUIP_TEXTURE_KEY, 40, 16);
    graphics.destroy();
  }

  if (!scene.textures.exists(BLUEBERRY_MORTAR_PICKUP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawBlueberryMortarPickupTexture(graphics);
    graphics.generateTexture(BLUEBERRY_MORTAR_PICKUP_TEXTURE_KEY, 60, 40);
    graphics.destroy();
  }

  if (!scene.textures.exists(BLUEBERRY_MORTAR_EQUIP_TEXTURE_KEY)) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawBlueberryMortarEquipTexture(graphics);
    graphics.generateTexture(BLUEBERRY_MORTAR_EQUIP_TEXTURE_KEY, 36, 18);
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

  if (weaponId === "seed_shotgun") {
    return {
      textureKey: SEED_SHOTGUN_PICKUP_TEXTURE_KEY,
      code: "SS",
      showNameLabel: false,
    };
  }

  if (weaponId === "walnut_cannon") {
    return {
      textureKey: WALNUT_CANNON_PICKUP_TEXTURE_KEY,
      code: "WC",
      showNameLabel: false,
    };
  }

  if (weaponId === "pine_sniper") {
    return {
      textureKey: PINE_SNIPER_PICKUP_TEXTURE_KEY,
      code: "PS",
      showNameLabel: false,
    };
  }

  if (weaponId === "squirrel_gatling") {
    return {
      textureKey: SQUIRREL_GATLING_PICKUP_TEXTURE_KEY,
      code: "SG",
      showNameLabel: false,
    };
  }

  if (weaponId === "blueberry_mortar") {
    return {
      textureKey: BLUEBERRY_MORTAR_PICKUP_TEXTURE_KEY,
      code: "BM",
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

  if (weaponId === "seed_shotgun") {
    return {
      textureKey: SEED_SHOTGUN_EQUIP_TEXTURE_KEY,
      offsetX: 14,
      offsetY: 1,
      flipWithDirection: true,
      // 캔버스 40px, 센터 x=20, 총구 x=37 → 17px
      muzzleFromCenter: 17,
    };
  }

  if (weaponId === "walnut_cannon") {
    return {
      textureKey: WALNUT_CANNON_EQUIP_TEXTURE_KEY,
      offsetX: 12,
      offsetY: 2,
      flipWithDirection: true,
      // 캔버스 32px, 센터 x=16, 포구 x=28 → 12px
      muzzleFromCenter: 12,
    };
  }

  if (weaponId === "squirrel_gatling") {
    return {
      textureKey: SQUIRREL_GATLING_EQUIP_TEXTURE_KEY,
      offsetX: 12,
      offsetY: 1,
      flipWithDirection: true,
      // 캔버스 40px, 센터 x=20, 총구 x=37 → 17px
      muzzleFromCenter: 17,
    };
  }

  if (weaponId === "blueberry_mortar") {
    return {
      textureKey: BLUEBERRY_MORTAR_EQUIP_TEXTURE_KEY,
      offsetX: 10,
      offsetY: 2,
      flipWithDirection: true,
      // 캔버스 36px, 센터 x=18, 발사관 끝 x=32 → 14px
      muzzleFromCenter: 14,
    };
  }

  if (weaponId === "pine_sniper") {
    return {
      textureKey: PINE_SNIPER_EQUIP_TEXTURE_KEY,
      offsetX: 14,
      offsetY: 1,
      flipWithDirection: true,
      // 캔버스 52px, 센터 x=26, 총구 x=48 → 22px
      muzzleFromCenter: 22,
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

  if (weaponId === "seed_shotgun") {
    return "shotgun_spread";
  }

  if (weaponId === "walnut_cannon") {
    return "cannon_blast";
  }

  if (weaponId === "pine_sniper") {
    return "sniper_flash";
  }

  if (weaponId === "squirrel_gatling") {
    return "auto_flash";
  }

  if (weaponId === "blueberry_mortar") {
    return "mortar_arc";
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

  if (weaponId === "seed_shotgun") {
    return "seed_burst";
  }

  if (weaponId === "walnut_cannon") {
    return "cannon_impact";
  }

  if (weaponId === "blueberry_mortar") {
    return "explosion_burst";
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
    else if (weaponId === "seed_shotgun") drawSeedShotgunHudIcon(g);
    else if (weaponId === "walnut_cannon") drawWalnutCannonHudIcon(g);
    else if (weaponId === "pine_sniper") drawPineSniperHudIcon(g);
    else if (weaponId === "squirrel_gatling") drawSquirrelGatlingHudIcon(g);
    else if (weaponId === "blueberry_mortar") drawBlueberryMortarHudIcon(g);
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

// ── 씨앗 샷건 (seed_shotgun) ─────────────────────────────────────────────

function drawSeedShotgunHudIcon(g: Phaser.GameObjects.Graphics) {
  g.clear();
  const wood = 0x8b5e3c;
  const darkWood = 0x5a3822;
  const pump = 0x6b4226;
  const seedGreen = 0x55cc44;

  // 총신 (가로형)
  g.fillStyle(wood, 1);
  g.fillRoundedRect(3, 9, 17, 5, 2);
  // 총구 끝 (더 짧고 굵게)
  g.fillStyle(darkWood, 1);
  g.fillRoundedRect(19, 10, 3, 3, 1);
  // 개머리판
  g.fillStyle(wood, 1);
  g.fillRoundedRect(1, 8, 5, 7, 2);
  // 펌프
  g.fillStyle(pump, 1);
  g.fillRoundedRect(8, 13, 7, 3, 1);
  // 씨앗 도트
  g.fillStyle(seedGreen, 1);
  g.fillCircle(14, 11, 2);
  // 아웃라인
  g.lineStyle(1.5, darkWood, 1);
  g.strokeRoundedRect(3, 9, 17, 5, 2);
  g.strokeRoundedRect(1, 8, 5, 7, 2);
}

function drawSeedShotgunEquipTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();
  const wood = 0x8b5e3c;
  const darkWood = 0x5a3822;
  const pump = 0x6b4226;
  const seedGreen = 0x55cc44;

  // 개머리판 (왼쪽)
  graphics.fillStyle(wood, 1);
  graphics.fillRoundedRect(0, 2, 8, 10, 2);
  // 총신 (메인)
  graphics.fillStyle(wood, 1);
  graphics.fillRoundedRect(6, 3, 28, 6, 2);
  // 총구 (오른쪽 끝, 살짝 어둡게)
  graphics.fillStyle(darkWood, 1);
  graphics.fillRoundedRect(33, 4, 5, 4, 1);
  // 펌프 (총신 아래)
  graphics.fillStyle(pump, 1);
  graphics.fillRoundedRect(14, 8, 10, 4, 1);
  // 씨앗 도트
  graphics.fillStyle(seedGreen, 1);
  graphics.fillCircle(24, 6, 1.5);
  // 아웃라인
  graphics.lineStyle(1.5, darkWood, 1);
  graphics.strokeRoundedRect(6, 3, 28, 6, 2);
  graphics.strokeRoundedRect(0, 2, 8, 10, 2);
}

function drawSeedShotgunPickupTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();
  const wood = 0x8b5e3c;
  const woodLight = 0xb8844e;
  const darkWood = 0x5a3822;
  const pump = 0x6b4226;
  const seedGreen = 0x55cc44;
  const seedDark = 0x3d8a2e;

  // 개머리판
  graphics.fillStyle(wood, 1);
  graphics.fillRoundedRect(2, 8, 14, 22, 4);
  graphics.fillStyle(woodLight, 1);
  graphics.fillRoundedRect(4, 10, 10, 8, 2);
  graphics.lineStyle(2, darkWood, 1);
  graphics.strokeRoundedRect(2, 8, 14, 22, 4);

  // 총신
  graphics.fillStyle(wood, 1);
  graphics.fillRoundedRect(14, 11, 34, 12, 3);
  graphics.fillStyle(woodLight, 0.5);
  graphics.fillRoundedRect(16, 12, 30, 4, 2);
  graphics.lineStyle(2, darkWood, 1);
  graphics.strokeRoundedRect(14, 11, 34, 12, 3);

  // 펌프 (총신 아래)
  graphics.fillStyle(pump, 1);
  graphics.fillRoundedRect(22, 22, 16, 7, 2);
  graphics.lineStyle(1.5, darkWood, 1);
  graphics.strokeRoundedRect(22, 22, 16, 7, 2);

  // 총구 마개
  graphics.fillStyle(darkWood, 1);
  graphics.fillRoundedRect(47, 12, 8, 10, 2);
  graphics.lineStyle(1.5, darkWood, 1);
  graphics.strokeRoundedRect(47, 12, 8, 10, 2);

  // 씨앗 도트 3개
  graphics.fillStyle(seedGreen, 1);
  graphics.fillCircle(30, 17, 3.5);
  graphics.fillCircle(38, 17, 3.5);
  graphics.fillStyle(seedDark, 0.6);
  graphics.fillCircle(30, 17, 1.5);
  graphics.fillCircle(38, 17, 1.5);
}

// ── 호두 대포 (walnut_cannon) ─────────────────────────────────────────────

function drawWalnutCannonHudIcon(g: Phaser.GameObjects.Graphics) {
  g.clear();
  const barrel = 0xc8a05a;
  const barrelDark = 0x8b6040;
  const wheel = 0x706050;
  const wheelDark = 0x4a3830;
  const walnut = 0xb8834a;

  // 포 바퀴 (좌우)
  g.fillStyle(wheel, 1);
  g.fillCircle(5, 18, 4);
  g.fillCircle(18, 18, 4);
  g.lineStyle(1.5, wheelDark, 1);
  g.strokeCircle(5, 18, 4);
  g.strokeCircle(18, 18, 4);
  // 바퀴 살
  g.lineStyle(1, wheelDark, 0.7);
  g.lineBetween(5, 14, 5, 22);
  g.lineBetween(1, 18, 9, 18);
  g.lineBetween(18, 14, 18, 22);
  g.lineBetween(14, 18, 22, 18);
  // 포신
  g.fillStyle(barrel, 1);
  g.fillRoundedRect(3, 7, 18, 9, 3);
  // 포신 어두운 면
  g.fillStyle(barrelDark, 1);
  g.fillRoundedRect(3, 13, 18, 3, 3);
  // 포구 링
  g.lineStyle(2, barrelDark, 1);
  g.strokeRoundedRect(3, 7, 18, 9, 3);
  // 호두 그림 (포신 위)
  g.fillStyle(walnut, 1);
  g.fillEllipse(12, 10, 8, 6);
  g.lineStyle(1, barrelDark, 0.8);
  g.strokeEllipse(12, 10, 8, 6);
}

function drawWalnutCannonEquipTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();
  const barrel = 0xc8a05a;
  const barrelDark = 0x8b6040;
  const ring = 0x706050;

  // 포신 몸체 (짧고 굵음)
  graphics.fillStyle(barrel, 1);
  graphics.fillRoundedRect(2, 3, 24, 10, 3);
  // 어두운 하단 면
  graphics.fillStyle(barrelDark, 1);
  graphics.fillRoundedRect(2, 10, 24, 3, 3);
  // 포구 링 (오른쪽 끝)
  graphics.fillStyle(ring, 1);
  graphics.fillRoundedRect(25, 4, 5, 8, 2);
  // 장약 링 (포신 1/3 지점)
  graphics.fillStyle(ring, 0.8);
  graphics.fillRoundedRect(8, 3, 4, 10, 1);
  // 아웃라인
  graphics.lineStyle(1.5, barrelDark, 1);
  graphics.strokeRoundedRect(2, 3, 24, 10, 3);
  graphics.strokeRoundedRect(25, 4, 5, 8, 2);
}

function drawWalnutCannonPickupTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();
  const barrel = 0xc8a05a;
  const barrelLight = 0xe0c08a;
  const barrelDark = 0x8b6040;
  const ring = 0x706050;
  const ringDark = 0x4a3830;
  const walnut = 0xb8834a;
  const walnutDark = 0x7a5030;

  // 바퀴 (왼쪽)
  graphics.fillStyle(ring, 1);
  graphics.fillCircle(8, 30, 9);
  graphics.lineStyle(2, ringDark, 1);
  graphics.strokeCircle(8, 30, 9);
  // 바퀴 살
  graphics.lineStyle(1.5, ringDark, 0.7);
  graphics.lineBetween(8, 21, 8, 39);
  graphics.lineBetween(-1, 30, 17, 30);
  graphics.lineBetween(2, 24, 14, 36);
  graphics.lineBetween(14, 24, 2, 36);

  // 바퀴 (오른쪽)
  graphics.fillStyle(ring, 1);
  graphics.fillCircle(48, 30, 9);
  graphics.lineStyle(2, ringDark, 1);
  graphics.strokeCircle(48, 30, 9);
  graphics.lineStyle(1.5, ringDark, 0.7);
  graphics.lineBetween(48, 21, 48, 39);
  graphics.lineBetween(39, 30, 57, 30);
  graphics.lineBetween(42, 24, 54, 36);
  graphics.lineBetween(54, 24, 42, 36);

  // 포신 몸체
  graphics.fillStyle(barrel, 1);
  graphics.fillRoundedRect(10, 9, 36, 16, 5);
  // 포신 하이라이트
  graphics.fillStyle(barrelLight, 0.6);
  graphics.fillRoundedRect(12, 10, 32, 5, 3);
  // 포신 어두운 면
  graphics.fillStyle(barrelDark, 0.7);
  graphics.fillRoundedRect(10, 21, 36, 4, 5);

  // 포신 장약 링 2개
  graphics.fillStyle(ring, 1);
  graphics.fillRoundedRect(15, 9, 5, 16, 2);
  graphics.fillRoundedRect(24, 9, 5, 16, 2);
  graphics.lineStyle(1, ringDark, 0.7);
  graphics.strokeRoundedRect(15, 9, 5, 16, 2);
  graphics.strokeRoundedRect(24, 9, 5, 16, 2);

  // 포구 마개
  graphics.fillStyle(ring, 1);
  graphics.fillRoundedRect(43, 10, 10, 14, 3);
  graphics.lineStyle(1.5, ringDark, 1);
  graphics.strokeRoundedRect(43, 10, 10, 14, 3);

  // 포신 아웃라인
  graphics.lineStyle(2, barrelDark, 1);
  graphics.strokeRoundedRect(10, 9, 36, 16, 5);

  // 호두 아이콘 (포신 중앙)
  graphics.fillStyle(walnut, 1);
  graphics.fillEllipse(32, 17, 14, 10);
  graphics.lineStyle(1.5, walnutDark, 1);
  graphics.strokeEllipse(32, 17, 14, 10);
  // 호두 결 선
  graphics.lineStyle(1, walnutDark, 0.6);
  graphics.lineBetween(32, 12, 32, 22);
  graphics.lineBetween(27, 14, 37, 20);
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

// ── 솔방울 저격총 (pine_sniper) ─────────────────────────────────────────────

function drawPineSniperHudIcon(g: Phaser.GameObjects.Graphics) {
  g.clear();

  // 총신 (얇고 긴)
  g.fillStyle(0x708090, 1);
  g.fillRoundedRect(3, 10, 19, 3, 1);
  // 총신 상단 하이라이트
  g.fillStyle(0xa0b0c0, 0.6);
  g.fillRoundedRect(3, 10, 19, 1, 1);
  // 총구 캡
  g.fillStyle(0x4a5568, 1);
  g.fillRoundedRect(21, 10, 2, 3, 1);
  // 스코프
  g.fillStyle(0x374151, 1);
  g.fillRoundedRect(9, 7, 9, 3, 1);
  // 스코프 렌즈
  g.fillStyle(0x7dd3fc, 0.9);
  g.fillCircle(13, 8, 1.5);
  // 솔방울 개머리판 몸체
  g.fillStyle(0x8b5e3c, 1);
  g.fillEllipse(4, 13, 7, 8);
  // 솔방울 음영
  g.fillStyle(0x5b3922, 0.6);
  g.fillEllipse(4, 15, 6, 4);
  // 솔방울 꼭지
  g.fillStyle(0x4a3020, 1);
  g.fillEllipse(4, 9, 3, 3);
  // 솔방울 비늘 선
  g.lineStyle(0.8, 0x5b3922, 0.7);
  g.lineBetween(2, 11, 6, 13);
  g.lineBetween(2, 13, 6, 15);
  // 아웃라인
  g.lineStyle(1.5, 0x2f3f50, 1);
  g.strokeRoundedRect(3, 10, 19, 3, 1);
}

function drawPineSniperEquipTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();

  // 솔방울 개머리판
  graphics.fillStyle(0x8b5e3c, 1);
  graphics.fillEllipse(6, 8, 12, 14);
  // 솔방울 음영
  graphics.fillStyle(0x5b3922, 0.55);
  graphics.fillEllipse(6, 11, 10, 6);
  // 솔방울 꼭지
  graphics.fillStyle(0x4a3020, 1);
  graphics.fillEllipse(6, 2, 4, 4);
  // 솔방울 비늘 선
  graphics.lineStyle(0.8, 0x5b3922, 0.7);
  graphics.lineBetween(2, 5, 9, 8);
  graphics.lineBetween(2, 8, 10, 11);
  graphics.lineBetween(3, 11, 10, 13);
  // 개머리판 아웃라인
  graphics.lineStyle(1.5, 0x2f1d12, 1);
  graphics.strokeEllipse(6, 8, 12, 14);

  // 총신 (긴, 가늘게)
  graphics.fillStyle(0x708090, 1);
  graphics.fillRoundedRect(8, 5, 40, 5, 1);
  // 총신 상단 하이라이트
  graphics.fillStyle(0xa8b8c8, 0.55);
  graphics.fillRoundedRect(8, 5, 40, 1, 1);
  // 총신 아웃라인
  graphics.lineStyle(1.5, 0x2f3f50, 1);
  graphics.strokeRoundedRect(8, 5, 40, 5, 1);

  // 총구 캡
  graphics.fillStyle(0x4a5568, 1);
  graphics.fillRoundedRect(47, 4, 4, 7, 1);
  graphics.lineStyle(1, 0x2f3f50, 1);
  graphics.strokeRoundedRect(47, 4, 4, 7, 1);

  // 스코프 바디
  graphics.fillStyle(0x374151, 1);
  graphics.fillRoundedRect(18, 2, 14, 4, 1);
  graphics.lineStyle(1, 0x1f2937, 1);
  graphics.strokeRoundedRect(18, 2, 14, 4, 1);
  // 스코프 렌즈
  graphics.fillStyle(0x7dd3fc, 0.85);
  graphics.fillCircle(24, 4, 1.5);
}

function drawPineSniperPickupTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();

  const barrelColor = 0x708090;
  const barrelHighlight = 0xa8b8c8;
  const barrelDark = 0x2f3f50;
  const muzzleColor = 0x4a5568;
  const scopeColor = 0x374151;
  const scopeDark = 0x1f2937;
  const pineconeBody = 0x8b5e3c;
  const pineconeDark = 0x5b3922;
  const pineconeDeep = 0x3d2510;

  // 솔방울 개머리판 몸체
  graphics.fillStyle(pineconeBody, 1);
  graphics.fillEllipse(10, 24, 18, 28);

  // 솔방울 하단 음영
  graphics.fillStyle(pineconeDark, 0.6);
  graphics.fillEllipse(10, 30, 14, 12);

  // 솔방울 비늘 (3단)
  graphics.fillStyle(pineconeDark, 0.75);
  graphics.fillRoundedRect(3, 14, 6, 4, 2);
  graphics.fillRoundedRect(9, 14, 6, 4, 2);
  graphics.fillRoundedRect(3, 19, 6, 4, 2);
  graphics.fillRoundedRect(9, 19, 6, 4, 2);
  graphics.fillRoundedRect(4, 24, 6, 4, 2);
  graphics.fillRoundedRect(10, 24, 6, 4, 2);

  // 솔방울 꼭지
  graphics.fillStyle(pineconeDeep, 1);
  graphics.fillEllipse(10, 10, 6, 7);
  graphics.fillStyle(pineconeDark, 1);
  graphics.fillEllipse(10, 12, 5, 5);

  // 솔방울 아웃라인
  graphics.lineStyle(1.5, pineconeDeep, 1);
  graphics.strokeEllipse(10, 24, 18, 28);

  // 총신 (긴 파이프)
  graphics.fillStyle(barrelColor, 1);
  graphics.fillRoundedRect(14, 15, 54, 8, 2);

  // 총신 상단 하이라이트
  graphics.fillStyle(barrelHighlight, 0.5);
  graphics.fillRoundedRect(14, 15, 54, 2, 1);

  // 총신 하단 음영
  graphics.fillStyle(barrelDark, 0.25);
  graphics.fillRoundedRect(14, 20, 54, 3, 2);

  // 총신 아웃라인
  graphics.lineStyle(1.5, barrelDark, 1);
  graphics.strokeRoundedRect(14, 15, 54, 8, 2);

  // 총구 캡
  graphics.fillStyle(muzzleColor, 1);
  graphics.fillRoundedRect(67, 14, 4, 10, 1);
  graphics.lineStyle(1, barrelDark, 1);
  graphics.strokeRoundedRect(67, 14, 4, 10, 1);

  // 스코프 바디
  graphics.fillStyle(scopeColor, 1);
  graphics.fillRoundedRect(28, 10, 22, 7, 2);
  graphics.lineStyle(1.5, scopeDark, 1);
  graphics.strokeRoundedRect(28, 10, 22, 7, 2);

  // 스코프 렌즈 (크게)
  graphics.fillStyle(0xbae6fd, 0.9);
  graphics.fillCircle(38, 13, 3);
  graphics.fillStyle(0x7dd3fc, 0.6);
  graphics.fillCircle(37, 12, 1.5);
  graphics.lineStyle(1, scopeDark, 0.8);
  graphics.strokeCircle(38, 13, 3);

  // 스코프 조준선 (십자)
  graphics.lineStyle(0.8, scopeDark, 0.5);
  graphics.lineBetween(38, 10, 38, 16);
  graphics.lineBetween(35, 13, 41, 13);
}

// ── 다람쥐 기관총 (squirrel_gatling) ─────────────────────────────────────────

function drawSquirrelGatlingHudIcon(g: Phaser.GameObjects.Graphics) {
  g.clear();
  const body = 0x8b6914;
  const bodyDark = 0x5a4209;
  const barrel = 0x6b7280;
  const barrelDark = 0x374151;
  const drum = 0xd97706;
  const drumDark = 0x92400e;

  // 드럼 탄창 (하단)
  g.fillStyle(drum, 1);
  g.fillCircle(10, 18, 5);
  g.lineStyle(1.5, drumDark, 1);
  g.strokeCircle(10, 18, 5);
  // 드럼 중심
  g.fillStyle(drumDark, 1);
  g.fillCircle(10, 18, 2);

  // 총신 (길고 얇음)
  g.fillStyle(barrel, 1);
  g.fillRoundedRect(5, 8, 17, 5, 1);
  g.fillStyle(barrelDark, 1);
  g.fillRoundedRect(5, 11, 17, 2, 1);
  g.lineStyle(1, barrelDark, 1);
  g.strokeRoundedRect(5, 8, 17, 5, 1);

  // 총기 몸체
  g.fillStyle(body, 1);
  g.fillRoundedRect(5, 11, 10, 8, 2);
  g.lineStyle(1.5, bodyDark, 1);
  g.strokeRoundedRect(5, 11, 10, 8, 2);

  // 다람쥐 꼬리 모양 개머리판 (곡선형)
  g.fillStyle(0xd4a574, 1);
  g.fillEllipse(4, 14, 5, 10);
  g.lineStyle(1, bodyDark, 1);
  g.strokeEllipse(4, 14, 5, 10);
}

function drawSquirrelGatlingEquipTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();
  const body = 0x8b6914;
  const bodyDark = 0x5a4209;
  const barrel = 0x6b7280;
  const barrelDark = 0x374151;
  const drum = 0xd97706;
  const drumDark = 0x92400e;
  const stock = 0xd4a574;
  const stockDark = 0x7a3f1e;

  // 드럼 탄창
  graphics.fillStyle(drum, 1);
  graphics.fillCircle(14, 12, 6);
  graphics.lineStyle(1.5, drumDark, 1);
  graphics.strokeCircle(14, 12, 6);
  graphics.fillStyle(drumDark, 1);
  graphics.fillCircle(14, 12, 2.5);

  // 총기 몸체
  graphics.fillStyle(body, 1);
  graphics.fillRoundedRect(8, 4, 18, 8, 2);
  graphics.fillStyle(bodyDark, 0.4);
  graphics.fillRoundedRect(8, 9, 18, 3, 2);
  graphics.lineStyle(1.5, bodyDark, 1);
  graphics.strokeRoundedRect(8, 4, 18, 8, 2);

  // 총신 (길고 얇은 관)
  graphics.fillStyle(barrel, 1);
  graphics.fillRoundedRect(20, 5, 18, 5, 1);
  graphics.fillStyle(barrelDark, 0.3);
  graphics.fillRoundedRect(20, 8, 18, 2, 1);
  graphics.lineStyle(1, barrelDark, 1);
  graphics.strokeRoundedRect(20, 5, 18, 5, 1);

  // 개머리판 (다람쥐 꼬리)
  graphics.fillStyle(stock, 1);
  graphics.fillEllipse(5, 8, 8, 12);
  graphics.lineStyle(1, stockDark, 1);
  graphics.strokeEllipse(5, 8, 8, 12);
}

function drawSquirrelGatlingPickupTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();
  const body = 0x8b6914;
  const bodyDark = 0x5a4209;
  const bodyLight = 0xb8860b;
  const barrel = 0x6b7280;
  const barrelDark = 0x374151;
  const barrelLight = 0x9ca3af;
  const drum = 0xd97706;
  const drumDark = 0x92400e;
  const drumHighlight = 0xfbbf24;
  const stock = 0xd4a574;
  const stockDark = 0x7a3f1e;

  // 드럼 탄창 (원형, 눈에 띄는 주황)
  graphics.fillStyle(drum, 1);
  graphics.fillCircle(18, 28, 10);
  graphics.fillStyle(drumHighlight, 0.4);
  graphics.fillCircle(16, 26, 5);
  graphics.lineStyle(2, drumDark, 1);
  graphics.strokeCircle(18, 28, 10);
  graphics.fillStyle(drumDark, 1);
  graphics.fillCircle(18, 28, 4);
  // 드럼 살
  graphics.lineStyle(1, drumDark, 0.6);
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI / 4) * i;
    graphics.lineBetween(
      18 + Math.cos(angle) * 4,
      28 + Math.sin(angle) * 4,
      18 + Math.cos(angle) * 10,
      28 + Math.sin(angle) * 10,
    );
  }

  // 총기 몸체
  graphics.fillStyle(body, 1);
  graphics.fillRoundedRect(10, 10, 28, 14, 4);
  graphics.fillStyle(bodyLight, 0.3);
  graphics.fillRoundedRect(10, 10, 28, 4, 4);
  graphics.fillStyle(bodyDark, 0.3);
  graphics.fillRoundedRect(10, 20, 28, 4, 4);
  graphics.lineStyle(2, bodyDark, 1);
  graphics.strokeRoundedRect(10, 10, 28, 14, 4);

  // 총신 (길고 얇음)
  graphics.fillStyle(barrel, 1);
  graphics.fillRoundedRect(30, 12, 30, 8, 2);
  graphics.fillStyle(barrelLight, 0.3);
  graphics.fillRoundedRect(30, 12, 30, 2, 1);
  graphics.fillStyle(barrelDark, 0.3);
  graphics.fillRoundedRect(30, 17, 30, 3, 2);
  graphics.lineStyle(1.5, barrelDark, 1);
  graphics.strokeRoundedRect(30, 12, 30, 8, 2);

  // 총구 (끝 캡)
  graphics.fillStyle(barrelDark, 1);
  graphics.fillRoundedRect(58, 11, 5, 10, 1);
  graphics.lineStyle(1, barrelDark, 1);
  graphics.strokeRoundedRect(58, 11, 5, 10, 1);

  // 다람쥐 꼬리 모양 개머리판
  graphics.fillStyle(stock, 1);
  graphics.fillEllipse(8, 18, 14, 20);
  graphics.lineStyle(1.5, stockDark, 1);
  graphics.strokeEllipse(8, 18, 14, 20);
  // 꼬리 줄무늬 (다람쥐 느낌)
  graphics.lineStyle(1, stockDark, 0.4);
  graphics.lineBetween(4, 14, 12, 22);
  graphics.lineBetween(4, 18, 12, 26);
}

// ── 블루베리 박격포 (blueberry_mortar) ────────────────────────────────────────

function drawBlueberryMortarHudIcon(g: Phaser.GameObjects.Graphics) {
  g.clear();
  const tube = 0x6d28d9;
  const tubeDark = 0x4c1d95;
  const base = 0x5b21b6;
  const blueberry = 0x7c3aed;
  const blueberryLight = 0xa78bfa;

  // 포신 (각도 있는 짧은 관)
  g.fillStyle(tube, 1);
  g.fillRoundedRect(8, 4, 6, 14, 2);
  g.fillStyle(tubeDark, 0.4);
  g.fillRoundedRect(10, 4, 2, 14, 1);
  g.lineStyle(1.5, tubeDark, 1);
  g.strokeRoundedRect(8, 4, 6, 14, 2);

  // 받침대
  g.fillStyle(base, 1);
  g.fillRoundedRect(3, 17, 18, 5, 2);
  g.lineStyle(1.5, tubeDark, 1);
  g.strokeRoundedRect(3, 17, 18, 5, 2);

  // 블루베리 탄환
  g.fillStyle(blueberry, 1);
  g.fillCircle(11, 3, 3);
  g.fillStyle(blueberryLight, 0.6);
  g.fillCircle(10, 2, 1.5);
  g.lineStyle(1, tubeDark, 1);
  g.strokeCircle(11, 3, 3);
}

function drawBlueberryMortarEquipTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();
  const tube = 0x6d28d9;
  const tubeDark = 0x4c1d95;
  const base = 0x5b21b6;
  const blueberry = 0x7c3aed;
  const blueberryLight = 0xa78bfa;

  // 받침대
  graphics.fillStyle(base, 1);
  graphics.fillRoundedRect(2, 10, 20, 6, 2);
  graphics.lineStyle(1.5, tubeDark, 1);
  graphics.strokeRoundedRect(2, 10, 20, 6, 2);

  // 포신 (짧고 위쪽 각도로 솟음)
  graphics.fillStyle(tube, 1);
  graphics.fillRoundedRect(8, 2, 8, 14, 2);
  graphics.fillStyle(tubeDark, 0.3);
  graphics.fillRoundedRect(10, 2, 3, 14, 1);
  graphics.lineStyle(1.5, tubeDark, 1);
  graphics.strokeRoundedRect(8, 2, 8, 14, 2);

  // 포구 링
  graphics.fillStyle(tubeDark, 1);
  graphics.fillRoundedRect(7, 1, 10, 3, 1);

  // 블루베리 탄환 (포구 위)
  graphics.fillStyle(blueberry, 1);
  graphics.fillCircle(12, 0, 4);
  graphics.fillStyle(blueberryLight, 0.5);
  graphics.fillCircle(11, -1, 2);
  graphics.lineStyle(1, tubeDark, 1);
  graphics.strokeCircle(12, 0, 4);
}

function drawBlueberryMortarPickupTexture(graphics: Phaser.GameObjects.Graphics) {
  graphics.clear();
  const tube = 0x6d28d9;
  const tubeDark = 0x4c1d95;
  const tubeLight = 0x8b5cf6;
  const base = 0x5b21b6;
  const baseDark = 0x3b0764;
  const blueberry = 0x7c3aed;
  const blueberryLight = 0xa78bfa;
  const blueberryDark = 0x4c1d95;

  // 받침대 (하단 넓은 플레이트)
  graphics.fillStyle(base, 1);
  graphics.fillRoundedRect(4, 26, 42, 10, 3);
  graphics.fillStyle(baseDark, 0.3);
  graphics.fillRoundedRect(4, 32, 42, 4, 3);
  graphics.lineStyle(2, baseDark, 1);
  graphics.strokeRoundedRect(4, 26, 42, 10, 3);

  // 포신 지지대
  graphics.fillStyle(base, 1);
  graphics.fillRoundedRect(18, 16, 10, 14, 2);
  graphics.lineStyle(1.5, baseDark, 1);
  graphics.strokeRoundedRect(18, 16, 10, 14, 2);

  // 포신 (세로로 긴 발사관)
  graphics.fillStyle(tube, 1);
  graphics.fillRoundedRect(20, 4, 14, 24, 4);
  graphics.fillStyle(tubeLight, 0.3);
  graphics.fillRoundedRect(20, 4, 4, 24, 3);
  graphics.fillStyle(tubeDark, 0.2);
  graphics.fillRoundedRect(29, 4, 5, 24, 3);
  graphics.lineStyle(2, tubeDark, 1);
  graphics.strokeRoundedRect(20, 4, 14, 24, 4);

  // 포구 링
  graphics.fillStyle(tubeDark, 1);
  graphics.fillRoundedRect(18, 3, 18, 4, 2);
  graphics.lineStyle(1.5, baseDark, 1);
  graphics.strokeRoundedRect(18, 3, 18, 4, 2);

  // 블루베리 탄환 (포구 위에 보라/파란 공)
  graphics.fillStyle(blueberry, 1);
  graphics.fillCircle(27, 0, 7);
  graphics.fillStyle(blueberryLight, 0.5);
  graphics.fillCircle(25, -2, 3.5);
  graphics.lineStyle(2, blueberryDark, 1);
  graphics.strokeCircle(27, 0, 7);
  // 블루베리 꼭지
  graphics.fillStyle(baseDark, 1);
  graphics.fillRoundedRect(25, -7, 4, 5, 1);
}
