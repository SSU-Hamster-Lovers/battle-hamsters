use actix::{Actor, ActorContext, AsyncContext, Handler, Message, Recipient, StreamHandler};
use actix_web::{web, App, Error, HttpRequest, HttpResponse, HttpServer, Responder};
use actix_web_actors::ws;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const SERVER_VERSION: &str = "0.1.0";
const ROOM_ID: &str = "room_alpha";
const DEFAULT_TIME_LIMIT_MS: u64 = 300_000;
const TICK_RATE: u64 = 20;
const TICK_INTERVAL_MS: u64 = 1000 / TICK_RATE;
const HEARTBEAT_INTERVAL_SECS: u64 = 5;
const CLIENT_TIMEOUT_SECS: u64 = 10;

const PLAYER_HALF_SIZE: f64 = 14.0;
const RUN_SPEED_PER_TICK: f64 = 8.0;
const GRAVITY_PER_TICK: f64 = 1.4;
const FAST_FALL_GRAVITY_PER_TICK: f64 = 2.4;
const JUMP_VELOCITY: f64 = -18.0;
const MAX_FALL_SPEED: f64 = 20.0;
const MAX_FAST_FALL_SPEED: f64 = 28.0;
const DROP_THROUGH_MS: u64 = 220;
const RESPAWN_DELAY_MS: u64 = 3_000;
const TEST_LIVES: u8 = 99;
const MAX_JUMP_COUNT: u8 = 3;
const PICKUP_HALF_HEIGHT: f64 = 7.0;
const PICKUP_GRAVITY_PER_TICK: f64 = 1.0;
const PICKUP_MAX_FALL_SPEED: f64 = 18.0;

#[derive(Clone, Copy)]
struct FloorSegment {
    left_x: f64,
    right_x: f64,
    top_y: f64,
}

#[derive(Clone, Copy)]
struct OneWayPlatformSegment {
    left_x: f64,
    right_x: f64,
    top_y: f64,
}

#[derive(Clone, Copy)]
struct SolidWall {
    x: f64,
    top_y: f64,
    bottom_y: f64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HazardKind {
    FallZone,
    InstantKillHazard,
}

#[derive(Clone)]
struct HazardRect {
    kind: HazardKind,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone)]
struct PickupKinematics {
    velocity_y: f64,
    grounded: bool,
}

struct RuntimeMapData {
    room_id: String,
    width: f64,
    height: f64,
    spawn_points: Vec<Vector2>,
    weapon_spawns: Vec<RuntimeWeaponSpawnPoint>,
    floor_segments: Vec<FloorSegment>,
    one_way_platforms: Vec<OneWayPlatformSegment>,
    solid_walls: Vec<SolidWall>,
    hazards: Vec<HazardRect>,
}

static RUNTIME_MAP_DATA: OnceLock<RuntimeMapData> = OnceLock::new();
static RUNTIME_WEAPON_DEFINITIONS: OnceLock<HashMap<String, RuntimeWeaponDefinition>> =
    OnceLock::new();

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
}

async fn health() -> impl Responder {
    HttpResponse::Ok().json(HealthResponse {
        status: "ok".to_string(),
        version: SERVER_VERSION.to_string(),
    })
}

#[derive(Deserialize)]
struct UserQuery {
    username: Option<String>,
}

async fn hello(query: web::Query<UserQuery>) -> impl Responder {
    let name = query.username.as_deref().unwrap_or("World");
    HttpResponse::Ok().json(serde_json::json!({
        "message": format!("Hello, {}!", name)
    }))
}

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
    size: MapSize,
    spawn_points: Vec<MapSpawnPoint>,
    collision: Vec<MapCollisionPrimitive>,
    hazards: Vec<MapHazard>,
    weapon_spawns: Vec<MapWeaponSpawnPoint>,
}

#[derive(Clone)]
struct RuntimeWeaponSpawnPoint {
    id: String,
    weapon_id: String,
    position: Vector2,
    respawn_ms: u64,
    despawn_after_ms: u64,
    spawn_style: SpawnStyle,
    despawn_style: DespawnStyle,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RuntimeWeaponDefinition {
    id: String,
    name: String,
    hit_type: HitType,
    fire_mode: FireMode,
    resource_model: ResourceModel,
    damage: u16,
    knockback: f64,
    self_recoil_force: f64,
    self_recoil_angle_deg: f64,
    self_recoil_angle_jitter_deg: f64,
    self_recoil_ground_multiplier: f64,
    self_recoil_air_multiplier: f64,
    attack_interval_ms: u64,
    range: f64,
    projectile_speed: f64,
    spread_deg: f64,
    pellet_count: u8,
    max_resource: u32,
    resource_per_shot: u32,
    resource_per_second: u32,
    discard_on_empty: bool,
    pickup_weight: u32,
    rarity: WeaponRarity,
    world_despawn_ms: u64,
    special_effect: RuntimeWeaponSpecialEffect,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum RuntimeWeaponSpecialEffect {
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

fn runtime_map_data() -> &'static RuntimeMapData {
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
            })
            .collect::<Vec<_>>();

        RuntimeMapData {
            room_id: ROOM_ID.to_string(),
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

fn weapon_definition(weapon_id: &str) -> &'static RuntimeWeaponDefinition {
    runtime_weapon_definitions()
        .get(weapon_id)
        .unwrap_or_else(|| panic!("missing weapon definition: {weapon_id}"))
}

fn world_width() -> f64 {
    runtime_map_data().width
}

fn world_height() -> f64 {
    runtime_map_data().height
}

fn room_id() -> &'static str {
    runtime_map_data().room_id.as_str()
}

fn ground_top_y() -> f64 {
    runtime_map_data()
        .floor_segments
        .iter()
        .map(|segment| segment.top_y)
        .fold(f64::NEG_INFINITY, f64::max)
}

fn primary_fall_zone() -> &'static HazardRect {
    runtime_map_data()
        .hazards
        .iter()
        .find(|hazard| hazard.kind == HazardKind::FallZone)
        .expect("training arena should define a fall zone")
}

fn pit_left_x() -> f64 {
    primary_fall_zone().x
}

fn pit_right_x() -> f64 {
    primary_fall_zone().x + primary_fall_zone().width
}

#[derive(Clone)]
struct PlayerRuntime {
    snapshot: PlayerSnapshot,
    latest_input: PlayerInputPayload,
    spawn_index: usize,
    external_velocity: Vector2,
    next_attack_at: u64,
    attack_queued: bool,
    attack_was_down: bool,
}

struct RoomState {
    room_id: String,
    server_tick: u64,
    time_remaining_ms: u64,
    players: HashMap<String, PlayerRuntime>,
    weapon_pickups: HashMap<String, WorldWeaponPickup>,
    next_weapon_pickup_id: u64,
    next_spawn_respawn_at: HashMap<String, u64>,
    sessions: HashMap<String, Recipient<WsText>>,
}

