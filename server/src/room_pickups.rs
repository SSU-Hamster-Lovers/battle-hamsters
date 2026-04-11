use crate::game_data::{
    item_definition, runtime_map_data, weapon_definition, world_height, SpawnMode,
};
use crate::{
    surface_contains_x, DespawnStyle, ItemSource, PickupKinematics, PickupSource, PlayerRuntime,
    RoomState, SpawnStyle, Vector2, WorldItemPickup, WorldWeaponPickup, ITEM_PICKUP_RADIUS, MAX_HP,
    PICKUP_CULL_MARGIN, PICKUP_GRAVITY_PER_TICK, PICKUP_HALF_HEIGHT, PICKUP_MAX_FALL_SPEED,
};

impl RoomState {
    pub(crate) fn spawn_initial_weapons(&mut self, now_ms: u64) {
        let spawns = runtime_map_data().weapon_spawns.clone();
        let grouped_spawns = group_weapon_spawns(&spawns);
        for (_, candidates) in grouped_spawns {
            let spawn = select_weapon_spawn_candidate(&candidates, now_ms);
            self.spawn_weapon_from_spawn(&spawn, now_ms);
        }
    }

    pub(crate) fn spawn_initial_items(&mut self, now_ms: u64) {
        let spawns = runtime_map_data().item_spawns.clone();
        let grouped_spawns = group_item_spawns(&spawns);
        for (_, candidates) in grouped_spawns {
            let spawn = select_item_spawn_candidate(&candidates, now_ms);
            self.spawn_item_from_spawn(&spawn, now_ms);
        }
    }

    fn next_world_pickup_id(&mut self) -> String {
        let id = format!("weapon_pickup_{}", self.next_weapon_pickup_id);
        self.next_weapon_pickup_id += 1;
        id
    }

    fn next_world_item_pickup_id(&mut self) -> String {
        let id = format!("item_pickup_{}", self.next_item_pickup_id);
        self.next_item_pickup_id += 1;
        id
    }

