import acornBlasterJson from "./weapons/acorn-blaster.json";
import pawsJson from "./weapons/paws.json";
import type { WeaponDefinition } from "./weapons";

export const pawsWeapon = pawsJson as WeaponDefinition;
export const acornBlasterWeapon = acornBlasterJson as WeaponDefinition;

export const weaponDefinitions = [pawsWeapon, acornBlasterWeapon] as const;

export const weaponDefinitionById = Object.fromEntries(
  weaponDefinitions.map((weapon) => [weapon.id, weapon]),
) as Record<string, WeaponDefinition>;
