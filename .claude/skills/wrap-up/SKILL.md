---
name: wrap-up
description: 브랜치 작업 마무리 자동화 — current-implementation.md 업데이트, 미니스펙 아카이빙, 다음 작업 미니스펙 최신화, PR 생성까지 한 번에 처리
---

# /wrap-up 스킬

이 브랜치의 작업을 마무리한다. 아래 단계를 순서대로 실행한다.

---

## 1단계 — 현황 파악

다음을 병렬로 확인한다:

- `git branch --show-current` — 현재 브랜치 이름
- `git log --oneline HEAD ^develop` — 이 브랜치에서 추가된 커밋 목록
- `git diff --stat HEAD ^develop` — 변경된 파일 목록
- `docs/technical/current-implementation.md` 전체 읽기
- `docs/technical/` 디렉토리에서 현재 브랜치와 관련된 미니스펙 파일 찾기
  - 브랜치 이름(`feat/foo-v1`)에서 슬래시 이후 부분(`foo-v1`)과 이름이 겹치는 `mini-spec-*.md` 파일
  - 없으면 이번 작업의 핵심 키워드로 검색

---

## 2단계 — `current-implementation.md` 업데이트

이 브랜치에서 구현한 내용을 `docs/technical/current-implementation.md`에 반영한다.

**체크리스트:**

- [ ] 파일 맨 위 **최신 기준** 섹션의 `기준 브랜치`를 현재 브랜치명으로, `마지막 동기화 기준`을 오늘 날짜로 갱신
- [ ] 이번 브랜치에서 추가/변경된 항목을 해당 섹션(Server / Shared / Game Client 등)에 반영
  - 이미 문서에 있는 내용은 중복 작성하지 않는다
  - 새 섹션이 필요하면 다른 완료 섹션 형식을 참고해 추가
- [ ] 단위 테스트가 추가됐다면 `누적 N개` 카운트를 실제 값으로 갱신 (`cargo test` 결과 기준)
- [ ] `알려진 한계` 항목이 있으면 현재 상태에 맞게 추가
- [ ] `다음 구현 우선순위` 목록을 이번 작업 결과에 맞게 갱신

---

## 3단계 — 미니스펙 아카이빙

1단계에서 찾은 미니스펙이 **완료 상태**라면:

1. 파일 상단에 `> **상태**: 완료` 표시가 없으면 추가한다
2. `docs/technical/mini-spec-*.md` → `docs/archive/mini-specs/mini-spec-*.md` 로 이동한다
   - `git mv` 명령으로 이동 (히스토리 보존)
3. `docs/technical/current-implementation.md` 하단 **참고** 섹션에 아카이브 경로로 포인터 추가:
   ```
   - 무기 확장 v3 완료 미니 스펙: `docs/archive/mini-specs/mini-spec-weapons-expansion-v3.md`
   ```

미니스펙이 없거나 아직 진행 중이면 이 단계를 건너뛴다.

---

## 4단계 — 다음 작업 미니스펙 최신화

`docs/technical/` 에 `mini-spec-*-next-candidates.md` 또는 `mini-spec-*-next*.md` 형태의 파일이 있는지 확인한다.

있다면:
- 방금 완료한 항목에 ✅ 표시 또는 `완료` 주석 추가
- 남은 후보 중 다음 우선순위가 바뀌었다면 반영

없다면 이 단계를 건너뛴다.

---

## 5단계 — 문서 변경 커밋

변경된 문서 파일들을 커밋한다.

```bash
git add docs/
git commit -m "docs: wrap-up — current-implementation.md 갱신 및 미니스펙 아카이빙"
```

`git mv`로 이동한 파일도 같은 커밋에 포함한다.

---

## 6단계 — PR 생성

1. `git push -u origin <현재 브랜치>` 로 원격에 푸시
2. `pr-create` 명령으로 PR을 생성한다 (`gh pr create` 직접 호출 금지)
   - base 브랜치: `develop`
   - 제목: 브랜치 커밋 내용을 요약한 한국어 제목 (`feat:` / `fix:` / `docs:` 접두어 포함)
   - 본문:
     - `## 개요`: 이번 브랜치에서 한 일 1~3줄 요약
     - `## 추가/변경 내용`: 핵심 항목 bullet
     - `## 검증 결과`: `cargo test`, `pnpm typecheck` 등 실행 결과 코드블록
     - `## deferred` (있는 경우): 이번에 하지 않은 것
     - 마지막 줄: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

---

## 주의사항

- `pr-create` 전에 반드시 `git branch --show-current` 로 현재 브랜치를 확인한다
- base 브랜치는 항상 `develop`이다 (`main` 직접 PR 금지)
- 문서 커밋은 코드 커밋과 분리한다 (이미 코드가 커밋된 상태에서 문서만 커밋)
- `cargo test` 와 `pnpm typecheck` 결과를 PR 본문에 포함한다
