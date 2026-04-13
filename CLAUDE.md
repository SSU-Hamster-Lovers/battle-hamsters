# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language / 결과물 규칙

사용자에게 보이는 결과물(답변, PR/이슈 본문, 문서, 한글 설명 주석)은 **기본적으로 한국어**로 작성한다. 코드 문법, API/타입/파일 경로/외부 서비스 고유명은 예외다. 자세한 규칙은 `AGENTS.md` 참조.

## Branch / PR Guardrails

Claude는 PR base branch 를 추측해서는 안 된다. 이 저장소의 기본 전략은 아래와 같다.

- `main` 으로 가는 PR 은 `develop` 또는 `hotfix/*` 브랜치에서만 연다.
- `feat/*`, `fix/*`, `chore/*`, `docs/*` 브랜치는 `develop` 으로만 PR 을 연다.
- PR 생성은 `pr-create` 로만 수행한다. `gh pr create` 직접 호출, GitHub 웹 UI 기본값, 도구 자동 PR 생성 버튼을 사용하지 않는다.
- PR 생성 전 반드시 `git branch --show-current` 로 현재 브랜치를 확인하고, base branch 를 명시적으로 검증한다.
- 규칙에 맞는 base branch 가 확실하지 않으면 PR 을 만들지 말고 사용자에게 확인한다.

## Repository layout

pnpm workspace + Rust server. 네 영역이 명확히 분리되어 있고, 이 경계를 흐리지 않는 것이 중요하다.

- `apps/portal` — Next.js 14 + Tailwind. 매칭 전 로비/포털 UI. 실시간 전투 로직 없음.
- `apps/game` — Phaser 3 + Vite. 실시간 게임 클라이언트. 입력 수집·렌더링·보간만 담당.
- `packages/shared` — TypeScript only. WebSocket 메시지/맵/무기/아이템/스냅샷 타입과 공통 상수. 서버-클라 계약의 single source of truth. `packages/shared/maps/*.json` 은 서버와 클라가 동일하게 읽는 맵 정의.
- `packages/assets` — 공용 에셋.
- `server` — Rust + Actix-web + actix-web-actors (WebSocket) + sqlx/Postgres. Authoritative 게임 서버. `20 TPS` 스냅샷 브로드캐스트.
- `deploy/` — docker-compose, Oracle 배포 스크립트. Portal은 Cloudflare Pages.

서버 소스는 의도적으로 역할별로 분할되어 있으므로 새 로직을 추가할 때 해당 모듈을 우선 참조한다.

- `server/src/main.rs` — Actix 앱 진입 / 엔드포인트 (`/health`, `/hello`, `/ws`)
- `server/src/game_data.rs` — shared JSON 맵/무기/아이템 런타임 로딩
- `server/src/room_runtime.rs` — room loop / movement orchestration
- `server/src/room_pickups.rs` — spawn/pickup/despawn/respawn
- `server/src/room_combat.rs` — 전투 판정, 사망/리셋
- `server/src/room_config.rs` — `RoomGameplayConfig` (HP/생명/점프 상한/시간 제한)
- `server/src/ws_runtime.rs` — WebSocket 세션/메시지 처리

## Commands

루트에 통합 `pnpm dev` 는 아직 **없다**. 앱별로 따로 띄운다.

```bash
# 1회 설치
pnpm install

# Portal (Next.js)
cd apps/portal && pnpm dev           # dev
pnpm lint                              # ESLint (next lint)
pnpm typecheck                         # tsc --noEmit
pnpm format / pnpm format:check        # prettier

# Game client (Phaser + Vite)
cd apps/game && pnpm dev               # vite dev server
pnpm build                             # vite build
pnpm typecheck                         # tsc --noEmit

# Shared 타입 체크
cd packages/shared && pnpm typecheck

# Server (Rust)
cd server
docker compose up --build              # 전체(서버 + DB) 컨테이너로
docker compose up -d db && cargo run   # DB만 컨테이너, 서버는 로컬
cargo test                             # 단위 테스트 (pit wall / fall zone / instant kill 판정 등)
cargo test <name>                      # 단일 테스트
cargo check                            # 빠른 컴파일 검사
```

