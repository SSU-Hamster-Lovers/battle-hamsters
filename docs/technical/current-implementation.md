# 현재 구현 상태

이 문서는 **이상적인 최종 스펙**이 아니라, 현재 저장소에 실제로 구현된 상태를 기록한다.

## 최신 기준

- 기준 브랜치: `develop` (feat/weapon-aim-angle-v1 병합 후 기준)
- 마지막 동기화 기준: 2026-04-13

## 현재 구현된 것

### Shared 패키지

- map / item / weapon / snapshot / protocol 타입 존재
- 서버와 클라이언트가 같은 메시지 계약을 참조 가능
- 맵 `collision`을 `floor / one_way_platform / solid_wall`, `hazards`를 `fall_zone / instant_kill_hazard`로 구분한다.
- `boundaryPolicy`, `cameraPolicy`, `visualBounds`, `gameplayBounds`, `deathBounds`를 포함한 `MapDefinition` 타입이 정리되었다.
- `packages/shared/maps/training-arena.json` 공통 테스트 맵 파일과 `trainingArenaMap` export가 있다.
- `PlayerSnapshot`에는 `kills`, `deaths`, `lastDeathCause`가 포함되어 매치 점수와 최근 사망 원인을 함께 전달한다.

### Server

- Rust + Actix-web 서버 동작
- 시작 시 `.env`, `.env.local`, `server/.env`, `server/.env.local` 을 읽어 `API_HOST`, `API_PORT` 를 적용한다.
- `/health`, `/hello`, `/ws`, `POST /rooms`, `GET /rooms`, `GET /rooms/free` 엔드포인트 존재
- `welcome`, `join_room`, `room_snapshot`, `world_snapshot` 흐름 구현
- `20 TPS` authoritative room loop와 world snapshot 브로드캐스트 구현
- 테스트 맵 충돌 / hazard / spawn 위치를 `packages/shared/maps/training-arena.json`에서 읽는다.
- 플랫폼 이동 1차:
  - 좌우 이동
  - 점프
  - 중력
  - 착지
  - 플랫폼 내려오기
  - 공중 급강하
  - pit 내부 wall 충돌
  - fall zone 낙사
  - instant kill hazard
  - 사망 후 3초 리스폰
- 룸은 `RoomGameplayConfig`를 가져 기본 HP / 시작 생명 / 기본 점프 수 / 최대 점프 수 상한 / 시간 제한을 자체 값으로 가진다.
- 다중 룸 시스템:
  - `AppState` 가 `HashMap<RoomId, RoomState>` + `HashMap<code, RoomId>` 를 보관
  - 서버 시작 시 자유맵(`free_play`) 1개 자동 생성
  - `POST /rooms` 로 매치룸 생성 → 4자리 코드 발급
  - `WS join_room` 에서 4자리 숫자 코드는 자동으로 roomId 로 변환
  - 빈 매치룸은 10분 후 코드와 함께 자동 제거
- 매치 흐름 1차:
  - 매치룸은 `Waiting -> Running -> Finished`
  - 2명 이상이면 5초 카운트다운 후 시작
  - 시간 소진 시 `Finished`
  - 자동 재시작은 제거했고, 플레이어가 떠날 때까지 `Finished` 유지
  - 킬/데스 점수 집계 포함
  - 자유맵은 항상 `Running`
- 무기 / 아이템 런타임 1차:
  - 테스트 맵 `weaponSpawns`를 실제 월드 pickup 상태로 올리고 spawn/드롭 무기 despawn/respawn 처리
  - 테스트 맵 `itemSpawns`를 실제 월드 pickup 상태로 올리고 spawn/respawn 처리
  - `spawnStyle`에 따라 `fade_in`, `airdrop` 구분
  - `random_candidates` + `spawnGroupId` 구조 처리
  - `jump_boost_small`, `health_pack_small` 아이템 정의를 shared JSON에서 읽어 적용
- 전투 1차:
  - `Acorn Blaster` 히트스캔 발사
  - 상대 넉백
  - 자기 반동(`self recoil`)
  - 탄 소모
  - 빈 무기 폐기
  - 킬 귀속 1차(`last_hit_by` TTL 5초)
- 사망/리스폰 처리:
  - `PlayerSnapshot.lastDeathCause` 에 최근 사망 원인을 싣는다.
  - `room_snapshot` / `world_snapshot` 은 짧은 TTL의 `damageEvents` 배열을 함께 싣는다.
  - 리스폰 대기 플레이어를 바닥 아래 임의 좌표로 순간이동시키지 않는다.
