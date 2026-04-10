# Battle Hamsters - 로드맵

## 현재 상태

**완료된 작업:**

- 모노레포 구조 (pnpm workspace)
- Portal: Next.js 14 + ESLint + Prettier + Tailwind
- Game: Phaser 3 + Vite
- Server: Rust + Actix-web + PostgreSQL (Docker)
- CI/CD: GitHub Actions (portal, server)
- 문서: 로컬 설정, 코어 규칙, 맵/아이템/무기 설계, 아키텍처/데이터 포맷/동기화 프로토콜
- 플랫폼 이동 1차 구현
- 충돌 primitive / hazard 계약 분리
- 공통 테스트 맵 JSON을 서버/클라이언트가 함께 읽도록 통합
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

- [x] 무기 설계 문서화
- [x] 아이템 설계 문서화
- [x] 맵 상세 스키마 정의
- [x] 캐릭터 스탯 정의
- [x] 스킬/버프/디버프 상세 정의

### Phase 3: 서버 개발

- [x] WebSocket 기본 구조
- [ ] 매칭 시스템 API
- [ ] 방 생성/입장/퇴장 API
- [x] 게임 세션 관리 (단일 in-memory room loop 1차)
- [ ] PostgreSQL 스키마 (users, matches, players)

### Phase 4: Portal 개발

- [ ] 로비 UI
- [ ] 매칭 UI
- [ ] 방 생성/입장 UI
- [ ] 게임 내 UI (HP, 생명, 점수)

### Phase 5: Game Client 개발

- [ ] Phaser 기본 씬 구성
- [x] 캐릭터 이동 1차 (플랫폼 이동 테스트)
- [ ] 캐릭터 애니메이션
- [ ] 무기 시스템
- [x] 충돌 감지 1차
- [x] WebSocket 연결 (서버 연동 1차)

### Phase 6: 동기화 및 멀티플레이

- [x] 입력 전송 프로토콜 1차
- [x] 상태 동기화 1차
- [ ] 클라이언트 예측/보간
- [ ] 지연 시간 처리

### Phase 7: CI/CD 및 배포

- [x] Server CI/CD (GitHub Actions)
- [x] Oracle Cloud 배포 설정 1차
- [x] Cloudflare Pages direct upload 배포 설정
- [ ] 도메인/SSL 설정

### Phase 8: 콘텐츠 제작

- [ ] 첫 번째 맵 제작
- [ ] 기본 무기\_balancing
- [ ] 테스트 및 밸런싱

---

## 상세 작업 목록

### 즉시 할 일 (Next Sprint)

1. item / weapon pickup 실제 상태 반영
2. 클라이언트 보간 및 시각 품질 개선
3. PostgreSQL 스키마 및 마이그레이션 구조 정의
4. `visualBounds` 기반 카메라 clamp 및 follow 카메라 감쇠 이동 구현 준비

### 나중에 할 일

1. Portal: 기본 UI 컴포넌트
2. Game: 카메라 정책(`static / follow / dynamic`) 첫 구현
3. 매칭/방 시스템 API

---

## 코어 결정 사항 (확정)

| 항목    | 결정                                         |
| ------- | -------------------------------------------- |
| 인원    | 2/4/8인 (개인전/팀전)                        |
| 승리    | 포인트제(5분 기본) / KO / 시간초과           |
| 전투    | HP + 생명(3 기본) + 넉백 + 낙사 + 즉사       |
| 이동    | 무제한, 랭크제 -7~+7                         |
| 무기    | 맨손 + 유한 자원 무기 + 드랍/디스폰 + 버리기 |
| 맵 포맷 | JSON (weapon/item spawn 분리)                |

---

## 환경

| 서비스     | 상태/값                               |
| ---------- | ------------------------------------- |
| PostgreSQL | Docker, 포트 5434                     |
| API Server | Rust/Actix-web, 포트 8081             |
| Repository | GitHub (battle-hamsters)              |
| Branches   | main (protected), develop (protected) |
