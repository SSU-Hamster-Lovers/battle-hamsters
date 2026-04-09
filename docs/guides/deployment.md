# 배포 가이드

이 문서는 Battle Hamsters의 **1차 배포/CD 기준**을 정리한다.

- 프론트엔드(Portal): **Cloudflare Pages**
- 백엔드(Server): **Oracle Cloud 인스턴스**

## 배포 전략

### Portal
- 현재 Portal은 정적 페이지 기준으로 작성되어 있다.
- 현재 저장소는 **GitHub Actions + Wrangler direct upload** 방식으로 Cloudflare Pages에 배포한다.
- `apps/portal/next.config.mjs`에 `output: 'export'`를 설정해 정적 결과물 `out/`을 생성한다.
- 배포 워크플로는 `.github/workflows/portal-deploy-cloudflare.yml` 이다.

### Server
- 서버는 GitHub Actions에서 Oracle Cloud 인스턴스로 배포한다.
- 현재 저장소에는 아래 파일이 추가되어 있다.
  - `.github/workflows/server-deploy-oracle.yml`
  - `server/Dockerfile.prod`
  - `deploy/oracle/docker-compose.yml`
  - `deploy/oracle/.env.example`

## Portal → Cloudflare Pages

### 현재 제공되는 방식
GitHub Actions가 Portal을 빌드한 뒤 `wrangler pages deploy`로 Cloudflare Pages에 **직접 업로드**한다.

### 현재 워크플로 동작
1. `main` 브랜치에 Portal 관련 변경이 push 된다.
2. GitHub Actions가 `apps/portal`에서 `pnpm install`과 `pnpm build`를 실행한다.
3. 생성된 `apps/portal/out` 디렉터리를 Cloudflare Pages 프로젝트에 업로드한다.

### Cloudflare에서 필요한 1회 작업
Cloudflare Pages 프로젝트를 한 번 만들어 두고, 프로젝트 이름을 GitHub environment variable과 맞춰야 한다.

권장 항목:
- Pages project name: 예) `battle-hamsters-portal`
- Git integration 설정: **필수 아님**
- 대시보드 build command/root directory 설정: **direct upload 방식에서는 필수 아님**

즉, 이 방식에서는 Cloudflare 대시보드에 복잡한 build 설정을 맞추기보다:
- Pages 프로젝트 이름 준비
- GitHub Actions secret/variable 준비
가 핵심이다.

### GitHub `production` environment에 필요한 값

#### Secrets
- `CLOUDFLARE_API_TOKEN`
- `OCI_SSH_PRIVATE_KEY`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`

#### Variables
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT_NAME`
- `OCI_HOST`
- `OCI_USER`
- `OCI_SSH_PORT`
- `OCI_DEPLOY_PATH`
- `API_PORT`
- `RUST_LOG`

### Cloudflare Pages용 값 의미
- `CLOUDFLARE_API_TOKEN`
  - `wrangler pages deploy`에 사용할 API 토큰
- `CLOUDFLARE_ACCOUNT_ID`
  - Cloudflare 계정 ID
- `CLOUDFLARE_PAGES_PROJECT_NAME`
  - 업로드 대상 Pages 프로젝트 이름

### Cloudflare direct upload 구현 메모
- 현재 workflow는 `wrangler-action`의 내부 설치 로직 대신 `npm install -g wrangler` 후 CLI를 직접 실행한다.
- 이유는 monorepo + workspace lockfile 환경에서 action 내부 Wrangler 설치가 실패할 수 있기 때문이다.
- Pages 배포는 `apps/portal/out` 디렉터리를 직접 업로드한다.

### 참고
- 이 direct upload 방식에서는 GitHub Actions가 배포를 담당하므로 Cloudflare의 Git build 설정에 의존하지 않는다.
- 현재 Portal은 정적 export 기준에 맞춰 두었지만, 나중에 SSR/서버 액션이 필요해지면 Cloudflare Workers 기반 전략을 다시 검토해야 한다.

## Server → Oracle Cloud

### 현재 제공되는 자동 배포 흐름
GitHub Actions `Server Deploy (Oracle Cloud)` 워크플로가 아래 순서로 동작한다.

1. `server/`와 `deploy/oracle/`를 아카이브한다.
2. 배포용 `.env` 파일을 runner에서 생성한다.
3. SSH로 Oracle Cloud 인스턴스에 업로드한다.
4. 인스턴스에서 `docker compose up -d --build`를 수행한다.
5. 현재 릴리스를 `current` 심볼릭 링크로 갱신한다.

### 워크플로 트리거
- `main` 브랜치에 push
- 수동 실행 (`workflow_dispatch`)

## GitHub Environment 권장 설정

GitHub에서 `production` environment를 만들고 아래 값을 넣는 것을 권장한다.

### Secrets
- `CLOUDFLARE_API_TOKEN`
- `OCI_SSH_PRIVATE_KEY`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`

### Variables
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT_NAME`
- `OCI_HOST`
- `OCI_USER`
- `OCI_SSH_PORT`
- `OCI_DEPLOY_PATH`
- `API_PORT`
- `RUST_LOG`

## Oracle Cloud 인스턴스 1회 준비 작업

워크플로가 성공적으로 배포되려면 인스턴스에 아래가 먼저 준비되어 있어야 한다.

1. SSH 키 기반 접속 가능
2. Docker Engine 설치
3. Docker Compose plugin 설치
4. 배포 대상 디렉터리 생성
   - 예: `/opt/battle-hamsters`
5. 필요 포트 개방
   - API 예시: `8081`
6. 보안 정책 점검
   - 가능하면 NSG/Bastion 기반으로 SSH 접근 제한

## 주의사항

- 이 저장소의 Oracle 배포는 **워크플로/설정 파일 준비 단계**까지 포함한다.
- 실제 배포 성공 여부는 GitHub environment secret/variable 등록과 Oracle 인스턴스 초기 설정이 끝나야 보장된다.
- `OCI_DEPLOY_PATH`를 비워 두면 workflow 기본값은 `/opt/battle-hamsters`를 사용한다.
- Oracle workflow는 배포 경로 생성에 실패하면 `sudo` 가능 여부를 먼저 시도하고, 그래도 안 되면 권한 오류로 중단한다.
- `DATABASE_URL`이 `db` 컨테이너를 가리키는지, 외부 DB를 가리키는지는 운영 환경에 맞게 명확히 정해야 한다.
- 현재 서버는 PostgreSQL 접속을 실제 로직에서 강하게 사용하지 않지만, 배포 환경에서는 이후 DB 의존성 증가를 고려해 값을 미리 맞춰 두는 것이 좋다.

## 관련 공식 문서

- Cloudflare Pages Direct Upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Cloudflare Pages CI direct upload: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
- Cloudflare Pages Next.js static export: https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/
- GitHub Actions secrets: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- GitHub Actions environments: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/deploy-to-environment
- Oracle Cloud Linux instance SSH access: https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/connect-to-linux-instance.htm
