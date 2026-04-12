# 로컬 개발 환경 설정

## Prerequisites

- Node.js 20+
- pnpm 8+
- Rust latest
- Docker Desktop (Mac)
- Git

## 빠른 시작

### 1. 저장소 클론

```bash
git clone https://github.com/SSU-Hamster-Lovers/battle-hamsters.git
cd battle-hamsters
```

### 2. 의존성 설치

```bash
pnpm install
```

### 3. 개발 서버 실행

기본 권장 방식은 루트 스크립트를 사용하는 것이다.

```bash
# Server + Portal + Game 동시 실행
pnpm dev

# Portal + Game 만 실행
pnpm dev:web

# 개별 실행
pnpm dev:server
pnpm dev:portal
pnpm dev:game
```

루트 스크립트는 `server/.env`, `server/.env.local`, 루트 `.env`, 루트 `.env.local` 을 읽고 아래 값을 맞춰서 사용한다.

- `API_HOST`, `API_PORT`
- `PORTAL_HOST`, `PORTAL_PORT`
- `GAME_HOST`, `GAME_PORT`
- `PUBLIC_SERVER_HOST`
- `PUBLIC_GAME_HOST`

추가로 `pnpm dev`, `pnpm dev:web`, `pnpm dev:portal` 은 `portal` 실행 전에 `apps/portal/.next` 를 정리해, 브랜치 전환이나 이전 build 산출물 때문에 Next 개발 서버가 stale chunk 를 참조하는 문제를 줄인다.

프런트는 위 값을 바탕으로 아래 주소를 자동 구성한다.

- `NEXT_PUBLIC_SERVER_API_URL=http://{PUBLIC_SERVER_HOST}:{API_PORT}`
- `NEXT_PUBLIC_GAME_URL=http://{PUBLIC_GAME_HOST}:{GAME_PORT}`
- `VITE_SERVER_WS_URL=ws://{PUBLIC_SERVER_HOST}:{API_PORT}/ws`

같은 PC에서만 개발하면 기본값으로 충분하다.
다른 기기나 Tailscale 에서 붙으려면 `PUBLIC_SERVER_HOST`, `PUBLIC_GAME_HOST` 를 실제 접속 가능한 IP 또는 DNS 로 맞춘다.

예시:

```bash
cat <<'EOF' > .env.local
PUBLIC_SERVER_HOST=100.113.188.126
PUBLIC_GAME_HOST=100.113.188.126
EOF
```

## 프로젝트 구조

```
battle-hamsters/
├── apps/
│   ├── portal/     # Next.js 14 (포털, 로비, 매칭 UI)
│   └── game/       # Phaser 3 (게임 클라이언트)
├── packages/
│   └── shared/     # 공유 타입, 이벤트 계약, 유틸
├── server/         # Rust authoritative 서버 + PostgreSQL
└── deploy/         # 운영 배포 설정
```

## 각 앱 실행

### Portal (Next.js)

```bash
cd apps/portal
pnpm dev          # 개발 서버
pnpm build        # 프로덕션 빌드
pnpm lint         # ESLint
pnpm typecheck    # TypeScript 검사
pnpm format       # Prettier 포맷팅
```

### Game (Phaser)

```bash
cd apps/game
pnpm dev          # Vite 개발 서버
pnpm build        # 프로덕션 빌드
pnpm typecheck    # TypeScript 검사
```

### Server (Rust)

권장 방식:

```bash
pnpm dev:server
```

대안:

```bash
cd server
docker compose up -d db    # PostgreSQL 실행
cargo run                  # 서버 실행
cargo test                 # 테스트
```

서버는 시작 시 `.env` / `.env.local` 을 읽고 `API_HOST`, `API_PORT` 를 적용한다.
예를 들어 `server/.env.local` 에 아래처럼 두면 된다.

```bash
API_HOST=0.0.0.0
API_PORT=18081
```

## 문서 우선 원칙

현재 저장소는 구현보다 설계 문서가 한 단계 앞서 있습니다.
구현 전 아래 문서를 먼저 확인하세요.

- `docs/game-design/core-rules.md`
- `docs/game-design/weapon-design.md`
- `docs/technical/architecture.md`
- `docs/technical/data-formats.md`
- `docs/technical/sync-protocol.md`

## IDE 설정

VS Code 권장 확장:
- ESLint
- Prettier
- Tailwind CSS IntelliSense
- rust-analyzer