- 서버 리팩토링 1차:
  - 런타임 데이터 로딩: `server/src/game_data.rs`
  - spawn/pickup 관리: `server/src/room_pickups.rs`
  - 전투/사망 리셋: `server/src/room_combat.rs`
  - room loop / movement orchestration: `server/src/room_runtime.rs`
  - ws/session 처리: `server/src/ws_runtime.rs`
- pit wall / fall zone / instant kill hazard 판정을 검증하는 단위 테스트가 있다.

### Game Client

- Phaser 클라이언트에서 WebSocket 연결 가능
- `pnpm dev` 기본 실행은 `GAME_HOST` / `GAME_PORT` 를 읽어 LAN/Tailscale 접근 가능한 개발 서버로 뜬다.
- `join_room`, `room_snapshot`, `world_snapshot` 처리 가능
- URL query 또는 hash(`room=...&name=...&pid=...`)를 파싱해 Portal 로비에서 전달된 정보로 바로 접속한다.
- 파라미터가 없으면 자유맵으로 자동 입장한다.
- 닉네임/플레이어 ID 는 `localStorage` 에 저장되어 재접속 시 동일 신원 유지
- 테스트 맵용 바닥 / 플랫폼 / pit wall / hazard / spawn 위치를 `trainingArenaMap` 공통 데이터에서 읽어 렌더링한다.
- 플레이어는 코드 기반 임시 텍스처로 만든 캐주얼 햄스터 silhouette로 렌더링되며, `idle / run / jump / fall / respawning` 상태를 기본 구분한다.
- remote player / local player / pickup 에 1차 보간을 적용했다.
- 월드 무기 pickup은 기본 fallback 도형/라벨을 유지하되, `Acorn Blaster` 는 1차 전용 pickup sprite + `AB` glyph + source accent 로 렌더링한다.
- 월드 아이템 pickup을 간단한 다이아몬드 도형/라벨로 렌더링한다.
- `Acorn Blaster` 장착 시 손 앞에 1차 무기 overlay 를 렌더링한다.
- 무기 오버레이가 에임 벡터 방향으로 실시간 회전한다.
  - 서버에서 캐릭터 `direction`이 이동 방향이 아닌 **에임 방향 기준**으로 결정된다. `abs(aim.x) < 0.12` deadzone에서는 이전 방향 유지.
  - 클라이언트 오버레이 rotation: right-facing `atan2(aim.y, aim.x)`, left-facing `atan2(-aim.y, -aim.x)` (flipX 보정).
  - anchorY 보간: `aim.y * 8px` 범위로 총구가 상하 이동한다.
  - 총구 이펙트 원점이 실제 무기 총구 위치에 정확히 맞춰진다 (`weapon_center_offset + muzzleFromCenter * aim`).
  - 원격 플레이어 오버레이는 direction 기반 수평 fallback 유지.
- 하단 고정 HUD 바 (y=512~600, 88px):
  - 좌측: 로컬 플레이어 compact combat bar
  - 중앙: 타이머 (10초 이하 적색 강조)
  - 우측: 상대 compact combat bar
  - Free Play 또는 사실상 무한 시간 제한에서는 중앙 타이머를 `FREE PLAY` 패널로 표시한다.
  - 카드형보다 얇은 `얼굴 + 가로 HP 바 + 생명 pip + 작은 무기/킬 정보` 중심 구조로 정리했다.
  - Free Play에서는 우측 카드가 `최근 공격한 대상 -> 킬 최다 상대` 우선순위로 표시된다.
- 좌상단에는 큰 제목/room/server tick 대신 작은 `WS/ping` 상태만 표시한다.
- 무기 아이콘 레지스트리: `getWeaponHudTextureKey(weaponId)` → `RenderTexture` 코드 생성 아이콘 (`paws`, `acorn_blaster`, fallback)
- 발사 시 로컬 보조용 무기별 연출을 적용한다.
  - `Acorn Blaster`: 총구 화염 + 짧은 tracer
  - `Paws`: 에임 방향으로 내지르는 사다리꼴 원뿔(truncated cone) flash
  - 그 외: 기존 선형 fallback
- 피격 연출 1차/2차를 적용한다.
  - `damageEvents` 가 있으면 정확한 `impactPoint` / `impactDirection` 기준으로 작은 파편 파티클을 생성한다.
  - 정확 이벤트가 없을 때는 `hp` 감소와 넉백 방향으로 fallback 파티클을 생성한다.
  - `Acorn Blaster`: 밝은 파편 + 짧은 탄 파편 계열
  - `Paws`: 짧은 먼지 puff + 충격파 타원 계열
