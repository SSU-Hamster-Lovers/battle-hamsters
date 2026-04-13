use std::collections::HashSet;

use crate::{
    game_data::RuntimeWeaponSpecialEffect,
    room_config::RoomGameplayConfig,
    weapon_definition,
    BurnEffect, DeathCause, Direction, FireMode, HitType, LastHitInfo, PlayerRuntime, PlayerState,
    RoomState, StatusEffectSnapshot, Vector2, PLAYER_HALF_SIZE, RESPAWN_DELAY_MS,
};

impl RoomState {
    pub(crate) fn handle_weapon_attack(
        &mut self,
        player_id: &str,
        now_ms: u64,
        deaths: &mut Vec<(String, DeathCause)>,
        dying_this_tick: &mut HashSet<String>,
    ) {
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

        // Melee weapons (infinite resource, cone-based hit detection)
        if matches!(weapon_definition(&weapon_id).hit_type, HitType::Melee) {
            let weapon = weapon_definition(&weapon_id);
            let shooter_position = shooter_view.snapshot.position.clone();
            let aim_direction = normalize_or_fallback(
                shooter_view.latest_input.aim.clone(),
                shooter_view.snapshot.direction,
            );
            // shooter_view is no longer used below this line

            if let Some(shooter) = self.players.get_mut(player_id) {
                shooter.next_attack_at = now_ms + weapon.attack_interval_ms;
                shooter.attack_queued = false;
            }

            let target_id = self.find_melee_target(
                player_id,
                &shooter_position,
                &aim_direction,
                weapon.range,
                dying_this_tick,
            );

            if let Some(target_id) = target_id {
                let target_position = self
                    .players
                    .get(&target_id)
                    .expect("target should exist")
                    .snapshot
                    .position
                    .clone();
                let impact_point = Vector2 {
                    x: target_position.x - aim_direction.x * PLAYER_HALF_SIZE * 0.5,
                    y: target_position.y - aim_direction.y * PLAYER_HALF_SIZE * 0.5,
                };
                let weapon_damage = weapon.damage;
                let weapon_knockback = weapon.knockback;
                let target_hp_after_hit = {
                    let target = self
                        .players
                        .get_mut(&target_id)
                        .expect("target should exist");
                    target.external_velocity.x += aim_direction.x * weapon_knockback;
                    target.external_velocity.y += aim_direction.y * weapon_knockback;
                    target.snapshot.hp = target.snapshot.hp.saturating_sub(weapon_damage);
                    target.last_hit_by = Some(LastHitInfo {
                        killer_id: player_id.to_string(),
                        weapon_id: weapon_id.clone(),
                        hit_at_ms: now_ms,
                    });
                    target.snapshot.hp
                };
                self.push_damage_event(
                    target_id.clone(),
                    player_id.to_string(),
                    weapon_id.clone(),
                    weapon_damage,
                    aim_direction,
                    impact_point,
                    now_ms,
                );
                if target_hp_after_hit == 0 && dying_this_tick.insert(target_id.clone()) {
                    deaths.push((
                        target_id,
                        DeathCause::Weapon {
                            killer_id: player_id.to_string(),
                            weapon_id: weapon_id.clone(),
                        },
                    ));
                } else if let RuntimeWeaponSpecialEffect::Burn {
                    duration_ms,
                    tick_damage,
                    tick_interval_ms,
                } = weapon.special_effect
                {
                    if let Some(target) = self.players.get_mut(&target_id) {
                        apply_or_refresh_burn(
                            target,
                            weapon_id.clone(),
                            Some(player_id.to_string()),
                            now_ms,
                            duration_ms,
                            tick_damage,
                            tick_interval_ms,
                        );
                    }
                }
            }
            return;
        }

        let weapon = weapon_definition(&weapon_id).clone();
        if !matches!(weapon.hit_type, HitType::Hitscan)
            || !matches!(weapon.fire_mode, FireMode::Single)
        {
            return;
        }

        let Some(current_resource) = shooter_view.snapshot.equipped_weapon_resource else {
            if let Some(shooter) = self.players.get_mut(player_id) {
                shooter.attack_queued = false;
            }
            return;
        };
        if current_resource < weapon.resource_per_shot {
            if let Some(shooter) = self.players.get_mut(player_id) {
                shooter.attack_queued = false;
            }
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
        let target_id = self.find_hitscan_target(
            player_id,
            &shooter_position,
            &aim_direction,
            weapon.range,
            dying_this_tick,
        );

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
            let target_position = self
                .players
                .get(&target_id)
                .expect("target should exist")
                .snapshot
                .position
                .clone();
            let impact_point = Vector2 {
                x: target_position.x - aim_direction.x * PLAYER_HALF_SIZE * 0.65,
                y: target_position.y - 6.0 - aim_direction.y * PLAYER_HALF_SIZE * 0.35,
            };
            let target_hp_after_hit = {
                let target = self
                    .players
                    .get_mut(&target_id)
                    .expect("target should exist");
                target.external_velocity.x += aim_direction.x * weapon.knockback;
                target.external_velocity.y += aim_direction.y * weapon.knockback;
                target.snapshot.hp = target.snapshot.hp.saturating_sub(weapon.damage);
                target.last_hit_by = Some(LastHitInfo {
                    killer_id: player_id.to_string(),
                    weapon_id: weapon_id.clone(),
                    hit_at_ms: now_ms,
                });
                target.snapshot.hp
            };
            self.push_damage_event(
                target_id.clone(),
                player_id.to_string(),
                weapon_id.clone(),
                weapon.damage,
                aim_direction.clone(),
                impact_point,
                now_ms,
            );
            if target_hp_after_hit == 0 && dying_this_tick.insert(target_id.clone()) {
                deaths.push((
                    target_id,
                    DeathCause::Weapon {
                        killer_id: player_id.to_string(),
                        weapon_id: weapon_id.clone(),
                    },
                ));
            } else if let RuntimeWeaponSpecialEffect::Burn {
                duration_ms,
                tick_damage,
                tick_interval_ms,
            } = weapon.special_effect
            {
                if let Some(target) = self.players.get_mut(&target_id) {
                    apply_or_refresh_burn(
                        target,
                        weapon_id.clone(),
                        Some(player_id.to_string()),
                        now_ms,
                        duration_ms,
                        tick_damage,
                        tick_interval_ms,
                    );
                }
            }
        }
    }

