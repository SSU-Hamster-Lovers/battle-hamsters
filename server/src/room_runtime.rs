use std::collections::HashSet;

use crate::game_data::{runtime_map_data, world_width, HazardKind};
use crate::room_combat::{respawn_player, trigger_respawn};
use crate::{
    DeathCause, MatchState, PlayerRuntime, PlayerSnapshot, PlayerState, RoomState, RoomType,
    Vector2, LAST_HIT_TTL_MS, MATCH_COUNTDOWN_MS, MATCH_MIN_PLAYERS, MATCH_RESULT_DISPLAY_MS,
    PLAYER_HALF_SIZE,
};
use crate::{
    WorldSnapshotPayload, DROP_THROUGH_MS, FAST_FALL_GRAVITY_PER_TICK, GRAVITY_PER_TICK,
    JUMP_VELOCITY, MAX_FALL_SPEED, MAX_FAST_FALL_SPEED, RUN_SPEED_PER_TICK,
};

impl RoomState {
    pub(crate) fn tick(&mut self, now_ms: u64) -> WorldSnapshotPayload {
        self.server_tick += 1;
        self.cleanup_kill_feed(now_ms);
        self.cleanup_damage_events(now_ms);

        // 매치 상태 전환 (Match 룸만)
        if self.room_type == RoomType::Match {
            self.tick_match_state(now_ms);
        }

        // Running (또는 FreePlay) 상태에서만 게임 물리 진행
        let is_gameplay_active =
            self.match_state == MatchState::Running || self.room_type == RoomType::FreePlay;

        if is_gameplay_active {
            self.time_remaining_ms = self
                .time_remaining_ms
                .saturating_sub(crate::TICK_INTERVAL_MS);

            self.cleanup_expired_pickups(now_ms);
            self.refresh_weapon_spawns(now_ms);
            self.refresh_item_spawns(now_ms);
            self.step_weapon_pickups();
            self.step_item_pickups();
            self.cull_out_of_world_pickups(now_ms);

            self.tick_gameplay(now_ms);

            // 매치룸에서 시간 소진 → Finished
            if self.room_type == RoomType::Match
                && self.match_state == MatchState::Running
                && self.time_remaining_ms == 0
            {
                self.match_state = MatchState::Finished;
                self.result_display_until_ms = Some(now_ms + MATCH_RESULT_DISPLAY_MS);
            }
        }

        let countdown_ms = self.countdown_remaining_ms(now_ms);

        WorldSnapshotPayload {
            version: 1,
            room_id: self.room_id.clone(),
            match_state: self.match_state,
            countdown_ms,
            server_tick: self.server_tick,
            players: self.player_snapshots(),
            projectiles: self.projectile_snapshots(),
            weapon_pickups: self.weapon_pickup_snapshots(),
            item_pickups: self.item_pickup_snapshots(),
            time_remaining_ms: self.time_remaining_ms,
            kill_feed: self.kill_feed_snapshot(),
            damage_events: self.damage_event_snapshot(),
        }
    }

    fn tick_match_state(&mut self, now_ms: u64) {
        match self.match_state {
            MatchState::Waiting => {
                let alive_count = self.sessions.len();
                if alive_count >= MATCH_MIN_PLAYERS {
                    if self.countdown_start_ms.is_none() {
                        self.countdown_start_ms = Some(now_ms);
                    }
                    if let Some(start) = self.countdown_start_ms {
                        if now_ms.saturating_sub(start) >= MATCH_COUNTDOWN_MS {
                            self.start_match(now_ms);
                        }
                    }
                } else {
                    self.countdown_start_ms = None;
                }
            }
            MatchState::Running => {
                // 시간 소진 체크는 tick() 본체에서 처리
            }
            MatchState::Finished => {
                // 자동 재시작 안 함 — 방은 Finished 상태로 유지.
                // 모든 플레이어가 나가면 유령 방 정리(10분)에 의해 제거됨.
            }
        }
    }