- 우상단에 알림 로그 스택을 `Container` 기반 카드로 렌더링한다.
  - `weapon` 킬: 공격자명 | 무기 아이콘(HUD 아이콘 재사용) | 피해자명
  - 낙사/함정/자살: 텍스트 카드
  - 입장/퇴장: 시스템 알림 카드
  - 입장/퇴장 카드도 킬 카드와 같은 TTL 기준으로 자동 퇴장한다.
- 월드 무기/아이템 pickup은 소멸 직전 3단계 점멸 연출을 적용한다.
- 매치 상태별 UI:
  - `Waiting`: 대기 / 카운트다운 오버레이
  - `Running`: 기존 플레이 + 남은 시간
  - `Finished`: 점수판 오버레이
- `room_snapshot.matchState`를 실제 값으로 해석한다.
- 사망 연출 1차:
  - `fall_zone` 사망 시 더 빠르게 아래로 가속하며 회전하는 낙사 echo 를 렌더링한다.
  - `instant_kill_hazard` 사망 시 본체를 즉시 숨긴다.
  - `weapon`, `self` 사망 시 마지막 피격 반대 방향으로 짧은 임시 중력 더미를 렌더링한다.
  - 후속 단계에서 실제 래그돌/더미 시스템으로 확장 예정
- 디버그 오버레이는 기본 OFF다.
  - `?ops=1` 로 ops 접근을 로컬에 저장할 수 있다.
  - ops 접근이 있을 때만 `Alt + Shift + D` 로 디버그를 토글할 수 있다.
  - 지형 충돌선 / spawn 표식 / 플레이어 collider outline 을 숨기고 켤 수 있다.
- `MAP_DEFINITION.visualBounds` 를 `camera.setBounds` 로 적용해 카메라가 시각 울타리 밖을 보여주지 않도록 했다.
- `MAP_DEFINITION.cameraPolicy === "follow"` 일 때 로컬 플레이어를 중심으로 감쇠 추적(lerp 0.10) 하는 follow 카메라를 적용한다.
- 캔버스(뷰포트) 크기는 `800x600` 으로 고정하고, 맵 월드 크기와 분리해 관리한다.
- 테스트 맵(`training-arena.json`)은 1600×900, `cameraPolicy: "follow"` 기준으로 동작한다.

### Portal

- Next.js 정적 포털 페이지가 Cloudflare Pages에 배포되어 있다.
- `pnpm dev` 기본 실행은 `PORTAL_HOST` / `PORTAL_PORT` 를 읽어 LAN/Tailscale 접근 가능한 개발 서버로 뜬다.
- 루트 `portal` 개발 실행 스크립트는 시작 전에 `apps/portal/.next` 를 정리해 stale chunk 캐시 충돌을 줄인다.
- 닉네임 입력(localStorage), 자유맵 입장, 방 만들기(4자리 코드 표시), 코드로 입장 흐름을 제공한다.
- 플레이어 ID 는 익명 UUID 로 자동 발급된다.
- 게임 클라이언트로 이동 시 `room=...&name=...&pid=...` 정보를 hash 기반 URL로 전달한다.
- 현재 Portal URL에 `ops`, `debug` 파라미터가 있으면 게임 URL로 그대로 전달한다.

### 배포

- 현재 워크플로 기준 production 자동 배포 트리거는 `main` push 이다.
- `develop` 은 통합 브랜치이며 자동 배포는 없다.
- `workflow_dispatch` 로 수동 배포는 가능하다.
- Portal:
  - Cloudflare Pages direct upload 방식
  - 최신 성공 production 배포: 2026-04-11 `main` (`6f285d6`)
- Game:
  - Cloudflare Pages direct upload 방식
  - 최신 성공 production 배포: 2026-04-12 `main` (`06ba3e8`)
- Server:
  - Oracle Cloud + Docker Compose + health check 방식
  - 2026-04-12 `main` push 자동 배포는 `Configure SSH` 단계에서 실패
  - 같은 날 `develop` (`195c73e`) 기준 `workflow_dispatch` 수동 배포는 성공
- Oracle 서버는 Nginx + Let's Encrypt 로 `https://api-battlehamster.cuteshrew.com` 에서 HTTPS/WSS 를 제공한다.

### 로컬 실행

