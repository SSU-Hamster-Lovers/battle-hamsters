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

```bash
# 전체 개발 서버 (portal + game)
pnpm dev

# 또는 개별 실행
cd apps/portal && pnpm dev
cd apps/game && pnpm dev
```

## 프로젝트 구조

```
battle-hamsters/
├── apps/
│   ├── portal/     # Next.js 14 (포털, 로비, 매칭 UI)
│   └── game/       # Phaser 3 (게임 클라이언트)
├── packages/
│   └── shared/     # 공유 타입, 유틸
├── server/         # Rust 서버 + Docker PostgreSQL
└── deploy/        # 운영 배포 설정
```

## 각 앱 실행

### Portal (Next.js)

```bash
cd apps/portal
pnpm dev          # 개발 서버
pnpm build        # 프로덕션 빌드
pnpm lint         # ESLint
pnpm typecheck   # TypeScript 검사
pnpm format      # Prettier 포맷팅
```

### Game (Phaser)

```bash
cd apps/game
pnpm dev          # Vite 개발 서버
pnpm build        # 프로덕션 빌드
```

### Server (Rust)

```bash
cd server
docker compose up -d db    # PostgreSQL 실행
cargo run                   # 서버 실행
cargo test                  # 테스트
```

## IDE 설정

VS Code 권장 확장:
- ESLint
- Prettier
- Tailwind CSS IntelliSense
- rust-analyzer
