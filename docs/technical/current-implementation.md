# 현재 구현 상태

이 문서는 **이상적인 최종 스펙**이 아니라, 현재 저장소에 실제로 구현된 상태를 기록한다.

## 최신 기준

기준 브랜치: `develop`

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

## 현재 임시 구현

### 이동
- 현재 이동은 **플랫폼 물리 전 구현 상태의 임시 자유 이동**이다.
- `A/D`뿐 아니라 `W/S`도 위치 이동에 사용된다.
- 이것은 네트워크/스냅샷 검증을 위한 임시 동작이다.

### 렌더링
- 플레이어는 사각형 placeholder로 표시된다.
- 보간/스무딩이 거의 없어 움직임이 거칠게 보일 수 있다.

### 전투
- 실제 무기 판정, 아이템 획득, beam/grab/throwable 로직은 아직 미구현이다.

## 다음 구현 우선순위

1. 플랫폼형 이동으로 전환
   - 중력
   - 점프
   - 착지
   - `maxJumpCount` 반영
2. item / weapon pickup 실제 상태 반영
3. 클라이언트 보간 및 시각 품질 개선
4. placeholder 사각형 → 실제 햄스터 렌더링

## 참고

구현을 바꿀 때는 이 문서도 같이 갱신한다.
