# 미니 스펙: 로컬 개발 환경 정리 v1

작업명:
로컬 개발 환경 정리

목표:
서버 `.env` 와 프런트 개발 서버 설정이 서로 어긋나지 않도록 로컬 실행 기준을 하나로 맞춘다.

이번 범위:
- Rust 서버가 `.env` / `.env.local` 에서 `API_HOST`, `API_PORT` 를 읽게 한다.
- `portal`, `game` 개발 서버를 LAN/Tailscale 접근 가능 기본값으로 정리한다.
- 루트에서 `server`, `portal`, `game` 을 함께 또는 선택적으로 실행하는 스크립트를 추가한다.
- 로컬 실행 가이드를 현재 동작에 맞게 갱신한다.

건드리는 스펙/문서:
- `docs/guides/local-setup.md`
- `docs/technical/current-implementation.md`

비목표:
- 운영 배포 워크플로 변경
- Cloudflare Pages / Oracle 런타임 설정 변경
- 프로덕션용 비밀값 관리 체계 변경

검증 방법:
- `cargo test`
- `pnpm --dir apps/game build`
- `pnpm --dir apps/portal build`
- `bash -n scripts/*.sh`
