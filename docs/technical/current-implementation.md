# 현재 구현 상태

이 문서는 **이상적인 최종 스펙**이 아니라, 현재 저장소에 실제로 구현된 상태를 기록한다.

## 최신 기준

기준 브랜치: `feature/platform-movement`

## 현재 구현된 것

### Shared 패키지
- map / item / weapon / snapshot / protocol 타입 존재
- 서버와 클라이언트가 같은 메시지 계약을 참조 가능

### Server
- Rust + Actix-web 서버 동작
- `/health`, `/hello`, `/ws` 엔드포인트 존재
- 단일 in-memory room loop 존재
- `20 TPS` world snapshot 브로드캐스트
- `welcome`, `join_room`, `room_snapshot`, `world_snapshot` 흐름 구현

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
- 낙사 kill zone
- 사망 후 3초 리스폰
- 테스트용 생명 99

## 현재 임시 구현

### 이동
- 서버 authoritative 플랫폼 이동 1차 구현이 들어간 상태다.
- 좌우 이동, 점프, 중력, 착지, 급강하, 원웨이 플랫폼 내려오기 규칙을 1차로 처리한다.
- 낙사 구역에 떨어지면 3초 뒤 상공에서 리스폰한다.
- 현재 테스트용 생명 수는 99다.

### 렌더링
- 플레이어는 사각형 placeholder로 표시된다.
- 바닥, 원웨이 플랫폼, 낙사 구역도 단순 도형으로 표시한다.
- 보간/스무딩이 거의 없어 움직임이 거칠게 보일 수 있다.

### 전투
- 실제 무기 판정, 아이템 획득, beam/grab/throwable 로직은 아직 미구현이다.

## 다음 구현 우선순위

1. 좌표/충돌 계약 정리
2. item / weapon pickup 실제 상태 반영
3. 클라이언트 보간 및 시각 품질 개선
4. `maxJumpCount`를 아이템과 실제로 연동
5. placeholder 사각형 → 실제 햄스터 렌더링

## 참고

구현을 바꿀 때는 이 문서도 같이 갱신한다.