환경은 Node.js 20+, pnpm 8+, Rust latest, Docker Desktop 을 요구한다.

## Architecture — 지켜야 할 경계

**서버 권위(authoritative) 모델.** 클라이언트는 입력을 제안할 뿐, 위치/전투/사망 판정은 서버가 확정한다. 이 원칙을 어기는 클라 사이드 판정은 금지.

- Portal → 세션/방 정보 전달까지만. 전투 판정 금지.
- Game Client → 입력 전송, 서버 스냅샷 보간 렌더링, HUD. 최종 이동/공격/승패 판정 금지.
- Shared → 서버-클라가 공유할 수 있는 **타입과 계약만**. 런타임 로직을 넣지 않는다.
- Server → 모든 판정의 기준.

메시지 흐름: `welcome` → `join_room` → `room_snapshot` → 20 TPS `world_snapshot` 브로드캐스트 + 클라이언트 `player_input`. 메시지/타입 계약은 `packages/shared/protocol.ts` 와 `docs/technical/sync-protocol.md` 를 함께 봐야 한다.

맵 데이터는 `packages/shared/maps/training-arena.json` 이 현재 단일 테스트 맵이고, 서버·클라 모두 같은 파일을 읽는다. `collision` 은 `floor / one_way_platform / solid_wall`, `hazards` 는 `fall_zone / instant_kill_hazard` 로 구분된다. 경계/카메라 관련 필드(`boundaryPolicy`, `cameraPolicy`, `visualBounds`, `gameplayBounds`, `deathBounds`)는 타입엔 있으나 카메라 런타임은 아직 사용하지 않는다.

## Spec-driven workflow (중요)

이 저장소는 **스펙 주도 개발**이다. 코드보다 문서가 먼저다.

작업 시작 전에 반드시 다음을 확인한다 (`AGENTS.md` §2 와 동일):

1. 관련 스펙 문서 — `docs/game-design/*`, `docs/technical/architecture.md`, `docs/technical/data-formats.md`, `docs/technical/sync-protocol.md`, `docs/technical/collision-contract.md`
2. 현재 구현 상태 — `docs/technical/current-implementation.md` (이게 현재 진실의 기준점)
3. 기존 mini-spec — `docs/technical/mini-spec-*.md` (브랜치 단위 작업 계획서)
4. 협업 규칙 — `docs/team/collaboration-rules.md`

모든 구현 작업은 시작 전 짧은 **미니 스펙**(`작업명 / 목표 / 이번 범위 / 건드리는 스펙 / 비목표 / 검증 방법`)을 작성한다. 복잡한 작업은 `docs/technical/mini-spec-*.md` 로 커밋한다.

다음 변경은 **반드시** 문서를 함께 갱신한다:

- WebSocket 메시지 구조 변경 → `docs/technical/sync-protocol.md`
- shared 타입 변경 → `docs/technical/data-formats.md`
- 게임 규칙 / 무기 / 아이템 / 이동·점프·전투 로직 변경 → 해당 `game-design/*` 및 `current-implementation.md`
- 로컬 실행 방식 / 협업 규칙 변경

구현이 임시라면 `current-implementation.md` 의 **현재 임시 구현** 섹션에 명시한다. "일단 구현하고 나중에 문서화" 는 기본값이 아니다.

## PR 머지 전 체크리스트 (`AGENTS.md` §5)

1. 현재 코드가 어떤 스펙을 구현하는지 설명 가능해야 한다.
2. 스펙이 바뀌었다면 관련 문서가 함께 갱신되어 있어야 한다.
3. `docs/technical/current-implementation.md` 가 현재 상태를 반영해야 한다.
4. 검증 결과(테스트, `typecheck`, `cargo test`, 스모크 테스트)를 PR 에 남겨야 한다.
5. 임시 구현이면 다음 단계와 한계를 PR 에 명시해야 한다.
