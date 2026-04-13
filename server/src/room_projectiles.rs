use std::collections::HashSet;

use crate::{
    game_data::{runtime_map_data, RuntimeWeaponDefinition, RuntimeWeaponSpecialEffect},
    room_combat::apply_or_refresh_burn,
    DeathCause, LastHitInfo, PlayerState, ProjectileRuntime, RoomState, Vector2, PLAYER_HALF_SIZE,
    TICK_INTERVAL_MS,
};

const EXPLOSION_KNOCKBACK_PER_UNIT: f64 = 0.2;

const PROJECTILE_SPAWN_OFFSET: f64 = PLAYER_HALF_SIZE + 6.0;
const PROJECTILE_HIT_RADIUS: f64 = PLAYER_HALF_SIZE * 1.225;
const EPSILON: f64 = 0.0001;

enum ProjectileCollision {
    Player {
        target_id: String,
        hit_fraction: f64,
    },
    Terrain {
        hit_fraction: f64,
    },
}

impl RoomState {
    pub(crate) fn spawn_projectiles(
        &mut self,
        shooter_id: &str,
        weapon: &RuntimeWeaponDefinition,
        aims: &[Vector2],
        shooter_position: &Vector2,
        now_ms: u64,
    ) {
        if weapon.projectile_speed <= 0.0 {
            return;
        }

        for aim in aims {
            let projectile_id = format!("proj_{}_{}", self.server_tick, self.next_projectile_id);
            self.next_projectile_id += 1;

            self.projectiles.insert(
                projectile_id.clone(),
                ProjectileRuntime {
                    id: projectile_id,
                    owner_id: shooter_id.to_string(),
                    weapon_id: weapon.id.clone(),
                    position: Vector2 {
                        x: shooter_position.x + aim.x * PROJECTILE_SPAWN_OFFSET,
                        y: shooter_position.y + aim.y * PROJECTILE_SPAWN_OFFSET,
                    },
                    velocity: Vector2 {
                        x: aim.x * weapon.projectile_speed,
                        y: aim.y * weapon.projectile_speed,
                    },
                    gravity_per_sec2: weapon.projectile_gravity_per_sec2,
                    damage: weapon.damage,
                    knockback: weapon.knockback,
                    range_remaining: weapon.range,
                    special_effect: weapon.special_effect.clone(),
                    spawned_at: now_ms,
                },
            );
        }
    }

