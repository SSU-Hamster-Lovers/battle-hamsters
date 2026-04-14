import acornBlasterJson from "./weapons/acorn-blaster.json";
import acornSwordJson from "./weapons/acorn-sword.json";
import hedgehogSprayJson from "./weapons/hedgehog-spray.json";
import blueberryMortarJson from "./weapons/blueberry-mortar.json";
import emberSprinklerJson from "./weapons/ember-sprinkler.json";
import grabSpearJson from "./weapons/grab-spear.json";
import laserCutterJson from "./weapons/laser-cutter.json";
import pawsJson from "./weapons/paws.json";
import pineSniperJson from "./weapons/pine-sniper.json";
import seedShotgunJson from "./weapons/seed-shotgun.json";
import squirrelGatlingJson from "./weapons/squirrel-gatling.json";
import walnutCannonJson from "./weapons/walnut-cannon.json";
import type { WeaponDefinition } from "./weapons";

export const pawsWeapon = pawsJson as WeaponDefinition;
export const acornBlasterWeapon = acornBlasterJson as WeaponDefinition;
export const seedShotgunWeapon = seedShotgunJson as WeaponDefinition;
export const walnutCannonWeapon = walnutCannonJson as WeaponDefinition;
export const emberSprinklerWeapon = emberSprinklerJson as WeaponDefinition;
export const pineSniperWeapon = pineSniperJson as WeaponDefinition;
export const squirrelGatlingWeapon = squirrelGatlingJson as WeaponDefinition;
export const blueberryMortarWeapon = blueberryMortarJson as WeaponDefinition;
export const laserCutterWeapon = laserCutterJson as WeaponDefinition;
export const grabSpearWeapon = grabSpearJson as WeaponDefinition;
export const acornSwordWeapon = acornSwordJson as WeaponDefinition;
export const hedgehogSprayWeapon = hedgehogSprayJson as WeaponDefinition;

export const weaponDefinitions = [
  pawsWeapon,
  acornBlasterWeapon,
  seedShotgunWeapon,
  walnutCannonWeapon,
  emberSprinklerWeapon,
  pineSniperWeapon,
  squirrelGatlingWeapon,
  blueberryMortarWeapon,
  laserCutterWeapon,
  grabSpearWeapon,
  acornSwordWeapon,
  hedgehogSprayWeapon,
] as const;

export const weaponDefinitionById = Object.fromEntries(
  weaponDefinitions.map((weapon) => [weapon.id, weapon]),
) as Record<string, WeaponDefinition>;
