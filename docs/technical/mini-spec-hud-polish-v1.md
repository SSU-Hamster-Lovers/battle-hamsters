# 미니 스펙: HUD polish v1

작업명:
하단 HUD 가독성/스타일 개선 1차

목표:
현재 기능 확인용에 가까운 하단 HUD를 더 읽기 쉽게 다듬고, Free Play 타이머와 세그먼트 HP 바 표현 오류를 바로잡는다.

이번 범위:
- Free Play / 긴 시간 제한에서 타이머 표기 규칙 정리
- 세로 HP 바 세그먼트를 직선 컷으로 수정
- 하단 카드 배경/텍스트/아이콘 배치 1차 polish

건드리는 스펙/문서:
- `docs/technical/current-implementation.md`
- `docs/ROADMAP.md`

비목표:
- 최종 atlas/spritesheet 기반 HUD 아트
- 팀전/8인전 전용 HUD 레이아웃
- 킬로그 레이아웃 전면 개편

검증 방법:
- `corepack pnpm --dir apps/game typecheck`
- `corepack pnpm --dir apps/game build`
- 로컬 플레이로 Free Play / Match HUD 가독성 확인

## 규칙

- `timeRemainingMs === null` 이거나 99시간 이상이면 타이머는 `FREE PLAY` 로 표시한다.
- 세로 HP 바 세그먼트 분할선은 사선이 아니라 직선 가로선으로 그린다.
- 카드 배경은 기존 단색보다 살짝 층이 보이게 하고, 텍스트 계층을 더 명확히 나눈다.
