# 현재 구현 상태

이 문서는 **이상적인 최종 스펙**이 아니라, 현재 저장소에 실제로 구현된 상태를 기록한다.

## 최신 기준

기준 브랜치: `feature/collision-primitives`

## 현재 구현된 것

### Shared 패키지
- map / item / weapon / snapshot / protocol 타입 존재
- 서버와 클라이언트가 같은 메시지 계약을 참조 가능
- 맵 `collision`을 `floor / one_way_platform / solid_wall`, `hazards`를 `fall_zone / instant_kill_hazard`로 구분하는 타입이 추가되었다.

### Server
- Rust + Actix-web 서버 동작
- `/health`, `/hello`, `/ws` 엔드포인트 존재
- 단일 in-memory room loop 존재
- `20 TPS` world snapshot 브로드캐스트
- `welcome`, `join_room`, `room_snapshot`, `world_snapshot` 흐름 구현
- 플랫폼 이동 테스트 맵에서 좌우 바닥, 원웨이 플랫폼, pit 내부 wall 충돌, fall zone, instant kill hazard를 따로 판정한다.
- pit wall / fall zone / instant kill hazard 판정을 검증하는 단위 테스트가 있다.

### Game Client
- Phaser 클라이언트에서 WebSocket 연결 가능
- `join_room` 전송 가능
- `room_snapshot`, `world_snapshot` 수신 가능
- 플레이어를 사각형 placeholder로 렌더링 가능
- 키 입력을 `player_input`으로 전송 가능

## 이번 브랜치 목표

### 플랫폼 이동 1차 구현
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

### 렌더링
- 플레이어는 사각형 placeholder로 표시된다.
- 바닥, 원웨이 플랫폼, pit wall, instant kill hazard를 계약 기준(top surface / segment / rect)에 맞춰 표시한다.
- 디버그 오버레이로 바닥 충돌선, 원웨이 플랫폼 윗면, wall 선, instant kill hazard, spawn 위치를 확인할 수 있다.
- `fall zone`은 현재 화면 밖 낙사 판정용이라 클라이언트에 블록으로 표시하지 않는다.
- 플레이어 사각형에는 collider outline이 표시된다.
- 보간/스무딩이 거의 없어 움직임이 거칠게 보일 수 있다.

### 전투
- 실제 무기 판정, 아이템 획득, beam/grab/throwable 로직은 아직 미구현이다.

## 다음 구현 우선순위

1. 공통 맵 데이터(JSON)를 서버와 클라이언트가 함께 읽도록 이동
2. item / weapon pickup 실제 상태 반영
3. 클라이언트 보간 및 시각 품질 개선
4. `maxJumpCount`를 아이템과 실제로 연동
5. placeholder 사각형 → 실제 햄스터 렌더링
6. hazard 진입 피드백 / 사망 원인 표현 정리

## 참고

구현을 바꿀 때는 이 문서도 같이 갱신한다.
