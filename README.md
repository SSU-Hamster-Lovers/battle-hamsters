# Battle Hamsters

> 귀여운 햄스터들의 2D 아레나 PvP 게임

## 프로젝트 구성

| 앱 | 설명 | Tech Stack |
|----|------|------------|
| Portal | 포털, 로비, 매칭 UI | Next.js 14 |
| Game | 게임 클라이언트 | Phaser 3 + Vite |
| Server | authoritative 게임 서버 | Rust + Actix-web |
| Shared | 공용 타입/계약 | TypeScript |

## 현재 상태

이 저장소는 아직 **문서화 + 스캐폴딩 단계**에 가깝습니다.
현재는 루트에서 모든 앱을 한 번에 띄우는 `pnpm dev` 스크립트가 없으므로, 앱별로 실행해야 합니다.

## 빠른 시작

### 전제 조건

- Node.js 20+
- pnpm 8+
- Rust latest
- Docker Desktop

### 설치

```bash
git clone https://github.com/SSU-Hamster-Lovers/battle-hamsters.git
cd battle-hamsters
pnpm install
```

### 앱별 실행

#### Portal

```bash
cd apps/portal
pnpm dev
```

#### Game

```bash
cd apps/game
pnpm dev
```

#### Server

```bash
cd server
docker compose up -d db
cargo run
```

## 문서

모든 기획 및 설계 문서는 [docs/index.md](docs/index.md)를 참조하세요.

특히 아래 문서가 현재 구현 계약의 기준입니다.

- [코어 규칙](docs/game-design/core-rules.md)
- [무기 설계](docs/game-design/weapon-design.md)
- [아키텍처](docs/technical/architecture.md)
- [데이터 포맷](docs/technical/data-formats.md)
- [동기화 프로토콜](docs/technical/sync-protocol.md)
- [협업 규칙](docs/team/collaboration-rules.md)

## 팀 운영 메모

- 현재 추천 전략은 **팀장이 v0 수직 슬라이스를 먼저 고정**하고,
  나머지 팀원은 에셋, 콘텐츠, 문서, 저위험 병렬 작업을 지원하는 방식입니다.
- 자세한 내용은 [팀 역할 분담](docs/team/roles.md) 및 [협업 규칙](docs/team/collaboration-rules.md)을 참고하세요.

## 라이선스

MIT
