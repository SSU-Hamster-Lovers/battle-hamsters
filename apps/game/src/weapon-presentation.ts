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
  | "cannon_blast";

export type WeaponImpactStyle =
  | "generic_spark"
  | "acorn_spark"
  | "paws_dust"
  | "seed_burst"
  | "cannon_impact";

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
