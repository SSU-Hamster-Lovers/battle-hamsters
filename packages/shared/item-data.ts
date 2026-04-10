import healthPackSmallJson from "./items/health-pack-small.json";
import jumpBoostSmallJson from "./items/jump-boost-small.json";
import type { ItemDefinition } from "./items";

export const healthPackSmallItem = healthPackSmallJson as ItemDefinition;
export const jumpBoostSmallItem = jumpBoostSmallJson as ItemDefinition;

export const itemDefinitions = [
  healthPackSmallItem,
  jumpBoostSmallItem,
] as const;

export const itemDefinitionById = Object.fromEntries(
  itemDefinitions.map((item) => [item.id, item]),
) as Record<string, ItemDefinition>;
