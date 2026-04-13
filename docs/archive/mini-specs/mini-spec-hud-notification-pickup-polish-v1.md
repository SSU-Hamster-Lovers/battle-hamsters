# 미니 스펙: HUD / 알림 로그 / pickup 소멸 polish v1

작업명:
상단 상태 정리 + 알림 로그 확장 + pickup 소멸 점멸 연출

목표:
상단 텍스트 잡음을 제거하고, 플레이어 입장/퇴장을 포함한 알림 로그를 만들고, 하단 HUD 카드를 더 압축해 가독성을 높이며, pickup 소멸 직전 점멸 연출을 추가한다.

이번 범위:
- `Battle Hamsters`, `server tick`, `room` 상단 텍스트 제거
- 좌상단 작은 `WS/ping` 상태 표시 추가
- 킬로그를 알림 로그 개념으로 확장해 킬 / 입장 / 퇴장 알림 표시
- 하단 플레이어 카드를 더 압축된 프로필 카드 형태로 정리
- Free Play에서 우측 카드 우선순위를 `최근 공격 대상 -> 킬 최다 상대`로 정리
- 아이템/무기 pickup 소멸 직전 3단계 점멸 연출 추가

건드리는 스펙/문서:
- `docs/technical/current-implementation.md`
- `docs/technical/mini-spec-hud-polish-v1.md`
- `docs/ROADMAP.md`

비목표:
- 팀전/다인전 전체 HUD 레이아웃 재설계
- 사운드 알림 시스템
- 서버 authoritative ping 측정 체계 전면 개편

검증 방법:
- `corepack pnpm --dir apps/game typecheck`
- `corepack pnpm --dir apps/game build`
- 실제 플레이로 입장/퇴장/킬 알림, ping 표시, pickup 점멸 단계 확인

## pickup 소멸 점멸 단계

- 1단계: 남은 시간 35% ~ 18%
  - 느린 점멸
  - 약 `220ms` 주기
- 2단계: 남은 시간 18% ~ 8%
  - 중간 점멸
  - 약 `140ms` 주기
- 3단계: 남은 시간 8% 이하
  - 빠른 점멸
  - 약 `70ms` 주기

- 점멸 중에도 완전 투명 대신 `alpha 0.22 ~ 1.0` 범위로 유지해 위치 인지가 가능하게 한다.