    fn start_match(&mut self, now_ms: u64) {
        self.match_state = MatchState::Running;
        self.countdown_start_ms = None;
        self.time_remaining_ms = self.gameplay_config.time_limit_ms;

        // 모든 플레이어 점수 리셋 + 리스폰
        for player in self.players.values_mut() {
            player.snapshot.kills = 0;
            player.snapshot.deaths = 0;
            crate::room_combat::reset_general_combat_state(player, &self.gameplay_config);
            player.snapshot.hp = self.gameplay_config.start_hp;
            player.snapshot.position = spawn_position(player.spawn_index);
            player.snapshot.state = PlayerState::Alive;
            player.snapshot.respawn_at = None;
            player.snapshot.last_death_cause = None;
        }

        // 무기/아이템 초기화
        self.projectiles.clear();
        self.weapon_pickups.clear();
        self.item_pickups.clear();
        self.next_spawn_respawn_at.clear();
        self.next_item_spawn_respawn_at.clear();
        self.spawn_initial_weapons(now_ms);
        self.spawn_initial_items(now_ms);
        self.kill_feed.clear();
        self.damage_events.clear();
    }

    fn reset_match(&mut self, now_ms: u64) {
        self.match_state = MatchState::Waiting;
        self.result_display_until_ms = None;
        self.countdown_start_ms = None;

        // 플레이어 점수 리셋 + 리스폰
        for player in self.players.values_mut() {
            player.snapshot.kills = 0;
            player.snapshot.deaths = 0;
            crate::room_combat::reset_general_combat_state(player, &self.gameplay_config);
            player.snapshot.hp = self.gameplay_config.start_hp;
            player.snapshot.position = spawn_position(player.spawn_index);
            player.snapshot.state = PlayerState::Alive;
            player.snapshot.respawn_at = None;
            player.snapshot.last_death_cause = None;
        }

        self.projectiles.clear();
        self.weapon_pickups.clear();
        self.item_pickups.clear();
        self.next_spawn_respawn_at.clear();
        self.next_item_spawn_respawn_at.clear();
        self.spawn_initial_weapons(now_ms);
        self.spawn_initial_items(now_ms);
        self.kill_feed.clear();
        self.damage_events.clear();
        self.time_remaining_ms = self.gameplay_config.time_limit_ms;
    }

    fn tick_gameplay(&mut self, now_ms: u64) {
        let player_ids = self.players.keys().cloned().collect::<Vec<_>>();
        let mut deaths: Vec<(String, DeathCause)> = Vec::new();
        let mut dying_this_tick: HashSet<String> = HashSet::new();

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
                if dying_this_tick.insert(player_id.clone()) {
                    let cause = hazard_death_cause(player, kind, now_ms);
                    deaths.push((player_id.clone(), cause));
                }
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

            // 버튼을 누르고 있는 동안 쿨다운이 만료되면 자동 재큐잉한다.
            // attack_pressed는 edge trigger이므로 held 상태에서는 attack_was_down으로 판단한다.
            if let Some(player) = self.players.get_mut(player_id) {
                if player.attack_was_down && !player.attack_queued && now_ms >= player.next_attack_at
                {
                    player.attack_queued = true;
                }
            }

            self.handle_weapon_attack(player_id, now_ms, &mut deaths, &mut dying_this_tick);
        }

        self.step_projectiles(now_ms, &mut deaths, &mut dying_this_tick);
        self.tick_burn_effects(now_ms, &mut deaths, &mut dying_this_tick);

        for (player_id, cause) in deaths {
            // 점수 추적: killer +1 kill, victim +1 death
            if let DeathCause::Weapon { ref killer_id, .. } = cause {
                if let Some(killer) = self.players.get_mut(killer_id) {
                    killer.snapshot.kills += 1;
                }
            }
            if let Some(victim) = self.players.get_mut(&player_id) {
                victim.snapshot.deaths += 1;
            }

            self.push_kill_feed(player_id.clone(), cause.clone(), now_ms);
            if let Some(player) = self.players.get_mut(&player_id) {
                trigger_respawn(player, now_ms, cause, &self.gameplay_config);
            }
        }
    }

    fn countdown_remaining_ms(&self, now_ms: u64) -> Option<u64> {
        if self.match_state != MatchState::Waiting {
            return None;
        }
        self.countdown_start_ms
            .map(|start| MATCH_COUNTDOWN_MS.saturating_sub(now_ms.saturating_sub(start)))
    }
}

