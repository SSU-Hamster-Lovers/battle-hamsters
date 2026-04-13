import Phaser from "phaser";
import { weaponDefinitionById } from "@battle-hamsters/shared";

const WEAPON_HUD_ICON_PREFIX = "weapon-hud-icon";
const HUD_ICON_SIZE = 24;

const WEAPON_PICKUP_TEXTURE_PREFIX = "weapon-pickup";
const ACORN_PICKUP_TEXTURE_KEY = `${WEAPON_PICKUP_TEXTURE_PREFIX}-acorn-blaster`;
const WEAPON_EQUIP_TEXTURE_PREFIX = "weapon-equip";
const ACORN_EQUIP_TEXTURE_KEY = `${WEAPON_EQUIP_TEXTURE_PREFIX}-acorn-blaster`;

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
};

export type WeaponFireStyle =
  | "generic_line"
  | "paws_pulse"
  | "muzzle_flash";

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
    };
  }

  return {
    textureKey: null,
    offsetX: 0,
    offsetY: 0,
    flipWithDirection: false,
  };
}

export function resolveWeaponFireStyle(weaponId: string): WeaponFireStyle {
  if (weaponId === "acorn_blaster") {
    return "muzzle_flash";
  }

  if (weaponId === "paws") {
    return "paws_pulse";
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
