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
- 무기 시스템 1차 (`Acorn Blaster` pickup / 발사 / 넉백 / 자기 반동)
- 다중 룸 시스템 (자유맵 + 4자리 코드 매치룸)
- 매치 흐름 1차 (`Waiting -> Running -> Finished`, 점수 집계, 결과 오버레이)
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
- [x] 방 생성/입장 API 1차
- [x] 게임 세션 관리 (다중 in-memory room loop 1차)
- [ ] PostgreSQL 스키마 (users, matches, players)

### Phase 4: Portal 개발

- [x] 로비 UI
- [ ] 매칭 UI
- [x] 방 생성/입장 UI
- [ ] 게임 내 UI (HP, 생명, 점수)

### Phase 5: Game Client 개발

- [x] Phaser 기본 씬 구성
- [x] 캐릭터 이동 1차 (플랫폼 이동 테스트)
- [ ] 캐릭터 애니메이션
- [x] 무기 시스템 1차
- [x] 충돌 감지 1차
- [x] WebSocket 연결 (서버 연동 1차)

### Phase 6: 동기화 및 멀티플레이

- [x] 입력 전송 프로토콜 1차
- [x] 상태 동기화 1차
- [x] 클라이언트 보간 1차
- [ ] 지연 시간 처리

### Phase 7: CI/CD 및 배포

- [x] Server CI/CD (GitHub Actions)
- [x] Oracle Cloud 배포 설정 1차
- [x] Cloudflare Pages direct upload 배포 설정
- [x] 도메인/SSL 설정 1차

### Phase 8: 콘텐츠 제작

- [ ] 첫 번째 맵 제작
- [ ] 기본 무기\_balancing
- [ ] 테스트 및 밸런싱

---

## 상세 작업 목록

### 즉시 할 일 (Next Sprint)

1. 하단 플레이어 상태 HUD 실제 배치
2. 킬로그 카드 + 아이콘 레이아웃
3. 사망 더미를 실제 래그돌/시체 연출로 확장
4. PostgreSQL 스키마 및 마이그레이션 구조 정의
5. `develop` preview / staging 배포 전략 분리

### 나중에 할 일

1. Portal: 매칭 UI 확장
2. Game: 실제 atlas/spritesheet 아트 교체
3. 플레이어 스폰을 `고정 스폰` / `동적 스폰` 모드로 확장
4. 무기 pickup / 장착 / 발사 표현 규칙 정리 및 sprite화
5. 매칭/방 시스템 API 확장
6. 로비 월드맵 / 채널 전환 / 상점 같은 비전투 허브 시스템 검토
7. backlog 스펙 참고:
   - `docs/technical/mini-spec-lobby-world-foundation.md`
   - `docs/technical/mini-spec-lobby-channel-system.md`
   - `docs/technical/mini-spec-spawn-modes-v1.md`
   - `docs/technical/mini-spec-weapon-presentation-v1.md`

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