    fn find_melee_target(
        &self,
        attacker_id: &str,
        attacker_position: &Vector2,
        aim_direction: &Vector2,
        range: f64,
        dying_this_tick: &HashSet<String>,
    ) -> Option<String> {
        // Truncated cone: starts at PLAYER_HALF_SIZE (body edge) from attacker center,
        // ends at PLAYER_HALF_SIZE + range. Half-width grows linearly from
        // PLAYER_HALF_SIZE * 0.5 (narrow) to PLAYER_HALF_SIZE * 1.5 (wide).
        let hit_start = PLAYER_HALF_SIZE;
        let hit_end = PLAYER_HALF_SIZE + range;
        let near_half_w = PLAYER_HALF_SIZE * 0.5;
        let far_half_w = PLAYER_HALF_SIZE * 1.5;

        self.players
            .iter()
            .filter(|(id, target)| {
                id.as_str() != attacker_id
                    && target.snapshot.state == PlayerState::Alive
                    && !dying_this_tick.contains(id.as_str())
            })
            .filter_map(|(id, target)| {
                let to_target = Vector2 {
                    x: target.snapshot.position.x - attacker_position.x,
                    y: target.snapshot.position.y - attacker_position.y,
                };
                let d_forward = dot(&to_target, aim_direction);
                if !(hit_start..=hit_end).contains(&d_forward) {
                    return None;
                }
                // 2D cross product magnitude = perpendicular distance to aim axis
                let d_perp =
                    (to_target.x * aim_direction.y - to_target.y * aim_direction.x).abs();
                let t = (d_forward - hit_start) / range;
                let max_half_w = near_half_w + (far_half_w - near_half_w) * t;
                if d_perp > max_half_w {
                    return None;
                }
                Some((id.clone(), d_forward))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(id, _)| id)
    }

    fn find_hitscan_target(
        &self,
        shooter_id: &str,
        shooter_position: &Vector2,
        aim_direction: &Vector2,
        range: f64,
        dying_this_tick: &HashSet<String>,
    ) -> Option<String> {
        self.players
            .iter()
            .filter(|(target_id, target)| {
                target_id.as_str() != shooter_id
                    && target.snapshot.state == PlayerState::Alive
                    && !dying_this_tick.contains(target_id.as_str())
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

    pub(crate) fn tick_burn_effects(
        &mut self,
        now_ms: u64,
        deaths: &mut Vec<(String, DeathCause)>,
        dying_this_tick: &mut HashSet<String>,
    ) {
        // 번 상태 처리에 필요한 정보를 먼저 수집 (borrow 충돌 방지)
        struct BurnTick {
            player_id: String,
            expired: bool,
            should_tick: bool,
            damage: u16,
            next_tick_at: u64,
            attacker_id: String,
            weapon_id: String,
            impact_point: Vector2,
        }

        let ticks: Vec<BurnTick> = self
            .players
            .iter()
            .filter_map(|(player_id, player)| {
                if player.snapshot.state != PlayerState::Alive {
                    return None;
                }
                let burn = player.active_burn.as_ref()?;
                let expired = now_ms >= burn.expires_at;
                let should_tick = !expired && now_ms >= burn.next_tick_at;
                Some(BurnTick {
                    player_id: player_id.clone(),
                    expired,
                    should_tick,
                    damage: burn.tick_damage,
                    next_tick_at: burn.next_tick_at + burn.tick_interval_ms,
                    attacker_id: burn
                        .killer_id
                        .clone()
                        .unwrap_or_else(|| player_id.clone()),
                    weapon_id: burn.weapon_id.clone(),
                    impact_point: player.snapshot.position.clone(),
                })
            })
            .collect();

        for tick in ticks {
            if tick.expired {
                if let Some(player) = self.players.get_mut(&tick.player_id) {
                    player.active_burn = None;
                    player.snapshot.effects.clear();
                }
                continue;
            }

            if !tick.should_tick {
                continue;
            }

            // 데미지 적용 + 다음 틱 갱신
            let hp_after = {
                let player = self
                    .players
                    .get_mut(&tick.player_id)
                    .expect("player should exist");
                player.snapshot.hp = player.snapshot.hp.saturating_sub(tick.damage);
                if let Some(b) = player.active_burn.as_mut() {
                    b.next_tick_at = tick.next_tick_at;
                }
                player.snapshot.hp
            };

            self.push_damage_event(
                tick.player_id.clone(),
                tick.attacker_id.clone(),
                tick.weapon_id.clone(),
                tick.damage,
                Vector2 { x: 0.0, y: -1.0 },
                tick.impact_point,
                now_ms,
            );

            if hp_after == 0 && dying_this_tick.insert(tick.player_id.clone()) {
                deaths.push((
                    tick.player_id,
                    DeathCause::Weapon {
                        killer_id: tick.attacker_id,
                        weapon_id: tick.weapon_id,
                    },
                ));
            }
        }
    }
}

pub(crate) fn reset_general_combat_state(
    player: &mut PlayerRuntime,
    gameplay_config: &RoomGameplayConfig,
) {
    player.snapshot.move_speed_rank = 0;
    player.snapshot.max_jump_count = gameplay_config.base_jump_count;
    player.snapshot.jump_count_used = 0;
    player.snapshot.drop_through_until = None;
    player.snapshot.equipped_weapon_id = "paws".to_string();
    player.snapshot.equipped_weapon_resource = None;
    player.snapshot.velocity = Vector2 { x: 0.0, y: 0.0 };
    player.external_velocity = Vector2 { x: 0.0, y: 0.0 };
    player.snapshot.grounded = false;
    player.attack_queued = false;
    player.attack_was_down = false;
    player.next_attack_at = 0;
    player.last_hit_by = None;
    player.active_burn = None;
    player.snapshot.effects.clear();
}

pub(crate) fn apply_or_refresh_burn(
    player: &mut PlayerRuntime,
    weapon_id: String,
    killer_id: Option<String>,
    now_ms: u64,
    duration_ms: u64,
    tick_damage: u16,
    tick_interval_ms: u64,
) {
    let expires_at = now_ms + duration_ms;
    let next_tick_at = now_ms + tick_interval_ms;

    player.active_burn = Some(BurnEffect {
        killer_id: killer_id.clone(),
        weapon_id: weapon_id.clone(),
        expires_at,
        next_tick_at,
        tick_damage,
        tick_interval_ms,
    });

    player.snapshot.effects.clear();
    player.snapshot.effects.push(StatusEffectSnapshot {
        kind: "burn",
        killer_id,
        weapon_id,
        expires_at,
    });
}

pub(crate) fn trigger_respawn(
    player: &mut PlayerRuntime,
    now_ms: u64,
    cause: DeathCause,
    gameplay_config: &RoomGameplayConfig,
) {
    if player.snapshot.lives > 0 {
        player.snapshot.lives -= 1;
    }

    player.snapshot.hp = 0;
    player.snapshot.state = PlayerState::Respawning;
    player.snapshot.respawn_at = Some(now_ms + RESPAWN_DELAY_MS);
    player.snapshot.last_death_cause = Some(cause);
    reset_general_combat_state(player, gameplay_config);
}

pub(crate) fn respawn_player(
    player: &mut PlayerRuntime,
    spawn_position: Vector2,
    gameplay_config: &RoomGameplayConfig,
) {
    player.snapshot.position = spawn_position;
    reset_general_combat_state(player, gameplay_config);
    player.snapshot.hp = gameplay_config.start_hp;
    player.snapshot.respawn_at = None;
    player.snapshot.last_death_cause = None;
    player.snapshot.state = PlayerState::Alive;
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