    pub(crate) fn step_projectiles(
        &mut self,
        now_ms: u64,
        deaths: &mut Vec<(String, DeathCause)>,
        dying_this_tick: &mut HashSet<String>,
    ) {
        let projectile_ids = self.projectiles.keys().cloned().collect::<Vec<_>>();
        let mut consumed_projectiles = Vec::new();

        for projectile_id in projectile_ids {
            let Some(projectile) = self.projectiles.get(&projectile_id).cloned() else {
                continue;
            };

            if now_ms < projectile.spawned_at {
                continue;
            }

            let dt = TICK_INTERVAL_MS as f64 / 1000.0;
            let next_velocity = Vector2 {
                x: projectile.velocity.x,
                y: projectile.velocity.y + projectile.gravity_per_sec2 * dt,
            };
            let average_velocity = Vector2 {
                x: (projectile.velocity.x + next_velocity.x) * 0.5,
                y: (projectile.velocity.y + next_velocity.y) * 0.5,
            };
            let mut displacement = Vector2 {
                x: average_velocity.x * dt,
                y: average_velocity.y * dt,
            };
            let displacement_len = vector_length(&displacement);
            if displacement_len <= EPSILON || projectile.range_remaining <= EPSILON {
                consumed_projectiles.push(projectile_id);
                continue;
            }

            let travel_scale = (projectile.range_remaining / displacement_len).min(1.0);
            displacement.x *= travel_scale;
            displacement.y *= travel_scale;
            let travel_distance = vector_length(&displacement);
            let direction = normalized(&displacement);
            let next_position = Vector2 {
                x: projectile.position.x + displacement.x,
                y: projectile.position.y + displacement.y,
            };

            match self.find_projectile_collision(
                &projectile,
                &projectile.position,
                &next_position,
                dying_this_tick,
            ) {
                Some(ProjectileCollision::Player {
                    target_id,
                    hit_fraction,
                }) => {
                    let impact_point = Vector2 {
                        x: projectile.position.x
                            + (next_position.x - projectile.position.x) * hit_fraction,
                        y: projectile.position.y
                            + (next_position.y - projectile.position.y) * hit_fraction,
                    };
                    let target_hp_after_hit = {
                        let target = self
                            .players
                            .get_mut(&target_id)
                            .expect("projectile target should exist");
                        target.external_velocity.x += direction.x * projectile.knockback;
                        target.external_velocity.y += direction.y * projectile.knockback;
                        target.snapshot.hp = target.snapshot.hp.saturating_sub(projectile.damage);
                        target.last_hit_by = Some(LastHitInfo {
                            killer_id: projectile.owner_id.clone(),
                            weapon_id: projectile.weapon_id.clone(),
                            hit_at_ms: now_ms,
                        });
                        target.snapshot.hp
                    };

                    self.push_damage_event(
                        target_id.clone(),
                        projectile.owner_id.clone(),
                        projectile.weapon_id.clone(),
                        projectile.damage,
                        direction.clone(),
                        impact_point.clone(),
                        now_ms,
                    );

                    if target_hp_after_hit == 0 && dying_this_tick.insert(target_id.clone()) {
                        deaths.push((
                            target_id.clone(),
                            DeathCause::Weapon {
                                killer_id: projectile.owner_id.clone(),
                                weapon_id: projectile.weapon_id.clone(),
                            },
                        ));
                    } else if let RuntimeWeaponSpecialEffect::Burn {
                        duration_ms,
                        tick_damage,
                        tick_interval_ms,
                    } = projectile.special_effect.clone()
                    {
                        if let Some(target) = self.players.get_mut(&target_id) {
                            apply_or_refresh_burn(
                                target,
                                projectile.weapon_id.clone(),
                                Some(projectile.owner_id.clone()),
                                now_ms,
                                duration_ms,
                                tick_damage,
                                tick_interval_ms,
                            );
                        }
                    }

                    // 폭발 특수효과: 직격 지점 기준 범위 피해
                    if let RuntimeWeaponSpecialEffect::Explode {
                        radius: Some(radius),
                        splash_damage: Some(splash_damage),
                        ..
                    } = projectile.special_effect.clone()
                    {
                        self.apply_explosion(
                            &projectile.owner_id,
                            &projectile.weapon_id,
                            &impact_point,
                            radius,
                            splash_damage,
                            projectile.knockback,
                            now_ms,
                            deaths,
                            dying_this_tick,
                        );
                    }

                    consumed_projectiles.push(projectile_id);
                }
                Some(ProjectileCollision::Terrain { hit_fraction }) => {
                    // 지형 충돌 시 폭발 특수효과
                    if let RuntimeWeaponSpecialEffect::Explode {
                        radius: Some(radius),
                        splash_damage: Some(splash_damage),
                        ..
                    } = projectile.special_effect.clone()
                    {
                        let terrain_impact = Vector2 {
                            x: projectile.position.x
                                + (next_position.x - projectile.position.x) * hit_fraction,
                            y: projectile.position.y
                                + (next_position.y - projectile.position.y) * hit_fraction,
                        };
                        self.apply_explosion(
                            &projectile.owner_id,
                            &projectile.weapon_id,
                            &terrain_impact,
                            radius,
                            splash_damage,
                            projectile.knockback,
                            now_ms,
                            deaths,
                            dying_this_tick,
                        );
                    }
                    consumed_projectiles.push(projectile_id);
                }
                None => {
                    if let Some(runtime) = self.projectiles.get_mut(&projectile_id) {
                        runtime.position = next_position;
                        runtime.velocity = next_velocity;
                        runtime.range_remaining =
                            (runtime.range_remaining - travel_distance).max(0.0);
                        if runtime.range_remaining <= EPSILON {
                            consumed_projectiles.push(projectile_id);
                        }
                    }
                }
            }
        }

        consumed_projectiles.sort();
        consumed_projectiles.dedup();
        for projectile_id in consumed_projectiles {
            self.projectiles.remove(&projectile_id);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_explosion(
        &mut self,
        owner_id: &str,
        weapon_id: &str,
        explosion_center: &Vector2,
        radius: f64,
        splash_damage: u16,
        base_knockback: f64,
        now_ms: u64,
        deaths: &mut Vec<(String, DeathCause)>,
        dying_this_tick: &mut HashSet<String>,
    ) {
        let target_ids: Vec<String> = self
            .players
            .iter()
            .filter(|(id, target)| {
                id.as_str() != owner_id
                    && target.snapshot.state == PlayerState::Alive
                    && !dying_this_tick.contains(id.as_str())
            })
            .filter_map(|(id, target)| {
                let dx = target.snapshot.position.x - explosion_center.x;
                let dy = target.snapshot.position.y - explosion_center.y;
                let dist = (dx * dx + dy * dy).sqrt();
                if dist <= radius {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();

        for target_id in target_ids {
            let Some(target) = self.players.get(&target_id) else {
                continue;
            };
            let dx = target.snapshot.position.x - explosion_center.x;
            let dy = target.snapshot.position.y - explosion_center.y;
            let dist = (dx * dx + dy * dy).sqrt().max(1.0);
            let knockback_dir = Vector2 {
                x: dx / dist,
                y: dy / dist,
            };
            // 거리에 비례한 넉백 (가까울수록 강함)
            let knockback_scale = (1.0 - dist / radius).max(0.0) + EXPLOSION_KNOCKBACK_PER_UNIT;

            let target_hp_after = {
                let target = self
                    .players
                    .get_mut(&target_id)
                    .expect("target should exist");
                target.external_velocity.x += knockback_dir.x * base_knockback * knockback_scale;
                target.external_velocity.y += knockback_dir.y * base_knockback * knockback_scale;
                target.snapshot.hp = target.snapshot.hp.saturating_sub(splash_damage);
                target.last_hit_by = Some(LastHitInfo {
                    killer_id: owner_id.to_string(),
                    weapon_id: weapon_id.to_string(),
                    hit_at_ms: now_ms,
                });
                target.snapshot.hp
            };

            self.push_damage_event(
                target_id.clone(),
                owner_id.to_string(),
                weapon_id.to_string(),
                splash_damage,
                knockback_dir,
                explosion_center.clone(),
                now_ms,
            );

            if target_hp_after == 0 && dying_this_tick.insert(target_id.clone()) {
                deaths.push((
                    target_id,
                    DeathCause::Weapon {
                        killer_id: owner_id.to_string(),
                        weapon_id: weapon_id.to_string(),
                    },
                ));
            }
        }
    }

    fn find_projectile_collision(
        &self,
        projectile: &ProjectileRuntime,
        start: &Vector2,
        end: &Vector2,
        dying_this_tick: &HashSet<String>,
    ) -> Option<ProjectileCollision> {
        let player_hit = self
            .players
            .iter()
            .filter(|(target_id, target)| {
                target_id.as_str() != projectile.owner_id
                    && target.snapshot.state == PlayerState::Alive
                    && !dying_this_tick.contains(target_id.as_str())
            })
            .filter_map(|(target_id, target)| {
                segment_circle_intersection_fraction(
                    start,
                    end,
                    &target.snapshot.position,
                    PROJECTILE_HIT_RADIUS,
                )
                .map(|hit_fraction| ProjectileCollision::Player {
                    target_id: target_id.clone(),
                    hit_fraction,
                })
            })
            .min_by(|left, right| {
                collision_fraction(left)
                    .partial_cmp(&collision_fraction(right))
                    .expect("collision fractions should be comparable")
            });

        let terrain_hit = terrain_intersection_fraction(start, end)
            .map(|hit_fraction| ProjectileCollision::Terrain { hit_fraction });

        match (player_hit, terrain_hit) {
            (Some(player), Some(terrain)) => {
                if collision_fraction(&player) <= collision_fraction(&terrain) {
                    Some(player)
                } else {
                    Some(terrain)
                }
            }
            (Some(player), None) => Some(player),
            (None, Some(terrain)) => Some(terrain),
            (None, None) => None,
        }
    }
}

fn collision_fraction(collision: &ProjectileCollision) -> f64 {
    match collision {
        ProjectileCollision::Player { hit_fraction, .. } => *hit_fraction,
        ProjectileCollision::Terrain { hit_fraction } => *hit_fraction,
    }
}

fn vector_length(vector: &Vector2) -> f64 {
    (vector.x * vector.x + vector.y * vector.y).sqrt()
}

fn normalized(vector: &Vector2) -> Vector2 {
    let length = vector_length(vector);
    if length <= EPSILON {
        return Vector2 { x: 1.0, y: 0.0 };
    }
    Vector2 {
        x: vector.x / length,
        y: vector.y / length,
    }
}

fn segment_circle_intersection_fraction(
    start: &Vector2,
    end: &Vector2,
    center: &Vector2,
    radius: f64,
) -> Option<f64> {
    let segment = Vector2 {
        x: end.x - start.x,
        y: end.y - start.y,
    };
    let to_start = Vector2 {
        x: start.x - center.x,
        y: start.y - center.y,
    };

    let a = segment.x * segment.x + segment.y * segment.y;
    if a <= EPSILON {
        return None;
    }

    let c = to_start.x * to_start.x + to_start.y * to_start.y - radius * radius;
    if c <= 0.0 {
        return Some(0.0);
    }

    let b = 2.0 * (to_start.x * segment.x + to_start.y * segment.y);
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 {
        return None;
    }

    let sqrt_discriminant = discriminant.sqrt();
    let t1 = (-b - sqrt_discriminant) / (2.0 * a);
    let t2 = (-b + sqrt_discriminant) / (2.0 * a);

    [t1, t2]
        .into_iter()
        .filter(|t| (0.0..=1.0).contains(t))
        .min_by(|left, right| left.partial_cmp(right).expect("t should be comparable"))
}

fn terrain_intersection_fraction(start: &Vector2, end: &Vector2) -> Option<f64> {
    let map = runtime_map_data();
    let mut earliest: Option<f64> = None;

    for floor in &map.floor_segments {
        consider_fraction(
            &mut earliest,
            segment_horizontal_intersection_fraction(
                start,
                end,
                floor.top_y,
                floor.left_x,
                floor.right_x,
            ),
        );
    }

    for platform in &map.one_way_platforms {
        consider_fraction(
            &mut earliest,
            segment_one_way_surface_intersection_fraction(
                start,
                end,
                platform.top_y,
                platform.left_x,
                platform.right_x,
            ),
        );
    }

    for wall in &map.solid_walls {
        consider_fraction(
            &mut earliest,
            segment_vertical_intersection_fraction(start, end, wall.x, wall.top_y, wall.bottom_y),
        );
    }

    earliest
}

fn consider_fraction(slot: &mut Option<f64>, candidate: Option<f64>) {
    let Some(candidate) = candidate else {
        return;
    };
    if !(0.0..=1.0).contains(&candidate) {
        return;
    }
    match slot {
        Some(current) if *current <= candidate => {}
        _ => *slot = Some(candidate),
    }
}

fn segment_horizontal_intersection_fraction(
    start: &Vector2,
    end: &Vector2,
    y: f64,
    left_x: f64,
    right_x: f64,
) -> Option<f64> {
    let dy = end.y - start.y;
    if dy.abs() <= EPSILON {
        return None;
    }

    let t = (y - start.y) / dy;
    if !(0.0..=1.0).contains(&t) {
        return None;
    }

    let x = start.x + (end.x - start.x) * t;
    (left_x..=right_x).contains(&x).then_some(t)
}

fn segment_one_way_surface_intersection_fraction(
    start: &Vector2,
    end: &Vector2,
    y: f64,
    left_x: f64,
    right_x: f64,
) -> Option<f64> {
    let dy = end.y - start.y;
    if dy <= EPSILON {
        return None;
    }
    if start.y > y || end.y < y {
        return None;
    }

    segment_horizontal_intersection_fraction(start, end, y, left_x, right_x)
}

fn segment_vertical_intersection_fraction(
    start: &Vector2,
    end: &Vector2,
    x: f64,
    top_y: f64,
    bottom_y: f64,
) -> Option<f64> {
    let dx = end.x - start.x;
    if dx.abs() <= EPSILON {
        return None;
    }

    let t = (x - start.x) / dx;
    if !(0.0..=1.0).contains(&t) {
        return None;
    }

    let y = start.y + (end.y - start.y) * t;
    (top_y..=bottom_y).contains(&y).then_some(t)
}
