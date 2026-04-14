use std::collections::HashSet;

use crate::{
    room_combat::trigger_respawn, DeathCause, PlayerState, RoomState, StatusEffectSnapshot,
    WorldEventKind, PLAYER_HALF_SIZE, TICK_INTERVAL_MS,
};

const AIRSTRIKE_KNOCKBACK_UPWARD: f64 = -0.6; // 공습 넉백 방향: 위쪽 비율

impl RoomState {
    /// WorldEvent를 처리한다: trigger_at_ms에 도달한 이벤트를 발동하고 제거한다.
    pub(crate) fn step_world_events(
        &mut self,
        now_ms: u64,
        deaths: &mut Vec<(String, DeathCause)>,
        dying_this_tick: &mut HashSet<String>,
    ) {
        // 발동할 이벤트 수집 (borrow checker 우회)
        let triggering: Vec<_> = self
            .world_events
            .iter()
            .filter(|e| now_ms >= e.trigger_at_ms)
            .cloned()
            .collect();

        for event in &triggering {
            match &event.kind {
                WorldEventKind::Airstrike {
                    x,
                    column_half_width,
                    splash_damage,
                    knockback,
                    attacker_id,
                    weapon_id,
                } => {
                    let hit_x = *x;
                    let half_w = *column_half_width;
                    let dmg = *splash_damage;
                    let kb = *knockback;
                    let attacker = attacker_id.clone();
                    let wid = weapon_id.clone();

                    // 열 안에 있는 모든 살아 있는 플레이어에게 피해 + 넉백
                    let targets: Vec<String> = self
                        .players
                        .iter()
                        .filter(|(id, p)| {
                            p.snapshot.state == PlayerState::Alive
                                && !dying_this_tick.contains(id.as_str())
                                && (p.snapshot.position.x - hit_x).abs() < half_w + PLAYER_HALF_SIZE
                        })
                        .map(|(id, _)| id.clone())
                        .collect();

                    for target_id in targets {
                        let target_hp_after = {
                            let Some(target) = self.players.get_mut(&target_id) else {
                                continue;
                            };
                            // 위쪽 + 수평 중심 방향 넉백
                            let dx = target.snapshot.position.x - hit_x;
                            let dir_x = if dx.abs() < 1.0 { 0.0 } else { dx.signum() };
                            target.external_velocity.x += dir_x * kb * 0.4;
                            target.external_velocity.y += AIRSTRIKE_KNOCKBACK_UPWARD * kb;
                            target.snapshot.hp = target.snapshot.hp.saturating_sub(dmg);
                            target.snapshot.hp
                        };
                        self.push_damage_event(
                            target_id.clone(),
                            attacker.clone(),
                            wid.clone(),
                            dmg,
                            crate::Vector2 { x: 0.0, y: 1.0 },
                            self.players
                                .get(&target_id)
                                .map(|p| p.snapshot.position.clone())
                                .unwrap_or(crate::Vector2 { x: hit_x, y: 0.0 }),
                            now_ms,
                        );
                        if target_hp_after == 0 && dying_this_tick.insert(target_id.clone()) {
                            deaths.push((
                                target_id,
                                DeathCause::Weapon {
                                    killer_id: attacker.clone(),
                                    weapon_id: wid.clone(),
                                },
                            ));
                        }
                    }
                }
            }
        }

        // 발동된 이벤트 제거
        self.world_events
            .retain(|e| now_ms < e.trigger_at_ms);
    }

    /// 공습 WorldEvent를 예약한다. room_projectiles에서 호출.
    pub(crate) fn spawn_airstrike_event(
        &mut self,
        x: f64,
        delay_ms: u64,
        column_half_width: f64,
        splash_damage: u16,
        knockback: f64,
        attacker_id: String,
        weapon_id: String,
        now_ms: u64,
    ) {
        let id = self.next_world_event_id;
        self.next_world_event_id += 1;
        self.world_events.push(crate::WorldEventRuntime {
            id,
            kind: WorldEventKind::Airstrike {
                x,
                column_half_width,
                splash_damage,
                knockback,
                attacker_id,
                weapon_id,
            },
            trigger_at_ms: now_ms + delay_ms,
        });
    }
}
