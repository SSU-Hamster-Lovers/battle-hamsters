import acornBlasterJson from "./weapons/acorn-blaster.json";
import emberSprinklerJson from "./weapons/ember-sprinkler.json";
import pawsJson from "./weapons/paws.json";
import seedShotgunJson from "./weapons/seed-shotgun.json";
import walnutCannonJson from "./weapons/walnut-cannon.json";
import type { WeaponDefinition } from "./weapons";

export const pawsWeapon = pawsJson as WeaponDefinition;
export const acornBlasterWeapon = acornBlasterJson as WeaponDefinition;
export const seedShotgunWeapon = seedShotgunJson as WeaponDefinition;
export const walnutCannonWeapon = walnutCannonJson as WeaponDefinition;
export const emberSprinklerWeapon = emberSprinklerJson as WeaponDefinition;

export const weaponDefinitions = [
  pawsWeapon,
  acornBlasterWeapon,
  seedShotgunWeapon,
  walnutCannonWeapon,
  emberSprinklerWeapon,
] as const;

export const weaponDefinitionById = Object.fromEntries(
  weaponDefinitions.map((weapon) => [weapon.id, weapon]),
) as Record<string, WeaponDefinition>;
