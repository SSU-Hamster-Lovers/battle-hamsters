import acornBlasterJson from "./weapons/acorn-blaster.json";
import handCannonJson from "./weapons/hand-cannon.json";
import pawsJson from "./weapons/paws.json";
import seedShotgunJson from "./weapons/seed-shotgun.json";
import type { WeaponDefinition } from "./weapons";

export const pawsWeapon = pawsJson as WeaponDefinition;
export const acornBlasterWeapon = acornBlasterJson as WeaponDefinition;
export const seedShotgunWeapon = seedShotgunJson as WeaponDefinition;
export const handCannonWeapon = handCannonJson as WeaponDefinition;

export const weaponDefinitions = [
  pawsWeapon,
  acornBlasterWeapon,
  seedShotgunWeapon,
  handCannonWeapon,
] as const;

export const weaponDefinitionById = Object.fromEntries(
  weaponDefinitions.map((weapon) => [weapon.id, weapon]),
) as Record<string, WeaponDefinition>;