- 루트 `pnpm dev`, `pnpm dev:web`, `pnpm dev:server`, `pnpm dev:portal`, `pnpm dev:game` 스크립트가 있다.
- 루트 실행 스크립트는 `API_PORT` 기준으로 프런트의 API/WS 주소를 함께 맞춘다.

## 현재 임시 구현

### 이동

- 서버 authoritative 플랫폼 이동 1차 구현이다.
- pit 내부 좌우 wall 은 현재 fall zone 시작 지점까지 연장해 복귀 루트를 막는다.
- 현재 테스트용 생명 수는 99다.
- 현재 기본 room gameplay config는 시작 HP 100, 생명 99, 기본 점프 1, 최대 점프 상한 3, 5분 제한이다.

### 렌더링

- 플레이어 / 무기 / 아이템 / 맵은 placeholder 또는 코드 생성 텍스처 기반이다.
- 디버그 오버레이는 운영자용 숨김 토글 방식 1차다.
- `weapon/self` 사망 시 더미 연출은 임시 구현이며, 실제 래그돌 물리/애니메이션은 아직 없다.

### 전투

- `Acorn Blaster`, `Paws` 두 무기에 대해 서버 판정을 구현한다.
- `Paws` 근접 판정: 에임 방향 원뿔(hit_start=14px, hit_end=56px, near_half_w=7px, far_half_w=21px), 가장 가까운 단일 타겟, damage=8, knockback=3, cooldown=350ms.
- `Acorn Blaster` 히트스캔 발사
- 월드 무기는 `E`로 명시적으로 획득하고 `Q`로 드롭한다.
- 월드 아이템은 닿으면 자동으로 획득한다.
- `jump_boost_small`은 `maxJumpCount`를 `1..3` 범위에서 증가시키고, `health_pack_small`은 HP를 최대치까지 회복한다.
- beam / grab / throwable, speed rank / extra life 아이템, 다중 무기 밸런싱은 아직 미구현이다.

## 다음 구현 우선순위

1. 무기 visual clamp + Dead zone 2차 (`mini-spec-weapon-angle-deadzone-v0.md` §5 Step 2-3 참조)
2. 실제 아트 atlas / spritesheet 기반 햄스터 / 무기 / 아이템 교체
3. `weapon/self` 사망 더미를 실제 래그돌/시체 연출로 확장
4. `develop` preview / staging 배포 전략 분리

## 참고

- 맵 경계/카메라 정책 설계 배경은 `docs/technical/mini-spec-map-boundaries-camera.md` 참조
- 카메라 구현 완료 미니 스펙: `docs/archive/mini-specs/mini-spec-camera-visual-bounds-v1.md`
- 문서 동기화 + 배포 전략 미니 스펙: `docs/archive/mini-specs/mini-spec-doc-sync-deploy-strategy-v1.md`
- 사망 연출 + 디버그 토글 미니 스펙: `docs/archive/mini-specs/mini-spec-death-feedback-debug-toggle-v1.md`
- 로컬 개발 환경 정리 미니 스펙: `docs/archive/mini-specs/mini-spec-local-dev-env-runner-v1.md`
- 점프 아이템 세부 규칙 후속은 `docs/technical/mini-spec-jump-item-integration-v1.md` 참조
- 전투 표현 polish 후속은 `docs/technical/mini-spec-combat-presentation-polish-v0.md` 참조
- HUD compact 완료 미니 스펙: `docs/archive/mini-specs/mini-spec-hud-compact-combat-bar-v2.md`
- HUD polish 완료 미니 스펙: `docs/archive/mini-specs/mini-spec-hud-polish-v1.md`
- 알림 로그/pickup 점멸 완료 미니 스펙: `docs/archive/mini-specs/mini-spec-hud-notification-pickup-polish-v1.md`
- 피격 피드백 완료 미니 스펙: `docs/archive/mini-specs/mini-spec-impact-feedback-v1.md`
- 무기 각도/Dead zone 초안: `docs/technical/mini-spec-weapon-angle-deadzone-v0.md`
- 무기 에임 각도 1차 완료 미니 스펙: `docs/archive/mini-specs/mini-spec-weapon-aim-angle-v1.md`
- 무기 각도/Dead zone 전체 로드맵 초안: `docs/technical/mini-spec-weapon-angle-deadzone-v0.md`
- Paws 근접 전투 + HUD 1차 완료 미니 스펙: `docs/archive/mini-specs/mini-spec-paws-combat-hud-v1.md`
