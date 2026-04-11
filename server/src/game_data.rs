use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

use crate::{
    DespawnStyle, FireMode, HitType, ResourceModel, SpawnStyle, Vector2, WeaponRarity,
};

#[derive(Clone, Copy)]
pub(crate) struct FloorSegment {
    pub(crate) left_x: f64,
    pub(crate) right_x: f64,
    pub(crate) top_y: f64,
}

#[derive(Clone, Copy)]
pub(crate) struct OneWayPlatformSegment {
    pub(crate) left_x: f64,
    pub(crate) right_x: f64,
    pub(crate) top_y: f64,
}

#[derive(Clone, Copy)]
pub(crate) struct SolidWall {
    pub(crate) x: f64,
    pub(crate) top_y: f64,
    pub(crate) bottom_y: f64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum HazardKind {
    FallZone,
    InstantKillHazard,
}

#[derive(Clone)]
pub(crate) struct HazardRect {
    pub(crate) kind: HazardKind,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

pub(crate) struct RuntimeMapData {
    pub(crate) room_id: String,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) spawn_points: Vec<Vector2>,
    pub(crate) weapon_spawns: Vec<RuntimeWeaponSpawnPoint>,
    pub(crate) item_spawns: Vec<RuntimeItemSpawnPoint>,
    pub(crate) floor_segments: Vec<FloorSegment>,
    pub(crate) one_way_platforms: Vec<OneWayPlatformSegment>,
    pub(crate) solid_walls: Vec<SolidWall>,
    pub(crate) hazards: Vec<HazardRect>,
}

static RUNTIME_MAP_DATA: OnceLock<RuntimeMapData> = OnceLock::new();
static RUNTIME_WEAPON_DEFINITIONS: OnceLock<HashMap<String, RuntimeWeaponDefinition>> =
    OnceLock::new();
static RUNTIME_ITEM_DEFINITIONS: OnceLock<HashMap<String, RuntimeItemDefinition>> = OnceLock::new();

#[derive(Deserialize)]
struct MapSize {
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapSpawnPoint {
    x: f64,
    y: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapWeaponSpawnPoint {
    id: String,
    weapon_id: String,
    x: f64,
    y: f64,
    respawn_ms: u64,
    despawn_after_ms: u64,
    spawn_style: SpawnStyle,
    despawn_style: DespawnStyle,
    mode: SpawnMode,
    spawn_group_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapItemSpawnPoint {
    id: String,
    item_id: String,
    x: f64,
    y: f64,
    respawn_ms: u64,
    spawn_style: SpawnStyle,
    mode: SpawnMode,
    spawn_group_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum MapCollisionPrimitive {
    Floor {
        #[serde(rename = "leftX")]
        left_x: f64,
        #[serde(rename = "rightX")]
        right_x: f64,
        #[serde(rename = "topY")]
        top_y: f64,
    },
    OneWayPlatform {
        #[serde(rename = "leftX")]
        left_x: f64,
        #[serde(rename = "rightX")]
        right_x: f64,
        #[serde(rename = "topY")]
        top_y: f64,
    },
    SolidWall {
        x: f64,
        #[serde(rename = "topY")]
        top_y: f64,
        #[serde(rename = "bottomY")]
        bottom_y: f64,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum MapHazard {
    FallZone {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    InstantKillHazard {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeMapDefinition {
    id: String,
    size: MapSize,
    spawn_points: Vec<MapSpawnPoint>,
    collision: Vec<MapCollisionPrimitive>,
    hazards: Vec<MapHazard>,
    weapon_spawns: Vec<MapWeaponSpawnPoint>,
    item_spawns: Vec<MapItemSpawnPoint>,
}

#[derive(Clone)]
pub(crate) struct RuntimeWeaponSpawnPoint {
    pub(crate) id: String,
    pub(crate) weapon_id: String,
    pub(crate) position: Vector2,
    pub(crate) respawn_ms: u64,
    pub(crate) despawn_after_ms: u64,
    pub(crate) spawn_style: SpawnStyle,
    pub(crate) despawn_style: DespawnStyle,
    pub(crate) mode: SpawnMode,
    pub(crate) spawn_group_id: Option<String>,
}

#[derive(Clone)]
pub(crate) struct RuntimeItemSpawnPoint {
    pub(crate) id: String,
    pub(crate) item_id: String,
    pub(crate) position: Vector2,
    pub(crate) respawn_ms: u64,
    pub(crate) spawn_style: SpawnStyle,
    pub(crate) mode: SpawnMode,
    pub(crate) spawn_group_id: Option<String>,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SpawnMode {
    Fixed,
    RandomCandidates,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeItemDefinition {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) item_type: ItemType,
    pub(crate) max_stack: u32,
    pub(crate) effect: RuntimeItemEffect,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ItemType {
    SpeedRankUp,
    ExtraLife,
    HealthRecover,
    JumpBoost,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeItemEffect {
    pub(crate) jump_count_delta: Option<i8>,
    pub(crate) speed_rank_delta: Option<i8>,
    pub(crate) extra_lives: Option<u8>,
    pub(crate) heal_amount: Option<u16>,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeWeaponDefinition {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) hit_type: HitType,
    pub(crate) fire_mode: FireMode,
    pub(crate) resource_model: ResourceModel,
    pub(crate) damage: u16,
    pub(crate) knockback: f64,
    pub(crate) self_recoil_force: f64,
    pub(crate) self_recoil_angle_deg: f64,
    pub(crate) self_recoil_angle_jitter_deg: f64,
    pub(crate) self_recoil_ground_multiplier: f64,
    pub(crate) self_recoil_air_multiplier: f64,
    pub(crate) attack_interval_ms: u64,
    pub(crate) range: f64,
    pub(crate) projectile_speed: f64,
    pub(crate) spread_deg: f64,
    pub(crate) pellet_count: u8,
    pub(crate) max_resource: u32,
    pub(crate) resource_per_shot: u32,
    pub(crate) resource_per_second: u32,
    pub(crate) discard_on_empty: bool,
    pub(crate) pickup_weight: u32,
    pub(crate) rarity: WeaponRarity,
    pub(crate) world_despawn_ms: u64,
    pub(crate) special_effect: RuntimeWeaponSpecialEffect,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum RuntimeWeaponSpecialEffect {
    None,
    Explode {
        fuse_ms: Option<u64>,
        radius: Option<f64>,
    },
    Grab {
        grab_duration_ms: u64,
    },
    HealBlock {
        duration_ms: u64,
    },
}

pub(crate) fn runtime_map_data() -> &'static RuntimeMapData {
    RUNTIME_MAP_DATA.get_or_init(|| {
        let raw = include_str!("../../packages/shared/maps/training-arena.json");
        let map_definition: RuntimeMapDefinition =
            serde_json::from_str(raw).expect("training arena JSON should deserialize");

        let mut floor_segments = Vec::new();
        let mut one_way_platforms = Vec::new();
        let mut solid_walls = Vec::new();

        for primitive in map_definition.collision {
            match primitive {
                MapCollisionPrimitive::Floor {
                    left_x,
                    right_x,
                    top_y,
                } => floor_segments.push(FloorSegment {
                    left_x,
                    right_x,
                    top_y,
                }),
                MapCollisionPrimitive::OneWayPlatform {
                    left_x,
                    right_x,
                    top_y,
                } => one_way_platforms.push(OneWayPlatformSegment {
                    left_x,
                    right_x,
                    top_y,
                }),
                MapCollisionPrimitive::SolidWall { x, top_y, bottom_y } => {
                    solid_walls.push(SolidWall { x, top_y, bottom_y })
                }
            }
        }

        let hazards = map_definition
            .hazards
            .into_iter()
            .map(|hazard| match hazard {
                MapHazard::FallZone {
                    x,
                    y,
                    width,
                    height,
                } => HazardRect {
                    kind: HazardKind::FallZone,
                    x,
                    y,
                    width,
                    height,
                },
                MapHazard::InstantKillHazard {
                    x,
                    y,
                    width,
                    height,
                } => HazardRect {
                    kind: HazardKind::InstantKillHazard,
                    x,
                    y,
                    width,
                    height,
                },
            })
            .collect::<Vec<_>>();

        let weapon_spawns = map_definition
            .weapon_spawns
            .into_iter()
            .map(|spawn| RuntimeWeaponSpawnPoint {
                id: spawn.id,
                weapon_id: spawn.weapon_id,
                position: Vector2 {
                    x: spawn.x,
                    y: spawn.y,
                },
                respawn_ms: spawn.respawn_ms,
                despawn_after_ms: spawn.despawn_after_ms,
                spawn_style: spawn.spawn_style,
                despawn_style: spawn.despawn_style,
                mode: spawn.mode,
                spawn_group_id: spawn.spawn_group_id,
            })
            .collect::<Vec<_>>();

        let item_spawns = map_definition
            .item_spawns
            .into_iter()
            .map(|spawn| RuntimeItemSpawnPoint {
                id: spawn.id,
                item_id: spawn.item_id,
                position: Vector2 {
                    x: spawn.x,
                    y: spawn.y,
                },
                respawn_ms: spawn.respawn_ms,
                spawn_style: spawn.spawn_style,
                mode: spawn.mode,
                spawn_group_id: spawn.spawn_group_id,
            })
            .collect::<Vec<_>>();

        RuntimeMapData {
            room_id: map_definition.id,
            width: map_definition.size.width,
            height: map_definition.size.height,
            spawn_points: map_definition
                .spawn_points
                .into_iter()
                .map(|spawn| Vector2 {
                    x: spawn.x,
                    y: spawn.y,
                })
                .collect(),
            weapon_spawns,
            item_spawns,
            floor_segments,
            one_way_platforms,
            solid_walls,
            hazards,
        }
    })
}

fn runtime_weapon_definitions() -> &'static HashMap<String, RuntimeWeaponDefinition> {
    RUNTIME_WEAPON_DEFINITIONS.get_or_init(|| {
        let paws_raw = include_str!("../../packages/shared/weapons/paws.json");
        let acorn_raw = include_str!("../../packages/shared/weapons/acorn-blaster.json");

        let paws: RuntimeWeaponDefinition =
            serde_json::from_str(paws_raw).expect("paws JSON should deserialize");
        let acorn: RuntimeWeaponDefinition =
            serde_json::from_str(acorn_raw).expect("acorn blaster JSON should deserialize");

        HashMap::from([(paws.id.clone(), paws), (acorn.id.clone(), acorn)])
    })
}

fn runtime_item_definitions() -> &'static HashMap<String, RuntimeItemDefinition> {
    RUNTIME_ITEM_DEFINITIONS.get_or_init(|| {
        let jump_boost_raw = include_str!("../../packages/shared/items/jump-boost-small.json");
        let health_pack_raw = include_str!("../../packages/shared/items/health-pack-small.json");

        let jump_boost: RuntimeItemDefinition =
            serde_json::from_str(jump_boost_raw).expect("jump boost JSON should deserialize");
        let health_pack: RuntimeItemDefinition =
            serde_json::from_str(health_pack_raw).expect("health pack JSON should deserialize");

        HashMap::from([
            (jump_boost.id.clone(), jump_boost),
            (health_pack.id.clone(), health_pack),
        ])
    })
}

pub(crate) fn weapon_definition(weapon_id: &str) -> &'static RuntimeWeaponDefinition {
    runtime_weapon_definitions()
        .get(weapon_id)
        .unwrap_or_else(|| panic!("missing weapon definition: {weapon_id}"))
}

pub(crate) fn item_definition(item_id: &str) -> &'static RuntimeItemDefinition {
    runtime_item_definitions()
        .get(item_id)
        .unwrap_or_else(|| panic!("missing item definition: {item_id}"))
}

pub(crate) fn world_width() -> f64 {
    runtime_map_data().width
}

#[allow(dead_code)]
pub(crate) fn world_height() -> f64 {
    runtime_map_data().height
}

pub(crate) fn room_id() -> &'static str {
    runtime_map_data().room_id.as_str()
}

pub(crate) fn ground_top_y() -> f64 {
    runtime_map_data()
        .floor_segments
        .iter()
        .map(|segment| segment.top_y)
        .fold(f64::NEG_INFINITY, f64::max)
}

pub(crate) fn primary_fall_zone() -> &'static HazardRect {
    runtime_map_data()
        .hazards
        .iter()
        .find(|hazard| hazard.kind == HazardKind::FallZone)
        .expect("training arena should define a fall zone")
}

pub(crate) fn pit_left_x() -> f64 {
    primary_fall_zone().x
}

pub(crate) fn pit_right_x() -> f64 {
    primary_fall_zone().x + primary_fall_zone().width
}

pub(crate) fn primary_instant_kill_hazard() -> &'static HazardRect {
    runtime_map_data()
        .hazards
        .iter()
        .find(|hazard| hazard.kind == HazardKind::InstantKillHazard)
        .expect("training arena should define an instant kill hazard")
}
