use crate::game_data::{ground_top_y, runtime_map_data, world_width, HazardKind};
use crate::room_combat::{respawn_player, trigger_respawn};
use crate::{
    DeathCause, PlayerRuntime, PlayerSnapshot, PlayerState, RoomState, Vector2, PLAYER_HALF_SIZE,
};
use crate::{
    WorldSnapshotPayload, DROP_THROUGH_MS, FAST_FALL_GRAVITY_PER_TICK, GRAVITY_PER_TICK,
    JUMP_VELOCITY, MAX_FALL_SPEED, MAX_FAST_FALL_SPEED, RUN_SPEED_PER_TICK,
};

impl RoomState {
    pub(crate) fn tick(&mut self, now_ms: u64) -> WorldSnapshotPayload {
        self.server_tick += 1;
        self.time_remaining_ms = self
            .time_remaining_ms
            .saturating_sub(crate::TICK_INTERVAL_MS);
        self.cleanup_kill_feed(now_ms);
        self.cleanup_expired_pickups(now_ms);
        self.refresh_weapon_spawns(now_ms);
        self.refresh_item_spawns(now_ms);
        self.step_weapon_pickups();
        self.step_item_pickups();

        let player_ids = self.players.keys().cloned().collect::<Vec<_>>();
        let mut deaths: Vec<(String, DeathCause)> = Vec::new();

        for player_id in &player_ids {
            let Some(player) = self.players.get_mut(player_id) else {
                continue;
            };

            if player.snapshot.state == PlayerState::Respawning {
                if let Some(respawn_at) = player.snapshot.respawn_at {
                    if now_ms >= respawn_at {
                        respawn_player(
                            player,
                            spawn_position(player.spawn_index),
                            &self.gameplay_config,
                        );
                    }
                }
                continue;
            }

            step_player(player, now_ms);

            if let Some(kind) = intersecting_hazard(&player.snapshot) {
                let cause = match kind {
                    HazardKind::FallZone => DeathCause::FallZone,
                    HazardKind::InstantKillHazard => DeathCause::InstantKillHazard,
                };
                deaths.push((player_id.clone(), cause));
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
            self.handle_item_pickup(player_id, now_ms);
            self.drop_equipped_weapon_if_needed(player_id, now_ms);
            self.handle_weapon_pickup(player_id, now_ms);
            self.handle_weapon_attack(player_id, now_ms, &mut deaths);
        }

        for (player_id, cause) in deaths {
            self.push_kill_feed(player_id.clone(), cause, now_ms);
            if let Some(player) = self.players.get_mut(&player_id) {
                trigger_respawn(player, now_ms, ground_top_y(), &self.gameplay_config);
            }
        }

        WorldSnapshotPayload {
            version: 1,
            room_id: self.room_id.clone(),
            match_state: crate::MatchState::Running,
            server_tick: self.server_tick,
            players: self.player_snapshots(),
            projectiles: vec![],
            weapon_pickups: self.weapon_pickup_snapshots(),
            item_pickups: self.item_pickup_snapshots(),
            time_remaining_ms: self.time_remaining_ms,
            kill_feed: self.kill_feed_snapshot(),
        }
    }
}

pub(crate) fn spawn_position(spawn_index: usize) -> Vector2 {
    let spawn_points = &runtime_map_data().spawn_points;
    spawn_points[spawn_index % spawn_points.len()].clone()
}

pub(crate) fn surface_contains_x(left_x: f64, right_x: f64, x: f64) -> bool {
    (left_x..=right_x).contains(&x)
}

pub(crate) fn step_player(player: &mut PlayerRuntime, now_ms: u64) {
    let input = player.latest_input.clone();
    let move_x = input.move_ref().x.clamp(-1.0, 1.0);
    let down_pressed = input.move_ref().y > 0.5;

    if move_x < 0.0 {
        player.snapshot.direction = crate::Direction::Left;
    } else if move_x > 0.0 {
        player.snapshot.direction = crate::Direction::Right;
    } else if input.aim.x < 0.0 {
        player.snapshot.direction = crate::Direction::Left;
    } else if input.aim.x > 0.0 {
        player.snapshot.direction = crate::Direction::Right;
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

pub(crate) fn intersecting_hazard(player: &PlayerSnapshot) -> Option<HazardKind> {
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
