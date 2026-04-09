# 서버 개발 가이드

## 기술 스택

- Rust (2021 edition)
- Actix-web
- WebSocket (`/ws`)
- PostgreSQL 18
- Docker + Docker Compose

## Prerequisites

- Rust 1.75+
- Docker / Docker Compose

## 추천 실행 방식

현재 서버는 **Docker Compose로 DB와 API를 함께 올리는 방식**을 권장한다.
작은 팀에서 환경 차이를 줄이고, DB 연결 문자열을 통일하기 쉽기 때문이다.

## 로컬 개발 환경 설정

### 1. Compose로 서버 + DB 실행

```bash
cd server
docker compose up --build
```

- API: `http://localhost:8081`
- Health: `http://localhost:8081/health`
- WebSocket: `ws://localhost:8081/ws`
- PostgreSQL: `localhost:5434`

### 2. DB만 Compose로 실행하고 로컬에서 서버 실행

원하면 아래처럼 DB만 컨테이너로 띄우고 서버는 로컬 Rust로 실행할 수도 있다.

```bash
cd server
docker compose up -d db
cargo run
```

## 테스트 실행

```bash
cd server
cargo test
```

## 현재 구현 범위

- `/health` HTTP 엔드포인트
- `/hello` HTTP 엔드포인트
- `/ws` WebSocket 엔드포인트
- `welcome`, `join_room`, `room_snapshot`, `world_snapshot` 기본 흐름
- 단일 in-memory room loop (`20 TPS`)

## 데이터베이스

### 마이그레이션 (준비 중)

```bash
# 준비 중
```

### 주요 테이블 (준비 중)

```sql
-- 준비 중
```

## 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `API_PORT` | 서버 포트 | `8081` |
| `DATABASE_URL` | PostgreSQL 연결 문자열 | `postgres://dev:dev@db:5432/battle_hamsters` |
| `RUST_LOG` | 로그 레벨 | `info` |
