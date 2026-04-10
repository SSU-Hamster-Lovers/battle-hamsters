# 현재 구현 상태

이 문서는 **이상적인 최종 스펙**이 아니라, 현재 저장소에 실제로 구현된 상태를 기록한다.

## 최신 기준

기준 브랜치: `develop`

## 현재 구현된 것

### Shared 패키지

- map / item / weapon / snapshot / protocol 타입 존재
- 서버와 클라이언트가 같은 메시지 계약을 참조 가능
- 맵 `collision`을 `floor / one_way_platform / solid_wall`, `hazards`를 `fall_zone / instant_kill_hazard`로 구분하는 타입이 추가되었다.
- `boundaryPolicy`, `cameraPolicy`, `visualBounds`, `gameplayBounds`, `deathBounds`를 포함한 `MapDefinition` 타입이 정리되었다.
- `packages/shared/maps/training-arena.json` 공통 테스트 맵 파일과 `trainingArenaMap` export가 추가되었다.

### Server

- Rust + Actix-web 서버 동작
- `/health`, `/hello`, `/ws` 엔드포인트 존재
- 단일 in-memory room loop 존재
- `20 TPS` world snapshot 브로드캐스트
- `welcome`, `join_room`, `room_snapshot`, `world_snapshot` 흐름 구현
- 플랫폼 이동 테스트 맵에서 좌우 바닥, 원웨이 플랫폼, pit 내부 wall 충돌, fall zone, instant kill hazard를 따로 판정한다.
- 테스트 맵 충돌 / hazard / spawn 위치를 이제 `packages/shared/maps/training-arena.json`에서 읽는다.
- 테스트 맵 `weaponSpawns`를 실제 월드 pickup 상태로 올리고, spawn/드롭 무기 despawn/respawn 1차를 처리한다.
- 테스트 맵 `itemSpawns`를 실제 월드 pickup 상태로 올리고, spawn/respawn 1차를 처리한다.
- `spawnStyle`에 따라 떠 있는 스폰(`fade_in`)과 중력 낙하 스폰(`airdrop`)을 구분하기 시작했다.
- `jump_boost_small`, `health_pack_small` 아이템 정의를 shared JSON에서 읽어 효과를 적용한다.
- `Acorn Blaster` 히트스캔 발사, 상대 넉백, 자기 반동(`self recoil`), 탄 소모, 빈 무기 폐기까지 1차 구현이 들어갔다.
- 서버 리팩토링 1차로 런타임 데이터 로딩은 `server/src/game_data.rs`, room의 spawn/pickup 관리는 `server/src/room_pickups.rs`, 전투/사망 리셋 로직은 `server/src/room_combat.rs`, room loop / movement orchestration은 `server/src/room_runtime.rs`, ws/session 처리는 `server/src/ws_runtime.rs`로 분리하기 시작했다.
- 룸은 이제 `RoomGameplayConfig`를 가져 기본 HP / 시작 생명 / 기본 점프 수 / 최대 점프 수 상한 / 시간 제한을 자체 값으로 가질 수 있다.
- pit wall / fall zone / instant kill hazard 판정을 검증하는 단위 테스트가 있다.

### Game Client

- Phaser 클라이언트에서 WebSocket 연결 가능
- `join_room` 전송 가능
- `room_snapshot`, `world_snapshot` 수신 가능
- 플레이어를 사각형 placeholder로 렌더링 가능
- 키 입력을 `player_input`으로 전송 가능
- 테스트 맵용 바닥 / 플랫폼 / pit wall / hazard / spawn 위치를 `trainingArenaMap` 공통 데이터에서 읽어 렌더링한다.
- 월드 무기 pickup을 간단한 도형/라벨로 렌더링한다.
- 월드 아이템 pickup을 간단한 다이아몬드 도형/라벨로 렌더링한다.
- HUD 텍스트에 현재 장착 무기와 탄 수, HP, 최대 점프 수를 표시한다.
- 발사 시 로컬 보조용 muzzle flash를 짧게 표시한다.

### Portal

- Next.js 정적 포털 페이지가 Cloudflare Pages에 배포되어 있다.
- 현재 첫 화면은 `Battle Hamsters / 로비 화면 - 매칭 대기 중` 문구를 보여주는 **placeholder UI**다.
- 실제 매칭 상태/서버 연결 상태를 반영하는 로비 로직은 아직 없다.

### 배포

- Portal은 Cloudflare Pages direct upload 경로를 통해 실제 배포 성공을 확인했다.
- Server는 Oracle Cloud 자동 배포 경로를 준비했고, SSH 접속 / 디렉터리 생성 / compose 실행 / production 이미지 빌드까지는 확인했다.
- Oracle 배포 스크립트는 이제 `API_PORT`를 컨테이너 내부/외부에 동일하게 적용하고, Postgres 18 볼륨을 `/var/lib/postgresql`에 마운트하며, 배포 직후 `127.0.0.1:${API_PORT}/health`를 확인한 뒤 실패 시 compose 로그를 출력한다.
- 2026-04-10 기준 최신 Oracle 배포에서는 외부 `http://161.118.216.248:8082/health` 응답 `200 {"status":"ok","version":"0.1.0"}`까지 확인했다.

