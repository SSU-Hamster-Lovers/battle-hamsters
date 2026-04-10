#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RoomGameplayConfig {
    pub(crate) start_hp: u16,
    pub(crate) stock_lives: u8,
    pub(crate) base_jump_count: u8,
    pub(crate) max_jump_count_limit: u8,
    pub(crate) time_limit_ms: u64,
}

impl Default for RoomGameplayConfig {
    fn default() -> Self {
        Self {
            start_hp: crate::MAX_HP,
            stock_lives: crate::TEST_LIVES,
            base_jump_count: crate::BASE_MAX_JUMP_COUNT,
            max_jump_count_limit: 3,
            time_limit_ms: crate::DEFAULT_TIME_LIMIT_MS,
        }
    }
}