impl RoomState {
    fn new() -> Self {
        let now = now_ms();
        let mut room = Self {
            room_id: room_id().to_string(),
            server_tick: 0,
            time_remaining_ms: DEFAULT_TIME_LIMIT_MS,
            players: HashMap::new(),
            weapon_pickups: HashMap::new(),
            next_weapon_pickup_id: 1,
            next_spawn_respawn_at: HashMap::new(),
            sessions: HashMap::new(),
        };
        room.spawn_initial_weapons(now);
        room
    }

    fn spawn_initial_weapons(&mut self, now_ms: u64) {
        let spawns = runtime_map_data().weapon_spawns.clone();
        for spawn in spawns {
            self.spawn_weapon_from_spawn(&spawn, now_ms);
        }
    }

    fn next_world_pickup_id(&mut self) -> String {
        let id = format!("weapon_pickup_{}", self.next_weapon_pickup_id);
        self.next_weapon_pickup_id += 1;
        id
    }

    fn spawn_weapon_from_spawn(&mut self, spawn: &RuntimeWeaponSpawnPoint, now_ms: u64) {
        let definition = weapon_definition(&spawn.weapon_id);
        let pickup = WorldWeaponPickup {
            id: self.next_world_pickup_id(),
            weapon_id: spawn.weapon_id.clone(),
            position: spawn.position.clone(),
            source: PickupSource::Spawn,
            resource_remaining: definition.max_resource,
            spawn_style: spawn.spawn_style,
            despawn_style: spawn.despawn_style,
            spawned_at: now_ms,
            despawn_at: Some(now_ms + spawn.despawn_after_ms),
            spawn_id: Some(spawn.id.clone()),
            respawn_ms: Some(spawn.respawn_ms),
            kinematics: PickupKinematics {
                velocity_y: 0.0,
                grounded: false,
            },
        };
        self.weapon_pickups.insert(pickup.id.clone(), pickup);
    }

    fn create_dropped_pickup(
        &mut self,
        weapon_id: String,
        resource_remaining: u32,
        position: Vector2,
        now_ms: u64,
    ) {
        let definition = weapon_definition(&weapon_id);
        let pickup = WorldWeaponPickup {
            id: self.next_world_pickup_id(),
            weapon_id,
            position,
            source: PickupSource::Dropped,
            resource_remaining,
            spawn_style: SpawnStyle::FadeIn,
            despawn_style: DespawnStyle::ShrinkPop,
            spawned_at: now_ms,
            despawn_at: Some(now_ms + definition.world_despawn_ms),
            spawn_id: None,
            respawn_ms: None,
            kinematics: PickupKinematics {
                velocity_y: 0.0,
                grounded: false,
            },
        };
        self.weapon_pickups.insert(pickup.id.clone(), pickup);
    }

    fn player_snapshots(&self) -> Vec<PlayerSnapshot> {
        self.players
            .values()
            .map(|player| player.snapshot.clone())
            .collect()
    }

    fn weapon_pickup_snapshots(&self) -> Vec<WorldWeaponPickup> {
        self.weapon_pickups.values().cloned().collect()
    }

    fn refresh_weapon_spawns(&mut self, now_ms: u64) {
        let spawns = runtime_map_data().weapon_spawns.clone();
        for spawn in spawns {
            let active = self
                .weapon_pickups
                .values()
                .any(|pickup| pickup.spawn_id.as_deref() == Some(spawn.id.as_str()));
            if active {
                continue;
            }

            let ready = self
                .next_spawn_respawn_at
                .get(&spawn.id)
                .is_none_or(|respawn_at| now_ms >= *respawn_at);
            if ready {
                self.next_spawn_respawn_at.remove(&spawn.id);
                self.spawn_weapon_from_spawn(&spawn, now_ms);
            }
        }
    }

    fn cleanup_expired_pickups(&mut self, now_ms: u64) {
        let expired_ids = self
            .weapon_pickups
            .iter()
            .filter_map(|(pickup_id, pickup)| {
                pickup
                    .despawn_at
                    .is_some_and(|despawn_at| now_ms >= despawn_at)
                    .then_some(pickup_id.clone())
            })
            .collect::<Vec<_>>();

        for pickup_id in expired_ids {
            if let Some(pickup) = self.weapon_pickups.remove(&pickup_id) {
                if let (Some(spawn_id), Some(respawn_ms)) = (pickup.spawn_id, pickup.respawn_ms) {
                    self.next_spawn_respawn_at
                        .insert(spawn_id, now_ms + respawn_ms);
                }
            }
        }
    }

    fn step_weapon_pickups(&mut self) {
        for pickup in self.weapon_pickups.values_mut() {
            if pickup.kinematics.grounded {
                continue;
            }

            let previous_bottom = pickup.position.y + PICKUP_HALF_HEIGHT;
            pickup.kinematics.velocity_y =
                (pickup.kinematics.velocity_y + PICKUP_GRAVITY_PER_TICK).min(PICKUP_MAX_FALL_SPEED);
            pickup.position.y += pickup.kinematics.velocity_y;
            let current_bottom = pickup.position.y + PICKUP_HALF_HEIGHT;

            let mut landed = false;
            for floor in &runtime_map_data().floor_segments {
                if current_bottom >= floor.top_y
                    && surface_contains_x(floor.left_x, floor.right_x, pickup.position.x)
                {
                    pickup.position.y = floor.top_y - PICKUP_HALF_HEIGHT;
                    pickup.kinematics.velocity_y = 0.0;
                    pickup.kinematics.grounded = true;
                    landed = true;
                    break;
                }
            }

            if landed {
                continue;
            }

            for platform in &runtime_map_data().one_way_platforms {
                if previous_bottom <= platform.top_y
                    && current_bottom >= platform.top_y
                    && surface_contains_x(platform.left_x, platform.right_x, pickup.position.x)
                {
                    pickup.position.y = platform.top_y - PICKUP_HALF_HEIGHT;
                    pickup.kinematics.velocity_y = 0.0;
                    pickup.kinematics.grounded = true;
                    break;
                }
            }
        }
    }

    fn drop_equipped_weapon_if_needed(&mut self, player_id: &str, now_ms: u64) {
        let Some(player_view) = self.players.get(player_id) else {
            return;
        };

        if !player_view.latest_input.drop_weapon
            || player_view.snapshot.equipped_weapon_id == "paws"
        {
            return;
        }

        let drop_payload = (
            player_view.snapshot.equipped_weapon_id.clone(),
            player_view.snapshot.equipped_weapon_resource.unwrap_or(0),
            player_view.snapshot.position.clone(),
        );

        if let Some(player) = self.players.get_mut(player_id) {
            player.snapshot.equipped_weapon_id = "paws".to_string();
            player.snapshot.equipped_weapon_resource = None;
        }

        if drop_payload.1 > 0 {
            self.create_dropped_pickup(drop_payload.0, drop_payload.1, drop_payload.2, now_ms);
        }
    }

