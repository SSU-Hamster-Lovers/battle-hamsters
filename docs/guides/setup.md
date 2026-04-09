# 개발 환경 설정 가이드

## 전제 조건

- Node.js 20+
- pnpm 8+
- Rust latest
- Docker Desktop

## 설치

```bash
git clone https://github.com/SSU-Hamster-Lovers/battle-hamsters.git
cd battle-hamsters
pnpm install
```

## 실행 방식

현재는 루트 통합 실행 스크립트가 없습니다.
아래처럼 앱별로 실행하세요.

### Portal

```bash
cd apps/portal
pnpm dev
```

### Game

```bash
cd apps/game
pnpm dev
```

### Server

권장 방식:

```bash
cd server
docker compose up --build
```

대안 (DB만 Compose, 서버는 로컬 실행):

```bash
cd server
docker compose up -d db
cargo run
```