## 최근까지 완료한 핵심 범위

### 플랫폼 이동 / 충돌 1차

- 좌우 이동
- 점프
- 중력
- 착지
- 플랫폼 내려오기
- 공중 급강하
- fall zone 낙사
- instant kill hazard
- pit 좌우 wall 충돌
- 사망 후 3초 리스폰
- 테스트용 생명 99

## 현재 임시 구현

### 이동

- 서버 authoritative 플랫폼 이동 1차 구현이 들어간 상태다.
- 좌우 이동, 점프, 중력, 착지, 급강하, 원웨이 플랫폼 내려오기 규칙을 1차로 처리한다.
- pit 내부 좌우 wall 충돌을 별도 primitive처럼 처리하고, 현재는 wall을 화면 아래 바깥의 `fall zone` 시작 지점까지 연장해 벽에 붙어 복귀하는 경로를 막는다.
- `fall zone`은 현재 화면 아래 바깥(`600px` 화면 기준 `y=700`)에서 시작해서, 중앙 구멍으로 내려간 뒤 충분히 떨어졌을 때만 낙사 처리된다.
- `instant kill hazard`에 닿거나 `fall zone` 깊이까지 떨어지면 3초 뒤 상공에서 리스폰한다.
- 현재 테스트용 생명 수는 99다.
- 현재 기본 room gameplay config는 시작 HP 100, 생명 99, 기본 점프 1, 최대 점프 상한 3, 5분 제한이다.
- 기본 점프 횟수는 다시 1로 두고, 아이템으로 room의 최대 점프 상한까지 올릴 수 있다.
- 죽으면 점프 증가와 이동 관련 일반 전투 상태는 기본값으로 초기화된다.

### 렌더링

- 플레이어는 사각형 placeholder로 표시된다.
- 바닥, 원웨이 플랫폼, pit wall, instant kill hazard를 계약 기준(top surface / segment / rect)에 맞춰 표시한다.
- 디버그 오버레이로 바닥 충돌선, 원웨이 플랫폼 윗면, wall 선, instant kill hazard, spawn 위치를 확인할 수 있다.
- `fall zone`은 현재 화면 밖 낙사 판정용이라 클라이언트에 블록으로 표시하지 않는다.
- 플레이어 사각형에는 collider outline이 표시된다.
- 보간/스무딩이 거의 없어 움직임이 거칠게 보일 수 있다.
- 서버와 클라이언트는 같은 테스트 맵 JSON 원본을 공유한다.
- item pickup은 `spawnStyle`에 따라 색이 달라지고, `airdrop` item은 실제로 아래로 떨어져 착지한다.

### 전투

- `Acorn Blaster` 1종에 한해 실제 발사/피격/넉백/자기 반동/탄 소모/빈 무기 폐기를 처리한다.
- 월드 무기는 `E`로 명시적으로 획득하고 `Q`로 드롭한다.
- 월드 아이템은 닿으면 자동으로 획득한다.
- `jump_boost_small`은 `maxJumpCount`를 `1..3` 범위에서 증가시키고, `health_pack_small`은 HP를 최대치까지 회복한다.
- 드롭한 무기는 즉시 재pickup되지 않도록 짧은 본인 pickup 차단 시간이 있다.
- 사망 시 장착 무기는 초기화되어 맨손(`paws`)으로 리스폰한다.
- 사망 시 점프 증가와 속도 랭크업도 함께 초기화된다.
- beam/grab/throwable, speed rank/extra life 아이템, 다중 무기 밸런싱은 아직 미구현이다.

## 다음 구현 우선순위

1. 후보 지점 랜덤 스폰 1차
2. 클라이언트 보간 및 시각 품질 개선
3. placeholder 사각형 → 실제 햄스터 렌더링
4. hazard 진입 피드백 / 사망 원인 표현 정리
5. `visualBounds` 기반 카메라 clamp 및 follow 카메라 감쇠 이동 구현

## 참고

- 맵 경계/카메라 확장 아이디어는 `docs/technical/mini-spec-map-boundaries-camera.md`에 별도 정리한다.
- `boundaryPolicy`, `cameraPolicy`, `visualBounds`, `gameplayBounds`, `deathBounds`는 shared 타입/JSON 예시에 반영됐지만 카메라 런타임에서는 아직 사용하지 않는다.
- 이번 브랜치 작업 미니 스펙은 `docs/technical/mini-spec-spawn-behavior-v1.md`에 정리한다.
- 점프 아이템 세부 규칙 후속은 `docs/technical/mini-spec-jump-item-integration-v1.md`에 정리한다.
- 구현을 바꿀 때는 이 문서도 같이 갱신한다.