    fn pickup_near_player(&self, player: &PlayerRuntime) -> Option<String> {
        self.weapon_pickups
            .iter()
            .filter_map(|(pickup_id, pickup)| {
                let dx = pickup.position.x - player.snapshot.position.x;
                let dy = pickup.position.y - player.snapshot.position.y;
                let distance_sq = dx * dx + dy * dy;
                (distance_sq <= 36.0 * 36.0).then_some((pickup_id.clone(), distance_sq))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(pickup_id, _)| pickup_id)
    }

    fn handle_weapon_pickup(&mut self, player_id: &str, now_ms: u64) {
        let Some(pickup_id) = self
            .players
            .get(player_id)
            .and_then(|player| self.pickup_near_player(player))
        else {
            return;
        };

        let Some(pickup) = self.weapon_pickups.remove(&pickup_id) else {
            return;
        };

        if let (Some(spawn_id), Some(respawn_ms)) = (pickup.spawn_id.clone(), pickup.respawn_ms) {
            self.next_spawn_respawn_at
                .insert(spawn_id, now_ms + respawn_ms);
        }

        let current_weapon_to_drop = self.players.get(player_id).and_then(|player| {
            (player.snapshot.equipped_weapon_id != "paws"
                && player.snapshot.equipped_weapon_resource.unwrap_or(0) > 0)
                .then_some((
                    player.snapshot.equipped_weapon_id.clone(),
                    player.snapshot.equipped_weapon_resource.unwrap_or(0),
                    player.snapshot.position.clone(),
                ))
        });

        let Some(player) = self.players.get_mut(player_id) else {
            return;
        };

        player.snapshot.equipped_weapon_id = pickup.weapon_id;
        player.snapshot.equipped_weapon_resource = Some(pickup.resource_remaining);

        if let Some((weapon_id, resource_remaining, position)) = current_weapon_to_drop {
            self.create_dropped_pickup(weapon_id, resource_remaining, position, now_ms);
        }
    }

    fn handle_weapon_attack(&mut self, player_id: &str, now_ms: u64, deaths: &mut Vec<String>) {
        let Some(shooter_view) = self.players.get(player_id) else {
            return;
        };
        if !shooter_view.attack_queued {
            return;
        }
        if now_ms < shooter_view.next_attack_at {
            return;
        }

        let weapon_id = shooter_view.snapshot.equipped_weapon_id.clone();
        if weapon_id == "paws" {
            return;
        }

        let weapon = weapon_definition(&weapon_id).clone();
        if !matches!(weapon.hit_type, HitType::Hitscan)
            || !matches!(weapon.fire_mode, FireMode::Single)
        {
            return;
        }

        let Some(current_resource) = shooter_view.snapshot.equipped_weapon_resource else {
            return;
        };
        if current_resource < weapon.resource_per_shot {
            return;
        }

        let shooter_position = shooter_view.snapshot.position.clone();
        let shooter_grounded = shooter_view.snapshot.grounded;
        let aim_direction = normalize_or_fallback(
            shooter_view.latest_input.aim.clone(),
            shooter_view.snapshot.direction,
        );
        let recoil_direction = rotate_vector(
            Vector2 {
                x: -aim_direction.x,
                y: -aim_direction.y,
            },
            weapon.self_recoil_angle_deg
                + pseudo_jitter_deg(
                    shooter_view.latest_input.sequence
                        + self.server_tick
                        + shooter_position.x.to_bits(),
                    weapon.self_recoil_angle_jitter_deg,
                ),
        );
        let target_id =
            self.find_hitscan_target(player_id, &shooter_position, &aim_direction, weapon.range);

        {
            let shooter = self
                .players
                .get_mut(player_id)
                .expect("shooter should exist");
            shooter.next_attack_at = now_ms + weapon.attack_interval_ms;
            shooter.attack_queued = false;
            shooter.external_velocity.x += recoil_direction.x
                * weapon.self_recoil_force
                * if shooter_grounded {
                    weapon.self_recoil_ground_multiplier
                } else {
                    weapon.self_recoil_air_multiplier
                };
            shooter.external_velocity.y += recoil_direction.y
                * weapon.self_recoil_force
                * if shooter_grounded {
                    weapon.self_recoil_ground_multiplier
                } else {
                    weapon.self_recoil_air_multiplier
                };

            let remaining = current_resource.saturating_sub(weapon.resource_per_shot);
            if remaining == 0 && weapon.discard_on_empty {
                shooter.snapshot.equipped_weapon_id = "paws".to_string();
                shooter.snapshot.equipped_weapon_resource = None;
            } else {
                shooter.snapshot.equipped_weapon_resource = Some(remaining);
            }
        }

        if let Some(target_id) = target_id {
            let target = self
                .players
                .get_mut(&target_id)
                .expect("target should exist");
            target.external_velocity.x += aim_direction.x * weapon.knockback;
            target.external_velocity.y += aim_direction.y * weapon.knockback;
            target.snapshot.hp = target.snapshot.hp.saturating_sub(weapon.damage);
            if target.snapshot.hp == 0 {
                deaths.push(target_id);
            }
        }
    }

    fn find_hitscan_target(
        &self,
        shooter_id: &str,
        shooter_position: &Vector2,
        aim_direction: &Vector2,
        range: f64,
    ) -> Option<String> {
        self.players
            .iter()
            .filter(|(target_id, target)| {
                target_id.as_str() != shooter_id && target.snapshot.state == PlayerState::Alive
            })
            .filter_map(|(target_id, target)| {
                let to_target = Vector2 {
                    x: target.snapshot.position.x - shooter_position.x,
                    y: target.snapshot.position.y - shooter_position.y,
                };
                let projected = dot(&to_target, aim_direction);
                if !(0.0..=range).contains(&projected) {
                    return None;
                }

                let closest_point = Vector2 {
                    x: shooter_position.x + aim_direction.x * projected,
                    y: shooter_position.y + aim_direction.y * projected,
                };
                let dx = target.snapshot.position.x - closest_point.x;
                let dy = target.snapshot.position.y - closest_point.y;
                let distance_sq = dx * dx + dy * dy;
                (distance_sq <= (PLAYER_HALF_SIZE * PLAYER_HALF_SIZE * 1.5))
                    .then_some((target_id.clone(), projected))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(target_id, _)| target_id)
    }

    fn add_player(
        &mut self,
        player_id: String,
        player_name: String,
        recipient: Recipient<WsText>,
    ) -> RoomSnapshotPayload {
        let spawn_index = self.players.len();
        let spawn = spawn_position(spawn_index);
        let player = PlayerSnapshot {
            id: player_id.clone(),
            name: player_name,
            position: spawn,
            velocity: Vector2 { x: 0.0, y: 0.0 },
            direction: Direction::Right,
            hp: 100,
            lives: TEST_LIVES,
            move_speed_rank: 0,
            max_jump_count: MAX_JUMP_COUNT,
            jump_count_used: 0,
            grounded: false,
            drop_through_until: None,
            respawn_at: None,
            equipped_weapon_id: "paws".to_string(),
            equipped_weapon_resource: None,
            grab_state: None,
            state: PlayerState::Alive,
        };

        self.sessions.insert(player_id.clone(), recipient);
        self.players.insert(
            player_id.clone(),
            PlayerRuntime {
                snapshot: player,
                latest_input: PlayerInputPayload::default(),
                spawn_index,
                external_velocity: Vector2 { x: 0.0, y: 0.0 },
                next_attack_at: 0,
                attack_queued: false,
                attack_was_down: false,
            },
        );

        RoomSnapshotPayload {
            room_id: self.room_id.clone(),
            self_player_id: Some(player_id),
            players: self.player_snapshots(),
            weapon_pickups: self.weapon_pickup_snapshots(),
            item_pickups: vec![],
            match_state: MatchState::Waiting,
        }
    }

    fn remove_player(&mut self, player_id: &str) -> bool {
        self.sessions.remove(player_id);
        self.players.remove(player_id).is_some()
    }

    fn apply_input(&mut self, player_id: &str, input: PlayerInputPayload) {
        if let Some(player) = self.players.get_mut(player_id) {
            if input.attack && !player.attack_was_down {
                player.attack_queued = true;
            }
            player.attack_was_down = input.attack;
            player.latest_input = input;
        }
    }

    fn tick(&mut self, now_ms: u64) -> WorldSnapshotPayload {
        self.server_tick += 1;
        self.time_remaining_ms = self.time_remaining_ms.saturating_sub(TICK_INTERVAL_MS);
        self.cleanup_expired_pickups(now_ms);
        self.refresh_weapon_spawns(now_ms);
        self.step_weapon_pickups();

        let player_ids = self.players.keys().cloned().collect::<Vec<_>>();
        let mut deaths = Vec::new();

        for player_id in &player_ids {
            let Some(player) = self.players.get_mut(player_id) else {
                continue;
            };

            if player.snapshot.state == PlayerState::Respawning {
                if let Some(respawn_at) = player.snapshot.respawn_at {
                    if now_ms >= respawn_at {
                        respawn_player(player);
                    }
                }
                continue;
            }

            step_player(player, now_ms);

            if intersecting_hazard(&player.snapshot).is_some() {
                deaths.push(player_id.clone());
            }
        }

        for player_id in &player_ids {
            let is_alive = self
                .players
                .get(player_id)
                .is_some_and(|player| player.snapshot.state == PlayerState::Alive);
            if !is_alive {
                continue;
            }
            self.drop_equipped_weapon_if_needed(player_id, now_ms);
            self.handle_weapon_pickup(player_id, now_ms);
            self.handle_weapon_attack(player_id, now_ms, &mut deaths);
        }

        for player_id in deaths {
            if let Some(player) = self.players.get_mut(&player_id) {
                trigger_respawn(player, now_ms);
            }
        }

        WorldSnapshotPayload {
            version: 1,
            room_id: self.room_id.clone(),
            match_state: MatchState::Running,
            server_tick: self.server_tick,
            players: self.player_snapshots(),
            projectiles: vec![],
            weapon_pickups: self.weapon_pickup_snapshots(),
            item_pickups: vec![],
            time_remaining_ms: self.time_remaining_ms,
        }
    }
}

fn spawn_position(spawn_index: usize) -> Vector2 {
    let spawn_points = &runtime_map_data().spawn_points;
    spawn_points[spawn_index % spawn_points.len()].clone()
}

fn step_player(player: &mut PlayerRuntime, now_ms: u64) {
    let input = player.latest_input.clone();
    let move_x = input.move_ref().x.clamp(-1.0, 1.0);
    let down_pressed = input.move_ref().y > 0.5;

    if move_x < 0.0 {
        player.snapshot.direction = Direction::Left;
    } else if move_x > 0.0 {
        player.snapshot.direction = Direction::Right;
    } else if input.aim.x < 0.0 {
        player.snapshot.direction = Direction::Left;
    } else if input.aim.x > 0.0 {
        player.snapshot.direction = Direction::Right;
    }

    let on_one_way_platform = is_on_one_way_platform(&player.snapshot);
    let drop_active = player
        .snapshot
        .drop_through_until
        .is_some_and(|until| until > now_ms);

    if input.jump {
        if player.snapshot.grounded && down_pressed && on_one_way_platform {
            player.snapshot.drop_through_until = Some(now_ms + DROP_THROUGH_MS);
            player.snapshot.grounded = false;
            player.snapshot.position.y += 2.0;
            player.snapshot.velocity.y = 2.0;
        } else if player.snapshot.jump_count_used < player.snapshot.max_jump_count {
            player.snapshot.velocity.y = JUMP_VELOCITY;
            player.snapshot.grounded = false;
            player.snapshot.jump_count_used += 1;
        }
    }

    if !player.snapshot.grounded {
        if down_pressed && player.snapshot.velocity.y < 0.0 {
            player.snapshot.velocity.y = 0.0;
        }

        let gravity = if down_pressed {
            FAST_FALL_GRAVITY_PER_TICK
        } else {
            GRAVITY_PER_TICK
        };
        let max_fall_speed = if down_pressed {
            MAX_FAST_FALL_SPEED
        } else {
            MAX_FALL_SPEED
        };
        player.snapshot.velocity.y = (player.snapshot.velocity.y + gravity).min(max_fall_speed);
    }

    let desired_velocity_x = move_x * RUN_SPEED_PER_TICK;
    let combined_velocity_x = desired_velocity_x + player.external_velocity.x;
    let combined_velocity_y = player.snapshot.velocity.y + player.external_velocity.y;

    let previous_position = player.snapshot.position.clone();
    player.snapshot.position.x += combined_velocity_x;
    player.snapshot.position.x = player
        .snapshot
        .position
        .x
        .clamp(PLAYER_HALF_SIZE, world_width() - PLAYER_HALF_SIZE);

    player.snapshot.position.y += combined_velocity_y;

    player.snapshot.grounded = false;
    player.snapshot.velocity.x = combined_velocity_x;
    player.snapshot.velocity.y = combined_velocity_y;

    resolve_wall_collisions(&mut player.snapshot, &previous_position);

    player.external_velocity.x *= if player.snapshot.grounded { 0.5 } else { 0.84 };
    player.external_velocity.y *= 0.84;
    if player.external_velocity.x.abs() < 0.05 {
        player.external_velocity.x = 0.0;
    }
    if player.external_velocity.y.abs() < 0.05 {
        player.external_velocity.y = 0.0;
    }

    let previous_bottom = previous_position.y + PLAYER_HALF_SIZE;
    let current_bottom = player.snapshot.position.y + PLAYER_HALF_SIZE;

    for floor in &runtime_map_data().floor_segments {
        if current_bottom >= floor.top_y
            && surface_contains_x(floor.left_x, floor.right_x, player.snapshot.position.x)
        {
            land_on_surface(player, floor.top_y);
            return;
        }
    }

    if player.snapshot.velocity.y >= 0.0 && !drop_active {
        for platform in &runtime_map_data().one_way_platforms {
            if previous_bottom <= platform.top_y
                && current_bottom >= platform.top_y
                && surface_contains_x(
                    platform.left_x,
                    platform.right_x,
                    player.snapshot.position.x,
                )
            {
                land_on_surface(player, platform.top_y);
                return;
            }
        }
    }
}

fn is_on_one_way_platform(player: &PlayerSnapshot) -> bool {
    player.grounded
        && runtime_map_data().one_way_platforms.iter().any(|platform| {
            (player.position.y + PLAYER_HALF_SIZE - platform.top_y).abs() < 1.0
                && surface_contains_x(platform.left_x, platform.right_x, player.position.x)
        })
}

fn surface_contains_x(left_x: f64, right_x: f64, x: f64) -> bool {
    (left_x..=right_x).contains(&x)
}

fn land_on_surface(player: &mut PlayerRuntime, top_y: f64) {
    player.snapshot.position.y = top_y - PLAYER_HALF_SIZE;
    player.snapshot.velocity.y = 0.0;
    player.snapshot.grounded = true;
    player.snapshot.jump_count_used = 0;
    player.external_velocity.y = 0.0;
}

fn resolve_wall_collisions(player: &mut PlayerSnapshot, previous_position: &Vector2) {
    let current_top = player.position.y - PLAYER_HALF_SIZE;
    let current_bottom = player.position.y + PLAYER_HALF_SIZE;

    for wall in &runtime_map_data().solid_walls {
        if current_bottom <= wall.top_y || current_top >= wall.bottom_y {
            continue;
        }

        let previous_left = previous_position.x - PLAYER_HALF_SIZE;
        let previous_right = previous_position.x + PLAYER_HALF_SIZE;
        let current_left = player.position.x - PLAYER_HALF_SIZE;
        let current_right = player.position.x + PLAYER_HALF_SIZE;

        if previous_left >= wall.x && current_left <= wall.x {
            player.position.x = wall.x + PLAYER_HALF_SIZE;
            player.velocity.x = 0.0;
        } else if previous_right <= wall.x && current_right >= wall.x {
            player.position.x = wall.x - PLAYER_HALF_SIZE;
            player.velocity.x = 0.0;
        }
    }
}

fn intersecting_hazard(player: &PlayerSnapshot) -> Option<HazardKind> {
    let player_left = player.position.x - PLAYER_HALF_SIZE;
    let player_right = player.position.x + PLAYER_HALF_SIZE;
    let player_top = player.position.y - PLAYER_HALF_SIZE;
    let player_bottom = player.position.y + PLAYER_HALF_SIZE;

    runtime_map_data().hazards.iter().find_map(|hazard| {
        let hazard_right = hazard.x + hazard.width;
        let hazard_bottom = hazard.y + hazard.height;
        let overlaps = player_right > hazard.x
            && player_left < hazard_right
            && player_bottom > hazard.y
            && player_top < hazard_bottom;

        overlaps.then_some(hazard.kind)
    })
}

fn trigger_respawn(player: &mut PlayerRuntime, now_ms: u64) {
    if player.snapshot.lives > 0 {
        player.snapshot.lives -= 1;
    }

    player.snapshot.hp = 0;
    player.snapshot.state = PlayerState::Respawning;
    player.snapshot.respawn_at = Some(now_ms + RESPAWN_DELAY_MS);
    player.snapshot.velocity = Vector2 { x: 0.0, y: 0.0 };
    player.external_velocity = Vector2 { x: 0.0, y: 0.0 };
    player.snapshot.grounded = false;
    player.snapshot.jump_count_used = 0;
    player.snapshot.drop_through_until = None;
    player.snapshot.position.y = ground_top_y() + 80.0;
}

fn respawn_player(player: &mut PlayerRuntime) {
    player.snapshot.position = spawn_position(player.spawn_index);
    player.snapshot.velocity = Vector2 { x: 0.0, y: 0.0 };
    player.external_velocity = Vector2 { x: 0.0, y: 0.0 };
    player.snapshot.hp = 100;
    player.snapshot.grounded = false;
    player.snapshot.jump_count_used = 0;
    player.snapshot.drop_through_until = None;
    player.snapshot.respawn_at = None;
    player.snapshot.state = PlayerState::Alive;
}

struct AppState {
    room: Arc<Mutex<RoomState>>,
    next_connection_id: AtomicU64,
    next_player_id: AtomicU64,
}

impl AppState {
    fn new() -> Self {
        Self {
            room: Arc::new(Mutex::new(RoomState::new())),
            next_connection_id: AtomicU64::new(1),
            next_player_id: AtomicU64::new(1),
        }
    }

    fn next_connection_id(&self) -> String {
        format!(
            "conn_{}",
            self.next_connection_id.fetch_add(1, Ordering::Relaxed)
        )
    }

    fn next_player_id(&self) -> String {
        format!(
            "player_{}",
            self.next_player_id.fetch_add(1, Ordering::Relaxed)
        )
    }
}

#[derive(Message)]
#[rtype(result = "()")]
struct WsText(pub String);

struct WsSession {
    connection_id: String,
    player_id: Option<String>,
    app_state: web::Data<AppState>,
    heartbeat_at: Instant,
}

impl WsSession {
    fn new(connection_id: String, app_state: web::Data<AppState>) -> Self {
        Self {
            connection_id,
            player_id: None,
            app_state,
            heartbeat_at: Instant::now(),
        }
    }

    fn send_json<T>(&self, ctx: &mut ws::WebsocketContext<Self>, kind: &'static str, payload: T)
    where
        T: Serialize,
    {
        if let Ok(text) = serialize_message(kind, payload) {
            ctx.text(text);
        }
    }

    fn handle_join_room(&mut self, payload: JoinRoomPayload, ctx: &mut ws::WebsocketContext<Self>) {
        if payload.room_id != room_id() {
            self.send_json(
                ctx,
                "error",
                ErrorPayload {
                    code: "ROOM_NOT_FOUND".to_string(),
                    message: format!("Requested room '{}' does not exist", payload.room_id),
                },
            );
            return;
        }

        if self.player_id.is_some() {
            self.send_json(
                ctx,
                "error",
                ErrorPayload {
                    code: "ALREADY_JOINED".to_string(),
                    message: "Connection already joined a room".to_string(),
                },
            );
            return;
        }

        let player_id = self.app_state.next_player_id();
        let recipient = ctx.address().recipient::<WsText>();

        let room_snapshot = {
            let mut room = self.app_state.room.lock().expect("room mutex poisoned");
            room.add_player(player_id.clone(), payload.player_name.clone(), recipient)
        };

        self.player_id = Some(player_id.clone());
        self.send_json(ctx, "room_snapshot", room_snapshot);
        broadcast_to_room(
            &self.app_state,
            &serialize_message(
                "player_joined",
                PlayerJoinedPayload {
                    player_id,
                    name: payload.player_name,
                },
            )
            .expect("serialize player_joined"),
        );
    }

    fn handle_player_input(
        &mut self,
        payload: PlayerInputPayload,
        ctx: &mut ws::WebsocketContext<Self>,
    ) {
        let Some(player_id) = self.player_id.as_deref() else {
            self.send_json(
                ctx,
                "error",
                ErrorPayload {
                    code: "NOT_JOINED".to_string(),
                    message: "Join a room before sending input".to_string(),
                },
            );
            return;
        };

        let mut room = self.app_state.room.lock().expect("room mutex poisoned");
        room.apply_input(player_id, payload);
    }

    fn start_heartbeat(&self, ctx: &mut ws::WebsocketContext<Self>) {
        ctx.run_interval(
            Duration::from_secs(HEARTBEAT_INTERVAL_SECS),
            |actor, ctx| {
                if actor.heartbeat_at.elapsed() > Duration::from_secs(CLIENT_TIMEOUT_SECS) {
                    log::warn!("WebSocket client timed out: {}", actor.connection_id);
                    ctx.stop();
                    return;
                }

                ctx.ping(b"ping");
            },
        );
    }
}

impl Actor for WsSession {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.start_heartbeat(ctx);
        self.send_json(
            ctx,
            "welcome",
            WelcomePayload {
                connection_id: self.connection_id.clone(),
                server_version: SERVER_VERSION.to_string(),
            },
        );
    }

    fn stopped(&mut self, _: &mut Self::Context) {
        let Some(player_id) = self.player_id.take() else {
            return;
        };

        let removed = {
            let mut room = self.app_state.room.lock().expect("room mutex poisoned");
            room.remove_player(&player_id)
        };

        if removed {
            let message = serialize_message("player_left", PlayerLeftPayload { player_id })
                .expect("serialize player_left");
            broadcast_to_room(&self.app_state, &message);
        }
    }
}

impl Handler<WsText> for WsSession {
    type Result = ();

    fn handle(&mut self, msg: WsText, ctx: &mut Self::Context) -> Self::Result {
        ctx.text(msg.0);
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for WsSession {
    fn handle(&mut self, item: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match item {
            Ok(ws::Message::Text(text)) => {
                let envelope = match serde_json::from_str::<IncomingEnvelope>(&text) {
                    Ok(envelope) => envelope,
                    Err(error) => {
                        self.send_json(
                            ctx,
                            "error",
                            ErrorPayload {
                                code: "INVALID_MESSAGE".to_string(),
                                message: error.to_string(),
                            },
                        );
                        return;
                    }
                };

                match envelope.kind.as_str() {
                    "join_room" => {
                        match serde_json::from_value::<JoinRoomPayload>(envelope.payload) {
                            Ok(payload) => self.handle_join_room(payload, ctx),
                            Err(error) => self.send_json(
                                ctx,
                                "error",
                                ErrorPayload {
                                    code: "INVALID_JOIN_ROOM".to_string(),
                                    message: error.to_string(),
                                },
                            ),
                        }
                    }
                    "player_input" => {
                        match serde_json::from_value::<PlayerInputPayload>(envelope.payload) {
                            Ok(payload) => self.handle_player_input(payload, ctx),
                            Err(error) => self.send_json(
                                ctx,
                                "error",
                                ErrorPayload {
                                    code: "INVALID_PLAYER_INPUT".to_string(),
                                    message: error.to_string(),
                                },
                            ),
                        }
                    }
                    "ping" => {
                        if let Ok(payload) = serde_json::from_value::<PingPayload>(envelope.payload)
                        {
                            self.send_json(ctx, "pong", payload);
                        }
                    }
                    _ => {
                        self.send_json(
                            ctx,
                            "error",
                            ErrorPayload {
                                code: "UNKNOWN_MESSAGE_TYPE".to_string(),
                                message: format!("Unsupported message type: {}", envelope.kind),
                            },
                        );
                    }
                }
            }
            Ok(ws::Message::Ping(bytes)) => {
                self.heartbeat_at = Instant::now();
                ctx.pong(&bytes);
            }
            Ok(ws::Message::Pong(_)) => {
                self.heartbeat_at = Instant::now();
            }
            Ok(ws::Message::Close(reason)) => {
                ctx.close(reason);
                ctx.stop();
            }
            Ok(ws::Message::Binary(_)) => {
                self.send_json(
                    ctx,
                    "error",
                    ErrorPayload {
                        code: "BINARY_NOT_SUPPORTED".to_string(),
                        message: "This server currently accepts JSON text messages only"
                            .to_string(),
                    },
                );
            }
            Ok(ws::Message::Continuation(_)) | Ok(ws::Message::Nop) => {}
            Err(error) => {
                log::warn!("WebSocket protocol error: {}", error);
                ctx.stop();
            }
        }
    }
}

#[derive(Deserialize)]
struct IncomingEnvelope {
    #[serde(rename = "type")]
    kind: String,
    payload: Value,
}

#[derive(Serialize)]
struct OutgoingEnvelope<T> {
    #[serde(rename = "type")]
    kind: &'static str,
    timestamp: u64,
    payload: T,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct JoinRoomPayload {
    room_id: String,
    player_name: String,
}

#[allow(dead_code)]
#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct PlayerInputPayload {
    sequence: u64,
    #[serde(rename = "move")]
    movement: Vector2,
    aim: Vector2,
    jump: bool,
    attack: bool,
    drop_weapon: bool,
}

impl PlayerInputPayload {
    fn move_ref(&self) -> &Vector2 {
        &self.movement
    }
}

#[derive(Deserialize, Serialize)]
struct PingPayload {
    nonce: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WelcomePayload {
    connection_id: String,
    server_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RoomSnapshotPayload {
    room_id: String,
    self_player_id: Option<String>,
    players: Vec<PlayerSnapshot>,
    weapon_pickups: Vec<WorldWeaponPickup>,
    item_pickups: Vec<WorldItemPickup>,
    match_state: MatchState,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorldSnapshotPayload {
    version: u8,
    room_id: String,
    match_state: MatchState,
    server_tick: u64,
    players: Vec<PlayerSnapshot>,
    projectiles: Vec<Value>,
    weapon_pickups: Vec<WorldWeaponPickup>,
    item_pickups: Vec<WorldItemPickup>,
    time_remaining_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerJoinedPayload {
    player_id: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerLeftPayload {
    player_id: String,
}

#[derive(Serialize)]
struct ErrorPayload {
    code: String,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorldWeaponPickup {
    id: String,
    weapon_id: String,
    position: Vector2,
    source: PickupSource,
    resource_remaining: u32,
    spawn_style: SpawnStyle,
    despawn_style: DespawnStyle,
    spawned_at: u64,
    despawn_at: Option<u64>,
    #[serde(skip_serializing)]
    spawn_id: Option<String>,
    #[serde(skip_serializing)]
    respawn_ms: Option<u64>,
    #[serde(skip_serializing)]
    kinematics: PickupKinematics,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorldItemPickup {
    id: String,
    item_id: String,
    position: Vector2,
    source: ItemSource,
    spawned_at: u64,
    despawn_at: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PlayerSnapshot {
    id: String,
    name: String,
    position: Vector2,
    velocity: Vector2,
    direction: Direction,
    hp: u16,
    lives: u8,
    move_speed_rank: i8,
    max_jump_count: u8,
    jump_count_used: u8,
    grounded: bool,
    drop_through_until: Option<u64>,
    respawn_at: Option<u64>,
    equipped_weapon_id: String,
    equipped_weapon_resource: Option<u32>,
    grab_state: Option<GrabState>,
    state: PlayerState,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GrabState {
    target_player_id: String,
    remaining_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum MatchState {
    Waiting,
    Running,
    Finished,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Direction {
    Left,
    Right,
}

#[allow(dead_code)]
#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum PlayerState {
    Alive,
    Respawning,
    Eliminated,
}

#[allow(dead_code)]
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum PickupSource {
    Spawn,
    Dropped,
    Reward,
}

#[allow(dead_code)]
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum ItemSource {
    Spawn,
    Reward,
}

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum SpawnStyle {
    Airdrop,
    FadeIn,
    Triggered,
}

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum DespawnStyle {
    ShrinkPop,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum HitType {
    Melee,
    Hitscan,
    Projectile,
    Beam,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum FireMode {
    Single,
    Burst,
    Auto,
    Channel,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum ResourceModel {
    Infinite,
    Magazine,
    Capacity,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum WeaponRarity {
    Common,
    Uncommon,
    Rare,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct Vector2 {
    x: f64,
    y: f64,
}

fn dot(a: &Vector2, b: &Vector2) -> f64 {
    a.x * b.x + a.y * b.y
}

fn rotate_vector(vector: Vector2, angle_deg: f64) -> Vector2 {
    let radians = angle_deg.to_radians();
    let cos = radians.cos();
    let sin = radians.sin();
    Vector2 {
        x: vector.x * cos - vector.y * sin,
        y: vector.x * sin + vector.y * cos,
    }
}

fn normalize_or_fallback(vector: Vector2, direction: Direction) -> Vector2 {
    let length = (vector.x * vector.x + vector.y * vector.y).sqrt();
    if length > 0.0001 {
        Vector2 {
            x: vector.x / length,
            y: vector.y / length,
        }
    } else {
        match direction {
            Direction::Left => Vector2 { x: -1.0, y: 0.0 },
            Direction::Right => Vector2 { x: 1.0, y: 0.0 },
        }
    }
}

fn pseudo_jitter_deg(seed: u64, max_abs_deg: f64) -> f64 {
    if max_abs_deg == 0.0 {
        return 0.0;
    }

    let mixed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    let normalized = ((mixed >> 33) as f64 / u32::MAX as f64) * 2.0 - 1.0;
    normalized * max_abs_deg
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_millis() as u64
}

fn serialize_message<T: Serialize>(
    kind: &'static str,
    payload: T,
) -> Result<String, serde_json::Error> {
    serde_json::to_string(&OutgoingEnvelope {
        kind,
        timestamp: now_ms(),
        payload,
    })
}

fn broadcast_to_room(app_state: &web::Data<AppState>, text: &str) {
    let recipients = {
        let room = app_state.room.lock().expect("room mutex poisoned");
        room.sessions.values().cloned().collect::<Vec<_>>()
    };

    for recipient in recipients {
        let _ = recipient.try_send(WsText(text.to_string()));
    }
}

fn start_room_loop(app_state: web::Data<AppState>) {
    actix_web::rt::spawn(async move {
        let mut ticker = actix_web::rt::time::interval(Duration::from_millis(TICK_INTERVAL_MS));

        loop {
            ticker.tick().await;
            let message = {
                let mut room = app_state.room.lock().expect("room mutex poisoned");
                let snapshot = room.tick(now_ms());
                serialize_message("world_snapshot", snapshot)
                    .expect("world_snapshot should serialize")
            };
            broadcast_to_room(&app_state, &message);
        }
    });
}

async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    app_state: web::Data<AppState>,
) -> Result<HttpResponse, Error> {
    let connection_id = app_state.next_connection_id();
    ws::start(WsSession::new(connection_id, app_state), &req, stream)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));

    let api_port: u16 = std::env::var("API_PORT")
        .unwrap_or_else(|_| "8081".to_string())
        .parse()
        .expect("API_PORT must be a number");

    let app_state = web::Data::new(AppState::new());
    start_room_loop(app_state.clone());

    log::info!("Starting Battle Hamsters Server on port {}", api_port);

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .route("/health", web::get().to(health))
            .route("/hello", web::get().to(hello))
            .route("/ws", web::get().to(ws_handler))
    })
    .bind(("0.0.0.0", api_port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test as actix_test, App};

    fn test_player(x: f64, y: f64) -> PlayerRuntime {
        PlayerRuntime {
            snapshot: PlayerSnapshot {
                id: "player_test".to_string(),
                name: "hammy".to_string(),
                position: Vector2 { x, y },
                velocity: Vector2 { x: 0.0, y: 0.0 },
                direction: Direction::Right,
                hp: 100,
                lives: TEST_LIVES,
                move_speed_rank: 0,
                max_jump_count: MAX_JUMP_COUNT,
                jump_count_used: 0,
                grounded: false,
                drop_through_until: None,
                respawn_at: None,
                equipped_weapon_id: "paws".to_string(),
                equipped_weapon_resource: None,
                grab_state: None,
                state: PlayerState::Alive,
            },
            latest_input: PlayerInputPayload::default(),
            spawn_index: 0,
            external_velocity: Vector2 { x: 0.0, y: 0.0 },
            next_attack_at: 0,
            attack_queued: false,
            attack_was_down: false,
        }
    }

    #[actix_rt::test]
    async fn test_health() {
        let app =
            actix_test::init_service(App::new().route("/health", web::get().to(health))).await;
        let req = actix_test::TestRequest::get().uri("/health").to_request();
        let resp = actix_test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    #[test]
    fn player_lands_on_floor_outside_pit() {
        let mut player = test_player(180.0, ground_top_y() - PLAYER_HALF_SIZE - 2.0);
        player.snapshot.velocity.y = 8.0;

        step_player(&mut player, 0);

        assert!(player.snapshot.grounded);
        assert_eq!(
            player.snapshot.position.y,
            ground_top_y() - PLAYER_HALF_SIZE
        );
        assert_eq!(player.snapshot.velocity.y, 0.0);
    }

    #[test]
    fn player_does_not_land_inside_fall_zone_gap() {
        let mut player = test_player(
            (pit_left_x() + pit_right_x()) / 2.0,
            ground_top_y() - PLAYER_HALF_SIZE - 2.0,
        );
        player.snapshot.velocity.y = 8.0;

        step_player(&mut player, 0);

        assert!(!player.snapshot.grounded);
        assert!(player.snapshot.position.y > ground_top_y() - PLAYER_HALF_SIZE);
        assert_eq!(intersecting_hazard(&player.snapshot), None);

        for _ in 0..24 {
            step_player(&mut player, 0);
            if intersecting_hazard(&player.snapshot) == Some(HazardKind::FallZone) {
                break;
            }
        }

        assert_eq!(
            intersecting_hazard(&player.snapshot),
            Some(HazardKind::FallZone)
        );
    }

    #[test]
    fn player_collides_with_pit_wall_from_inside() {
        let mut player = test_player(pit_left_x() + PLAYER_HALF_SIZE + 2.0, ground_top_y() + 20.0);
        player.latest_input.movement = Vector2 { x: -1.0, y: 0.0 };

        step_player(&mut player, 0);

        assert_eq!(player.snapshot.position.x, pit_left_x() + PLAYER_HALF_SIZE);
        assert_eq!(player.snapshot.velocity.x, 0.0);
    }

    #[test]
    fn player_still_collides_with_extended_pit_wall_below_screen() {
        let mut player = test_player(pit_left_x() + PLAYER_HALF_SIZE + 2.0, world_height() + 40.0);
        player.latest_input.movement = Vector2 { x: -1.0, y: 0.0 };

        step_player(&mut player, 0);

        assert_eq!(player.snapshot.position.x, pit_left_x() + PLAYER_HALF_SIZE);
        assert_eq!(player.snapshot.velocity.x, 0.0);
    }

    #[test]
    fn instant_kill_hazard_is_separate_from_fall_zone() {
        let player_on_spikes = test_player(660.0, ground_top_y() - PLAYER_HALF_SIZE);
        let player_in_pit = test_player(
            (pit_left_x() + pit_right_x()) / 2.0,
            primary_fall_zone().y + PLAYER_HALF_SIZE + 1.0,
        );

        assert_eq!(
            intersecting_hazard(&player_on_spikes.snapshot),
            Some(HazardKind::InstantKillHazard)
        );
        assert_eq!(
            intersecting_hazard(&player_in_pit.snapshot),
            Some(HazardKind::FallZone)
        );
    }

    #[test]
    fn room_starts_with_spawned_weapon_pickup() {
        let room = RoomState::new();
        assert_eq!(room.weapon_pickups.len(), 1);
        let pickup = room
            .weapon_pickups
            .values()
            .next()
            .expect("spawn pickup should exist");
        assert_eq!(pickup.weapon_id, "acorn_blaster");
        assert_eq!(pickup.resource_remaining, 8);
    }

    #[test]
    fn hitscan_attack_consumes_weapon_and_applies_recoil() {
        let mut room = RoomState::new();

        let shooter = PlayerRuntime {
            snapshot: PlayerSnapshot {
                id: "shooter".to_string(),
                name: "shooter".to_string(),
                position: Vector2 { x: 140.0, y: 120.0 },
                velocity: Vector2 { x: 0.0, y: 0.0 },
                direction: Direction::Right,
                hp: 100,
                lives: TEST_LIVES,
                move_speed_rank: 0,
                max_jump_count: MAX_JUMP_COUNT,
                jump_count_used: 0,
                grounded: true,
                drop_through_until: None,
                respawn_at: None,
                equipped_weapon_id: "acorn_blaster".to_string(),
                equipped_weapon_resource: Some(1),
                grab_state: None,
                state: PlayerState::Alive,
            },
            latest_input: PlayerInputPayload {
                sequence: 1,
                movement: Vector2 { x: 0.0, y: 0.0 },
                aim: Vector2 { x: 1.0, y: 0.0 },
                jump: false,
                attack: true,
                drop_weapon: false,
            },
            spawn_index: 0,
            external_velocity: Vector2 { x: 0.0, y: 0.0 },
            next_attack_at: 0,
            attack_queued: true,
            attack_was_down: true,
        };

        let target = PlayerRuntime {
            snapshot: PlayerSnapshot {
                id: "target".to_string(),
                name: "target".to_string(),
                position: Vector2 { x: 240.0, y: 120.0 },
                velocity: Vector2 { x: 0.0, y: 0.0 },
                direction: Direction::Left,
                hp: 100,
                lives: TEST_LIVES,
                move_speed_rank: 0,
                max_jump_count: MAX_JUMP_COUNT,
                jump_count_used: 0,
                grounded: true,
                drop_through_until: None,
                respawn_at: None,
                equipped_weapon_id: "paws".to_string(),
                equipped_weapon_resource: None,
                grab_state: None,
                state: PlayerState::Alive,
            },
            latest_input: PlayerInputPayload::default(),
            spawn_index: 1,
            external_velocity: Vector2 { x: 0.0, y: 0.0 },
            next_attack_at: 0,
            attack_queued: false,
            attack_was_down: false,
        };

        room.players.insert("shooter".to_string(), shooter);
        room.players.insert("target".to_string(), target);

        let mut deaths = Vec::new();
        room.handle_weapon_attack("shooter", 1000, &mut deaths);

        let shooter_after = room.players.get("shooter").expect("shooter should exist");
        let target_after = room.players.get("target").expect("target should exist");

        assert_eq!(shooter_after.snapshot.equipped_weapon_id, "paws");
        assert_eq!(shooter_after.snapshot.equipped_weapon_resource, None);
        assert!(shooter_after.external_velocity.x < 0.0);
        assert!(target_after.external_velocity.x > 0.0);
        assert_eq!(target_after.snapshot.hp, 88);
        assert!(deaths.is_empty());
    }
}
