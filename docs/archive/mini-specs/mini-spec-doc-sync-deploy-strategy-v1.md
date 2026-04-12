# 미니 스펙 — 문서 동기화 + 배포 전략 정리 1차

작업명:
문서 동기화 + 배포 전략 정리 1차

목표:
현재 저장소 코드, GitHub Actions 이력, 실제 운영 흐름이 서로 같은 내용을 말하도록 정리한다.

이번 범위:
- `current-implementation`, `deployment`, `ROADMAP`를 최신 구현 기준으로 갱신
- `main` / `develop` 기준 실제 배포 흐름을 문서에 명시
- 완료된 작업과 남은 작업의 우선순위를 다시 정리

건드리는 스펙/문서:
- `docs/technical/current-implementation.md`
- `docs/guides/deployment.md`
- `docs/ROADMAP.md`
- `.github/workflows/*deploy*.yml`

비목표:
- 별도 staging 인프라 구축
- Cloudflare Pages preview / Oracle staging 서버 신설
- 배포 파이프라인 구조 자체의 대규모 개편

검증 방법:
- GitHub Actions 최근 실행 이력과 워크플로 트리거 조건 대조
- `main` / `develop` 브랜치 상태와 문서 내용 대조
- 문서가 최신 구현 범위(룸 시스템, 매치 흐름, 배포 상태)를 정확히 반영하는지 확인

## 핵심 정리

### 1. 문서 정본
- 구현 상태의 정본은 `develop` 브랜치 기준 `docs/technical/current-implementation.md`로 유지한다.
- 실제 production 자동 배포 트리거는 현재 워크플로 기준 `main` push 이다.

### 2. 현재 배포 전략
- `main`
  - Portal: Cloudflare Pages production 자동 배포
  - Game: Cloudflare Pages production 자동 배포
  - Server: Oracle production 자동 배포
- `develop`
  - 기본 역할은 통합 브랜치
  - 자동 배포는 없다
  - 필요 시 `workflow_dispatch`로 수동 배포 가능

### 3. 운영 해석 원칙
- “develop에 구현이 끝났다”와 “develop이 자동 배포된다”는 같은 뜻이 아니다.
- staging 환경이 따로 없으므로, `develop` 수동 배포는 임시 운영/검증 경로로만 문서화한다.
- 추후 preview/staging 환경이 생기기 전까지는 production 자동 배포 기준을 `main`으로 고정한다.
