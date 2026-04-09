# Battle Hamsters - 로드맵

## 현재 상태

**완료된 작업:**
- 모노레포 구조 (pnpm workspace)
- Portal: Next.js 14 + ESLint + Prettier + Tailwind
- Game: Phaser 3 + Vite
- Server: Rust + Actix-web + PostgreSQL (Docker)
- CI/CD: GitHub Actions (portal, server)
- 문서: 로컬開発/서버 가이드, 코어 규칙, 맵 설계
- Branch protection: main, develop

---

## 로드맵

### Phase 1: 코어 결정 및 문서화 ✅
- [x] 인원 수 결정
- [x] 승리 조건 결정
- [x] 전투 방식 결정
- [x] 이동/랭크 시스템 결정
- [x] 무기 획득 방식 결정
- [x] 맵 데이터 포맷 결정 (JSON)

### Phase 2: 게임 설계
- [ ] 무기 설계 문서화
- [ ] 맵 상세 스키마 정의
- [ ] 캐릭터 스탯 정의
- [ ] 스킬/버프/디버프 상세 정의

### Phase 3: 서버 개발
- [ ] WebSocket 기본 구조
- [ ] 매칭 시스템 API
- [ ] 방 생성/입장/퇴장 API
- [ ] 게임 세션 관리
- [ ] PostgreSQL 스키마 (users, matches, players)

### Phase 4: Portal 개발
- [ ] 로비 UI
- [ ] 매칭 UI
- [ ] 방 생성/입장 UI
- [ ] 게임 내 UI (HP, 생명, 점수)

### Phase 5: Game Client 개발
- [ ] Phaser 기본 씬 구성
- [ ] 캐릭터 이동/애니메이션
- [ ] 무기 시스템
- [ ] 충돌 감지
- [ ] WebSocket 연결 (서버 연동)

### Phase 6: 동기화 및 멀티플레이
- [ ] 입력 전송 프로토콜
- [ ] 상태 동기화
- [ ] 클라이언트 예측/보간
- [ ] 지연 시간 처리

### Phase 7: CI/CD 및 배포
- [ ] Server CI/CD (GitHub Actions)
- [ ] Oracle Cloud 배포 설정
- [ ] 도메인/SSL 설정

### Phase 8: 콘텐츠 제작
- [ ] 첫 번째 맵 제작
- [ ] 기본 무기_balancing
- [ ] 테스트 및 밸런싱

---

## 상세 작업 목록

### 즉시 할 일 (Next Sprint)
1. 무기 설계 문서 작성 (docs/game-design/weapon-design.md)
2. PostgreSQL 스키마 정의
3. Server: WebSocket 기본 구조
4. Server: DB 마이그레이션 구조 (sqlx-migrate)

### 나중에 할 일
1. Portal: 기본 UI 컴포넌트
2. Game: Phaser 씬 기본 구조
3. 매칭/방 시스템 API

---

## 코어 결정 사항 (확정)

| 항목 | 결정 |
|------|------|
| 인원 | 2/4/8인 (개인전/팀전) |
| 승리 | 포인트제(5분 기본) / KO / 시간초과 |
| 전투 | HP + 생명(3 기본) + 넉백 + 낙사 + 즉사 |
| 이동 | 무제한, 랭크제 -7~+7 |
| 무기 | 맨손 + 고정/랜덤 스폰 + 버리기 |
| 맵 포맷 | JSON |

---

## 환경

| 서비스 | 상태/값 |
|--------|---------|
| PostgreSQL | Docker, 포트 5434 |
| API Server | Rust/Actix-web, 포트 8081 |
| Repository | GitHub (battle-hamsters) |
| Branches | main (protected), develop (protected) |