    fn spawn_weapon_from_spawn(
        &mut self,
        spawn: &crate::game_data::RuntimeWeaponSpawnPoint,
        now_ms: u64,
    ) {
        let definition = weapon_definition(&spawn.weapon_id);
        let affected_by_gravity = matches!(spawn.spawn_style, SpawnStyle::Airdrop);
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
            spawn_cycle_key: spawn_cycle_key_for_weapon(spawn),
            respawn_ms: Some(spawn.respawn_ms),
            kinematics: PickupKinematics {
                velocity_y: 0.0,
                grounded: !affected_by_gravity,
                affected_by_gravity,
            },
            pickup_blocked_until: None,
            pickup_blocked_player_id: None,
        };
        self.weapon_pickups.insert(pickup.id.clone(), pickup);
    }

    pub(crate) fn create_dropped_pickup(
        &mut self,
        player_id: &str,
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
            spawn_cycle_key: None,
            respawn_ms: None,
            kinematics: PickupKinematics {
                velocity_y: 0.0,
                grounded: false,
                affected_by_gravity: true,
            },
            pickup_blocked_until: Some(now_ms + 250),
            pickup_blocked_player_id: Some(player_id.to_string()),
        };
        self.weapon_pickups.insert(pickup.id.clone(), pickup);
    }

    fn spawn_item_from_spawn(
        &mut self,
        spawn: &crate::game_data::RuntimeItemSpawnPoint,
        now_ms: u64,
    ) {
        let affected_by_gravity = matches!(spawn.spawn_style, SpawnStyle::Airdrop);
        let pickup = WorldItemPickup {
            id: self.next_world_item_pickup_id(),
            item_id: spawn.item_id.clone(),
            position: spawn.position.clone(),
            source: ItemSource::Spawn,
            spawned_at: now_ms,
            despawn_at: None,
            spawn_style: spawn.spawn_style,
            spawn_cycle_key: spawn_cycle_key_for_item(spawn),
            respawn_ms: Some(spawn.respawn_ms),
            kinematics: PickupKinematics {
                velocity_y: 0.0,
                grounded: !affected_by_gravity,
                affected_by_gravity,
            },
        };
        self.item_pickups.insert(pickup.id.clone(), pickup);
    }

    pub(crate) fn weapon_pickup_snapshots(&self) -> Vec<WorldWeaponPickup> {
        self.weapon_pickups.values().cloned().collect()
    }

    pub(crate) fn item_pickup_snapshots(&self) -> Vec<WorldItemPickup> {
        self.item_pickups.values().cloned().collect()
    }

    pub(crate) fn refresh_weapon_spawns(&mut self, now_ms: u64) {
        let spawns = runtime_map_data().weapon_spawns.clone();
        let grouped_spawns = group_weapon_spawns(&spawns);
        for (cycle_key, candidates) in grouped_spawns {
            let active = self
                .weapon_pickups
                .values()
                .any(|pickup| pickup.spawn_cycle_key.as_deref() == Some(cycle_key.as_str()));
            if active {
                continue;
            }

            let ready = self
                .next_spawn_respawn_at
                .get(&cycle_key)
                .is_none_or(|respawn_at| now_ms >= *respawn_at);
            if ready {
                self.next_spawn_respawn_at.remove(&cycle_key);
                let spawn = select_weapon_spawn_candidate(&candidates, now_ms);
                self.spawn_weapon_from_spawn(&spawn, now_ms);
            }
        }
    }

    pub(crate) fn refresh_item_spawns(&mut self, now_ms: u64) {
        let spawns = runtime_map_data().item_spawns.clone();
        let grouped_spawns = group_item_spawns(&spawns);
        for (cycle_key, candidates) in grouped_spawns {
            let active = self
                .item_pickups
                .values()
                .any(|pickup| pickup.spawn_cycle_key.as_deref() == Some(cycle_key.as_str()));
            if active {
                continue;
            }

            let ready = self
                .next_item_spawn_respawn_at
                .get(&cycle_key)
                .is_none_or(|respawn_at| now_ms >= *respawn_at);
            if ready {
                self.next_item_spawn_respawn_at.remove(&cycle_key);
                let spawn = select_item_spawn_candidate(&candidates, now_ms);
                self.spawn_item_from_spawn(&spawn, now_ms);
            }
        }
    }

    pub(crate) fn cull_out_of_world_pickups(&mut self, now_ms: u64) {
        let weapon_ids: Vec<String> = self
            .weapon_pickups
            .iter()
            .filter_map(|(id, pickup)| {
                pickup_out_of_world(&pickup.position).then_some(id.clone())
            })
            .collect();

        for pickup_id in weapon_ids {
            if let Some(pickup) = self.weapon_pickups.remove(&pickup_id) {
                if let (Some(spawn_cycle_key), Some(respawn_ms)) =
                    (pickup.spawn_cycle_key, pickup.respawn_ms)
                {
                    self.next_spawn_respawn_at
                        .insert(spawn_cycle_key, now_ms + respawn_ms);
                }
            }
        }

        let item_ids: Vec<String> = self
            .item_pickups
            .iter()
            .filter_map(|(id, pickup)| {
                pickup_out_of_world(&pickup.position).then_some(id.clone())
            })
            .collect();

        for pickup_id in item_ids {
            if let Some(pickup) = self.item_pickups.remove(&pickup_id) {
                if let (Some(spawn_cycle_key), Some(respawn_ms)) =
                    (pickup.spawn_cycle_key, pickup.respawn_ms)
                {
                    self.next_item_spawn_respawn_at
                        .insert(spawn_cycle_key, now_ms + respawn_ms);
                }
            }
        }
    }

    pub(crate) fn cleanup_expired_pickups(&mut self, now_ms: u64) {
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
                if let (Some(spawn_cycle_key), Some(respawn_ms)) =
                    (pickup.spawn_cycle_key, pickup.respawn_ms)
                {
                    self.next_spawn_respawn_at
                        .insert(spawn_cycle_key, now_ms + respawn_ms);
                }
            }
        }
    }

    pub(crate) fn step_weapon_pickups(&mut self) {
        for pickup in self.weapon_pickups.values_mut() {
            if !pickup.kinematics.affected_by_gravity || pickup.kinematics.grounded {
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

    pub(crate) fn step_item_pickups(&mut self) {
        for pickup in self.item_pickups.values_mut() {
            if !pickup.kinematics.affected_by_gravity || pickup.kinematics.grounded {
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

    pub(crate) fn drop_equipped_weapon_if_needed(&mut self, player_id: &str, now_ms: u64) {
        let Some(player_view) = self.players.get(player_id) else {
            return;
        };

        if !player_view.latest_input.drop_weapon_pressed
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
            self.create_dropped_pickup(
                player_id,
                drop_payload.0,
                drop_payload.1,
                drop_payload.2,
                now_ms,
            );
        }
    }

    fn pickup_near_player(
        &self,
        player_id: &str,
        player: &PlayerRuntime,
        now_ms: u64,
    ) -> Option<String> {
        self.weapon_pickups
            .iter()
            .filter_map(|(pickup_id, pickup)| {
                if pickup
                    .pickup_blocked_player_id
                    .as_deref()
                    .is_some_and(|blocked_player_id| blocked_player_id == player_id)
                    && pickup
                        .pickup_blocked_until
                        .is_some_and(|blocked_until| now_ms < blocked_until)
                {
                    return None;
                }
                let dx = pickup.position.x - player.snapshot.position.x;
                let dy = pickup.position.y - player.snapshot.position.y;
                let distance_sq = dx * dx + dy * dy;
                (distance_sq <= 36.0 * 36.0).then_some((pickup_id.clone(), distance_sq))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(pickup_id, _)| pickup_id)
    }

    fn item_pickup_near_player(&self, player: &PlayerRuntime) -> Option<String> {
        self.item_pickups
            .iter()
            .filter_map(|(pickup_id, pickup)| {
                let dx = pickup.position.x - player.snapshot.position.x;
                let dy = pickup.position.y - player.snapshot.position.y;
                let distance_sq = dx * dx + dy * dy;
                (distance_sq <= ITEM_PICKUP_RADIUS * ITEM_PICKUP_RADIUS)
                    .then_some((pickup_id.clone(), distance_sq))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(pickup_id, _)| pickup_id)
    }

    pub(crate) fn handle_weapon_pickup(&mut self, player_id: &str, now_ms: u64) {
        let wants_pickup = self
            .players
            .get(player_id)
            .is_some_and(|player| player.latest_input.pickup_weapon_pressed);
        if !wants_pickup {
            return;
        }

        let Some(pickup_id) = self
            .players
            .get(player_id)
            .and_then(|player| self.pickup_near_player(player_id, player, now_ms))
        else {
            return;
        };

        let Some(pickup) = self.weapon_pickups.remove(&pickup_id) else {
            return;
        };

        if let (Some(spawn_cycle_key), Some(respawn_ms)) =
            (pickup.spawn_cycle_key.clone(), pickup.respawn_ms)
        {
            self.next_spawn_respawn_at
                .insert(spawn_cycle_key, now_ms + respawn_ms);
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
            self.create_dropped_pickup(player_id, weapon_id, resource_remaining, position, now_ms);
        }
    }

    pub(crate) fn handle_item_pickup(&mut self, player_id: &str, now_ms: u64) {
        let Some(pickup_id) = self
            .players
            .get(player_id)
            .and_then(|player| self.item_pickup_near_player(player))
        else {
            return;
        };

        let Some(pickup) = self.item_pickups.remove(&pickup_id) else {
            return;
        };

        if let (Some(spawn_cycle_key), Some(respawn_ms)) =
            (pickup.spawn_cycle_key.clone(), pickup.respawn_ms)
        {
            self.next_item_spawn_respawn_at
                .insert(spawn_cycle_key, now_ms + respawn_ms);
        }

        let item = item_definition(&pickup.item_id).clone();
        let base_jump_count = self.gameplay_config.base_jump_count;
        let max_jump_count_limit = self.gameplay_config.max_jump_count_limit;
        let Some(player) = self.players.get_mut(player_id) else {
            return;
        };

        match item.item_type {
            crate::game_data::ItemType::JumpBoost => {
                if let Some(jump_count_delta) = item.effect.jump_count_delta {
                    let next_jump_count = (player.snapshot.max_jump_count as i16
                        + jump_count_delta as i16)
                        .clamp(base_jump_count as i16, max_jump_count_limit as i16)
                        as u8;
                    player.snapshot.max_jump_count = next_jump_count;
                }
            }
            crate::game_data::ItemType::HealthRecover => {
                if let Some(heal_amount) = item.effect.heal_amount {
                    player.snapshot.hp = player.snapshot.hp.saturating_add(heal_amount).min(MAX_HP);
                }
            }
            crate::game_data::ItemType::ExtraLife => {
                if let Some(extra_lives) = item.effect.extra_lives {
                    player.snapshot.lives = player.snapshot.lives.saturating_add(extra_lives);
                }
            }
            crate::game_data::ItemType::SpeedRankUp => {
                if let Some(speed_rank_delta) = item.effect.speed_rank_delta {
                    player.snapshot.move_speed_rank = (player.snapshot.move_speed_rank as i16
                        + speed_rank_delta as i16)
                        .clamp(-7, 7) as i8;
                }
            }
        }
    }
}

fn spawn_cycle_key_for_weapon(spawn: &crate::game_data::RuntimeWeaponSpawnPoint) -> Option<String> {
    Some(match spawn.mode {
        SpawnMode::Fixed => spawn.id.clone(),
        SpawnMode::RandomCandidates => spawn
            .spawn_group_id
            .clone()
            .unwrap_or_else(|| spawn.id.clone()),
    })
}

fn spawn_cycle_key_for_item(spawn: &crate::game_data::RuntimeItemSpawnPoint) -> Option<String> {
    Some(match spawn.mode {
        SpawnMode::Fixed => spawn.id.clone(),
        SpawnMode::RandomCandidates => spawn
            .spawn_group_id
            .clone()
            .unwrap_or_else(|| spawn.id.clone()),
    })
}

fn group_weapon_spawns(
    spawns: &[crate::game_data::RuntimeWeaponSpawnPoint],
) -> Vec<(String, Vec<crate::game_data::RuntimeWeaponSpawnPoint>)> {
    let mut groups: Vec<(String, Vec<crate::game_data::RuntimeWeaponSpawnPoint>)> = Vec::new();
    for spawn in spawns {
        let key = spawn_cycle_key_for_weapon(spawn).expect("weapon spawn key should exist");
        if let Some((_, entries)) = groups.iter_mut().find(|(group_key, _)| *group_key == key) {
            entries.push(spawn.clone());
        } else {
            groups.push((key, vec![spawn.clone()]));
        }
    }
    groups
}

fn group_item_spawns(
    spawns: &[crate::game_data::RuntimeItemSpawnPoint],
) -> Vec<(String, Vec<crate::game_data::RuntimeItemSpawnPoint>)> {
    let mut groups: Vec<(String, Vec<crate::game_data::RuntimeItemSpawnPoint>)> = Vec::new();
    for spawn in spawns {
        let key = spawn_cycle_key_for_item(spawn).expect("item spawn key should exist");
        if let Some((_, entries)) = groups.iter_mut().find(|(group_key, _)| *group_key == key) {
            entries.push(spawn.clone());
        } else {
            groups.push((key, vec![spawn.clone()]));
        }
    }
    groups
}

fn select_weapon_spawn_candidate(
    candidates: &[crate::game_data::RuntimeWeaponSpawnPoint],
    now_ms: u64,
) -> crate::game_data::RuntimeWeaponSpawnPoint {
    let index = select_candidate_index(candidates.len(), now_ms);
    candidates[index].clone()
}

fn select_item_spawn_candidate(
    candidates: &[crate::game_data::RuntimeItemSpawnPoint],
    now_ms: u64,
) -> crate::game_data::RuntimeItemSpawnPoint {
    let index = select_candidate_index(candidates.len(), now_ms);
    candidates[index].clone()
}

fn select_candidate_index(candidate_len: usize, now_ms: u64) -> usize {
    if candidate_len <= 1 {
        return 0;
    }

    ((now_ms / 10) as usize) % candidate_len
}

fn pickup_out_of_world(position: &Vector2) -> bool {
    if position.y > world_height() + PICKUP_CULL_MARGIN {
        return true;
    }

    for hazard in &runtime_map_data().hazards {
        let within_x = position.x >= hazard.x && position.x <= hazard.x + hazard.width;
        let within_y = position.y >= hazard.y && position.y <= hazard.y + hazard.height;
        if within_x && within_y {
            return true;
        }
    }

    false
}
