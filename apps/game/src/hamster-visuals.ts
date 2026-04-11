import Phaser from "phaser";
import type { PlayerSnapshot } from "@battle-hamsters/shared";

const HAMSTER_TEXTURE_PREFIX = "hamster-placeholder";
const HAMSTER_TEXTURE_SIZE = 48;

type HamsterPose = "idle" | "run-a" | "run-b" | "jump" | "fall" | "respawn";

type HamsterPoseOptions = {
  headOffsetY?: number;
  bodyOffsetY?: number;
  bodyHeight?: number;
  bodyWidth?: number;
  feetOffsetX?: number;
  feetOffsetY?: number;
  earLift?: number;
  eyeOffsetY?: number;
};

const POSES: Record<HamsterPose, HamsterPoseOptions> = {
  idle: {},
  "run-a": {
    feetOffsetX: 3,
    bodyOffsetY: 1,
  },
  "run-b": {
    feetOffsetX: -3,
    bodyOffsetY: -1,
  },
  jump: {
    bodyOffsetY: -3,
    headOffsetY: -2,
    bodyHeight: 16,
    feetOffsetY: -2,
    earLift: 2,
  },
  fall: {
    bodyOffsetY: 2,
    bodyHeight: 20,
    eyeOffsetY: 2,
  },
  respawn: {
    bodyOffsetY: -1,
    headOffsetY: -1,
    earLift: 4,
  },
};

export function ensureHamsterPlaceholderTextures(scene: Phaser.Scene) {
  if (scene.textures.exists(textureKey("idle"))) {
    return;
  }

  for (const pose of Object.keys(POSES) as HamsterPose[]) {
    const graphics = new Phaser.GameObjects.Graphics(scene);
    drawHamsterPose(graphics, POSES[pose]);
    graphics.generateTexture(textureKey(pose), HAMSTER_TEXTURE_SIZE, HAMSTER_TEXTURE_SIZE);
    graphics.destroy();
  }
}

export function hamsterTextureForSnapshot(
  snapshot: PlayerSnapshot,
  timeNow: number,
): string {
  if (snapshot.state === "respawning") {
    return textureKey("respawn");
  }

  if (!snapshot.grounded) {
    return snapshot.velocity.y < 0 ? textureKey("jump") : textureKey("fall");
  }

  if (Math.abs(snapshot.velocity.x) > 0.2) {
    return timeNow % 220 < 110 ? textureKey("run-a") : textureKey("run-b");
  }

  return textureKey("idle");
}

function textureKey(pose: HamsterPose) {
  return `${HAMSTER_TEXTURE_PREFIX}-${pose}`;
}

function drawHamsterPose(
  graphics: Phaser.GameObjects.Graphics,
  options: HamsterPoseOptions,
) {
  const headOffsetY = options.headOffsetY ?? 0;
  const bodyOffsetY = options.bodyOffsetY ?? 0;
  const bodyHeight = options.bodyHeight ?? 18;
  const bodyWidth = options.bodyWidth ?? 24;
  const feetOffsetX = options.feetOffsetX ?? 0;
  const feetOffsetY = options.feetOffsetY ?? 0;
  const earLift = options.earLift ?? 0;
  const eyeOffsetY = options.eyeOffsetY ?? 0;

  const earColor = 0x8b5e3c;
  const furColor = 0xd9a066;
  const bellyColor = 0xf5d6ad;
  const cheekColor = 0xf2a5a1;
  const outlineColor = 0x6b442d;

  graphics.clear();

  graphics.fillStyle(earColor, 1);
  graphics.fillEllipse(15, 11 - earLift + headOffsetY, 8, 10);
  graphics.fillEllipse(33, 11 - earLift + headOffsetY, 8, 10);

  graphics.fillStyle(furColor, 1);
  graphics.fillEllipse(24, 20 + headOffsetY, 22, 20);
  graphics.fillEllipse(24, 31 + bodyOffsetY, bodyWidth, bodyHeight);

  graphics.fillStyle(bellyColor, 1);
  graphics.fillEllipse(24, 33 + bodyOffsetY, 14, 11);

  graphics.fillStyle(cheekColor, 0.9);
  graphics.fillCircle(17, 24 + headOffsetY, 2.4);
  graphics.fillCircle(31, 24 + headOffsetY, 2.4);

  graphics.fillStyle(outlineColor, 1);
  graphics.fillCircle(20, 20 + eyeOffsetY + headOffsetY, 1.4);
  graphics.fillCircle(28, 20 + eyeOffsetY + headOffsetY, 1.4);
  graphics.fillCircle(24, 24 + headOffsetY, 1.2);

  graphics.lineStyle(1.5, outlineColor, 1);
  graphics.beginPath();
  graphics.moveTo(22, 27 + headOffsetY);
  graphics.lineTo(24, 28 + headOffsetY);
  graphics.lineTo(26, 27 + headOffsetY);
  graphics.strokePath();

  graphics.fillStyle(earColor, 1);
  graphics.fillEllipse(18 + feetOffsetX, 40 + feetOffsetY, 7, 5);
  graphics.fillEllipse(30 - feetOffsetX, 40 - feetOffsetY, 7, 5);

  graphics.fillEllipse(36, 31 + bodyOffsetY, 4, 7);
}
