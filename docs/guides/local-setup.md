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

현재는 루트 `pnpm dev` 스크립트가 없으므로, 필요한 앱만 개별 실행합니다.

```bash
# Portal
cd apps/portal && pnpm dev

# Game
cd apps/game && pnpm dev

# Server (recommended)
cd server && docker compose up --build
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
cd server
docker compose up --build  # DB + API 서버 실행
```

대안:

```bash
cd server
docker compose up -d db    # PostgreSQL 실행
cargo run                  # 서버 실행
cargo test                 # 테스트
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
