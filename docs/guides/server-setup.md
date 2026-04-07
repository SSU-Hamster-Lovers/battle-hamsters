# 서버 개발 가이드

## 기술 스택

- Rust (2021 edition)
- PostgreSQL 18
- sqlx (async PostgreSQL client)

## Prerequisites

- Rust 1.75+
- Docker & Docker Compose
- PostgreSQL 18 (Docker로 실행)

## 로컬 개발 환경 설정

### 1. PostgreSQL 실행

```bash
cd server
docker compose up -d db
```

### 2. 환경변수 설정

```bash
cp server/.env.example server/.env
# 필요시 DATABASE_URL 수정
```

### 3. 의존성 설치 및 실행

```bash
cd server
cargo run
```

### 4. 테스트 실행

```bash
cargo test
```

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
| DATABASE_URL | PostgreSQL 연결 문자열 | postgres://dev:dev@localhost:5433/battle_hamsters |
