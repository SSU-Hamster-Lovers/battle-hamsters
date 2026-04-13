# 미니 스펙: 서버 aim clamp v1

작업명:
`fix/server-aim-clamp-v1`

목표:
`aimProfile`이 있는 무기에서 클라이언트에 보이는 조준 각도와 서버 실제 발사 판정이 어긋나지 않도록 맞춘다.

이번 범위:
- 서버 발사 직전 `latest_input.aim`을 무기 `aimProfile` 범위로 clamp
- 대상 무기: 현재 `Acorn Blaster`, `Paws`
- clamp된 aim을 hitscan / melee / projectile spawn / self recoil 계산에 공통 사용
- 현재 알려진 버그 명시: `Acorn Blaster`가 표시 각도 밖 상단/하단으로도 실제 발사 가능

건드리는 스펙/문서:
- `docs/game-design/weapon-design.md`
- `docs/technical/current-implementation.md`
- `docs/technical/next-session-roadmap.md`
- `server/src/room_combat.rs`
- `packages/shared/weapons.ts`

비목표:
- dead zone 진입 시 발사 차단(`block`) 처리
- 클라이언트 입력/스냅샷 구조 변경
- 투사체 중력/포물선
- 무기별 고급 탄도 프로필

검증 방법:
- `cargo test`
- `Acorn Blaster` 상단/하단 한계각 밖 입력 시 실제 탄도도 표시 각도와 일치하는지 확인
- `Paws` 근접 판정 방향이 표시 각도와 일치하는지 확인