fn hazard_death_cause(player: &PlayerRuntime, kind: HazardKind, now_ms: u64) -> DeathCause {
    if let Some(ref hit) = player.last_hit_by {
        if now_ms.saturating_sub(hit.hit_at_ms) <= LAST_HIT_TTL_MS {
            return DeathCause::Weapon {
                killer_id: hit.killer_id.clone(),
                weapon_id: hit.weapon_id.clone(),
            };
        }
    }
    match kind {
        HazardKind::FallZone => DeathCause::FallZone,
        HazardKind::InstantKillHazard => DeathCause::InstantKillHazard,
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

    if input.aim.x.abs() >= 0.12 {
        player.snapshot.direction = if input.aim.x < 0.0 {
            crate::Direction::Left
        } else {
            crate::Direction::Right
        };
    }
    // abs(aim.x) < 0.12 → 수직 조준 deadzone: 이전 방향 유지

    let on_one_way_platform = is_on_one_way_platform(&player.snapshot);

    if input.jump {
        if player.snapshot.grounded && down_pressed && on_one_way_platform {
            // source 플랫폼 ID를 기억해 해당 플랫폼만 무시한다 (전역 무시 제거)
            let source_id = runtime_map_data()
                .one_way_platforms
                .iter()
                .find(|platform| {
                    (player.snapshot.position.y + PLAYER_HALF_SIZE - platform.top_y).abs() < 1.0
                        && surface_contains_x(
                            platform.left_x,
                            platform.right_x,
                            player.snapshot.position.x,
                        )
                })
                .map(|platform| platform.id.clone());
            player.drop_through_platform_id = source_id;
            player.snapshot.drop_through_until = Some(now_ms + DROP_THROUGH_MS);
            player.snapshot.grounded = false;
            player.snapshot.position.y += 2.0;
            player.vertical_velocity = 2.0;
        } else if player.snapshot.jump_count_used < player.snapshot.max_jump_count {
            player.vertical_velocity = JUMP_VELOCITY;
            player.snapshot.grounded = false;
            player.snapshot.jump_count_used += 1;
        }
    }

    if !player.snapshot.grounded {
        if down_pressed && player.vertical_velocity < 0.0 {
            player.vertical_velocity = 0.0;
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
        player.vertical_velocity = (player.vertical_velocity + gravity).min(max_fall_speed);
    }

    let desired_velocity_x = move_x * RUN_SPEED_PER_TICK;
    let combined_velocity_x = desired_velocity_x + player.external_velocity.x;
    let combined_velocity_y = player.vertical_velocity + player.external_velocity.y;

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

    // source 플랫폼 무시 해제 조건 (Option C): 플레이어 바닥이 source 플랫폼 아래로
    // DROP_CLEAR_MARGIN 이상 내려가면 해당 플랫폼을 다시 착지 후보로 되돌린다.
    const DROP_CLEAR_MARGIN: f64 = 8.0;
    if let Some(ref src_id) = player.drop_through_platform_id.clone() {
        let src_top_y = runtime_map_data()
            .one_way_platforms
            .iter()
            .find(|p| &p.id == src_id)
            .map(|p| p.top_y);

        let should_clear = match src_top_y {
            Some(top_y) => current_bottom > top_y + DROP_CLEAR_MARGIN,
            None => true,
        };
        if should_clear {
            player.drop_through_platform_id = None;
            player.snapshot.drop_through_until = None;
        }
    } else if player
        .snapshot
        .drop_through_until
        .is_some_and(|until| until <= now_ms)
    {
        player.snapshot.drop_through_until = None;
    }

    if player.snapshot.velocity.y >= 0.0 {
        for platform in &runtime_map_data().one_way_platforms {
            // source 플랫폼만 건너뛴다 — 다른 플랫폼은 정상 착지 후보
            if player.drop_through_platform_id.as_deref() == Some(platform.id.as_str()) {
                continue;
            }
            if previous_bottom <= platform.top_y
                && current_bottom >= platform.top_y
                && surface_contains_x(
                    platform.left_x,
                    platform.right_x,
                    player.snapshot.position.x,
                )
            {
                land_on_surface(player, platform.top_y);
                player.drop_through_platform_id = None;
                player.snapshot.drop_through_until = None;
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
    player.vertical_velocity = 0.0;
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
