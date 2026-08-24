<p align="center">
  <img src="./docs/images/dsh-harbor-logo.png" alt="DSH Harbor" width="120" />
</p>

<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md">简体中文</a> &middot; <a href="./README.zh-TW.md">繁體中文</a> &middot; <a href="./README.ja.md">日本語</a> &middot; <a href="./README.ko.md"><b>한국어</b></a> &middot; <a href="./README.fr.md">Français</a> &middot; <a href="./README.es.md">Español</a> &middot; <a href="./README.de.md">Deutsch</a> &middot; <a href="./README.pt.md">Português</a> &middot; <a href="./README.ru.md">Русский</a> &middot; <a href="./README.hi.md">हिन्दी</a> &middot; <a href="./README.tr.md">Türkçe</a> &middot; <a href="./README.th.md">ไทย</a> &middot; <a href="./README.vi.md">Tiếng Việt</a> &middot; <a href="./README.id.md">Bahasa Indonesia</a>
</p>

# dsh-harbor

harbor는 설치된 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 플러그인을 비추는 읽기 전용 거울입니다. 각 플러그인이 **무엇을 할 수 있는지**, 어디에서 서로 **충돌하는지**, 마지막 스캔 이후 **무엇이 바뀌었는지**를 보여 주며, 감지된 모든 기능에는 확인 가능한 근거가 함께 제공됩니다.

무엇을 정리할지, 아예 정리할지는 사용자가 결정합니다. harbor는 사실만 제시하며 판단하거나, 설치를 통제하거나, 어떤 것도 가로채지 않습니다.

## harbor가 하는 일과 하지 않는 일

harbor가 하는 일은 하나뿐입니다. 설치된 플러그인에 대해 지속적으로 갱신되고 근거가 뒷받침되는 장부를 유지합니다. 이 장부에는 세 가지 항목이 있습니다. 인벤토리 자체(설치된 모든 서드파티 플러그인과, 감지기가 확인할 수 있는 경우 해당 소스 위치), 각 플러그인이 선언한 내용과 코드가 실제로 하는 일의 대조, 그리고 스캔 사이에 바뀐 내용의 타임라인입니다.

harbor가 의도적으로 하지 않는 일도 설계의 중요한 일부입니다. 설치 전에 플러그인을 심사하거나 차단하지 않습니다. 진입 통제는 플러그인 마켓플레이스 도구의 역할입니다. 상위 의존성 모니터링까지 깊이 들어가지 않으며, 상위 확인은 플러그인 버전까지만 다룹니다. 일반적인 코드 감사를 수행하지 않고, 플러그인 동작을 가로채거나 차단하거나 샌드박스에 가두지도 않습니다.

마지막 항목은 범위에 대한 선택이 아니라 호스트의 현실입니다. DSH의 Cordis 런타임에는 기능 샌드박스가 없습니다. 플러그인은 호스트의 기본 Node realm 안에서 호스트 자체와 동일한 권한으로 실행됩니다. harbor는 기능을 **보이게** 하고, **감지**하고, 선언과 **대조**할 수 있지만 끌 수는 없습니다. 플러그인 동작을 격리하려면 DSH 로더 자체의 지원이 필요합니다. 아래의 선언 흐름은 이 기준을 추상적으로 주장하는 대신 데이터로 확립하기 위한 것입니다.

마지막으로 harbor는 점수가 아니라 사실을 보고합니다. 출력은 언제나 “무엇이 감지되었으며 그 근거가 어디에 있는가”입니다. 위험 수준도, 품질 등급도 제시하지 않습니다. 발견된 내용이 사용자에게 무엇을 의미하는지는 harbor가 아니라 사용자가 판단합니다.

> **상태: `0.1.0-rc.2`, 릴리스 후보 강화 중.** CLI, 루프백 전용 hub 경로, DSH 설정 패널, profile 간 드리프트, 선택적으로 실행하는 상위 확인을 사용할 수 있습니다. 실행 중인 호스트는 런타임 도구, Provider, 경로를 제공합니다. 실행 중인 호스트가 없으면 런타임 근거는 명시적으로 `available: false`로 폴백됩니다. 감지기는 여전히 휴리스틱 방식이며 더 넓은 생태계에 맞춰 조정 중이므로, 감지되지 않았다는 사실을 존재하지 않는다는 증거로 여기지 말고 근거를 검토하세요.

## 확인 대상

```
~/.dsh/profiles/*                → 설치된 서드파티 bundle(npm 및 link: 모두 포함)
  ├─ declared    package.json / cordis.patch.yml — 플러그인의 자체 선언
  ├─ runtime     호스트에 실제로 등록된 tools / routes / providers
  ├─ static      하위 프로세스, 외부 네트워크 통신, 외부 설정 쓰기 — file:line 포함
  ├─ versions    드리프트(로컬, 항상) + 상위(네트워크 사용, 선택 사항)
  └─ snapshot    이전 스캔과의 diff: 새 버전, 새 기능
        └─ 대조: 선언된 dsh.capabilities vs 실제 감지 결과
```

기능은 클라이언트 삽입, realm 위험, realm 복제본, 전역 훅, LLM 어댑터, 하위 프로세스, 외부 네트워크 통신, Web 경로, 도구 등록, MCP 서버, 외부 설정 쓰기, 자격 증명 처리, 환경 변수 읽기의 고정된 열세 가지 항목입니다. 목록을 고정해야 스캔 사이에서 보고서를 비교하고 diff할 수 있습니다. 공식 목록은 [SPEC.md](./SPEC.md) §2에 있으며, 기계가 읽을 수 있는 단일 기준은 `src/scan/detectors.mjs`입니다.

표현은 의도적으로 중립적입니다. “위험”이 아니라 **기능**이라고 부릅니다. 일부 플러그인에서는 하위 프로세스를 실행하는 것이 존재 목적 자체입니다. 보고서는 “무엇을 할 수 있는가”에 답하고, “그렇게 해야 하는가”는 사용자가 판단하도록 남겨 둡니다.

## 버전

harbor는 버전에 관한 두 가지 질문에 답하며, 둘을 명확히 구분합니다.

**profile 간 드리프트**는 전적으로 로컬 정보입니다. 동일한 플러그인이 profile마다 다른 버전으로 설치되어 있다는 것은 이 컴퓨터에 관한 사실이므로, 모든 스캔에서 추가 비용 없이 계산됩니다. `link:` 또는 `file:` 설치는 “최신” 기준으로 계산하지 않습니다. 작업 트리가 공개된 버전보다 앞서 있는 것은 정상이며 드리프트가 아닙니다.

**상위 확인**은 이 컴퓨터 밖으로 통신하므로 기본 스캔에는 절대 포함되지 않습니다. CLI에서는 `harbor scan --check-updates`가 필요합니다. 패널에서는 버튼을 명시적으로 눌러야 하며, 버튼 옆의 안내 문구에도 이 사실이 표시됩니다. 이 페이지에서 컴퓨터 밖으로 통신하는 동작은 이것뿐입니다. 각 결과는 다음 다섯 가지 상태 중 하나입니다.

- **behind** — registry에 더 새 버전이 있음
- **current** — 설치된 버전이 registry와 일치함
- **ahead** — 설치된 버전이 registry보다 새로움(관리자의 컴퓨터에서는 실제로 가능한 상태)
- **local** — 비교할 상위가 없는 `link:` / `file:` 설치이며, “최신”으로 표시되지 않음
- **unknown** — 조회 실패

registry는 npmjs로 하드코딩하지 않고 `@scope:registry` 재정의를 포함한 사용자의 `.npmrc`에서 읽습니다. 결과는 디스크에 6시간 동안 캐시됩니다.

## 설치

로컬 개발에서는 checkout에서 설치할 수 있습니다.

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin`은 나머지 인수를 profile 디렉터리 안의 pnpm으로 전달합니다. `link:`는 profile 의존성을 이 checkout에 심볼릭 링크하므로 다시 빌드한 내용이 바로 반영됩니다. registry에서 설치할 때는 후보 버전의 `next` tag를 사용하세요.

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@next
```

그런 다음 DSH를 다시 시작하여 새 profile 레이어를 로드하세요.

패널은 DSH Web UI의 **설정** 아래에 **DSH Harbor** 섹션으로 표시됩니다. CLI와 같은 내용을 보여 주는 거울로서 근거가 포함된 인벤토리, 충돌, 버전, 마지막 스캔 이후의 diff를 제공합니다. **업데이트 확인** 버튼은 이 페이지에서 컴퓨터 밖으로 통신하는 유일한 동작입니다. 패널은 플러그인의 hub 부분에 속하며 Web 서버가 있는 profile에서만 마운트됩니다.

플러그인의 실행 파일은 선택한 profile 안에 설치됩니다. 플러그인을 `web`에 추가해도 `harbor`가 셸의 전역 `PATH`에 들어가지는 않습니다. 해당 profile을 통해 실행하세요.

```bash
pnpm --dir ~/.dsh/profiles/web exec harbor scan
```

checkout에서 실행하거나 registry에서 한 번만 실행하려면 각각 다음 중 하나를 사용하세요.

```bash
node /path/to/dsh-harbor/src/cli.mjs scan
pnpm dlx @zseven-w/dsh-harbor@next scan
```

## 사용법

아래 예제에서는 위 실행 방법 중 하나를 줄여서 `harbor`라고 표기합니다.

```bash
harbor scan                 # 인벤토리, 충돌, 마지막 스캔 이후의 변경 사항
harbor scan --check-updates # + registry에 대한 선택적 상위 확인(네트워크 사용)
harbor manifest ./my-plugin # 내 플러그인의 dsh.capabilities 블록 초안 생성
```

`--evidence`를 추가하면 사용 가능한 `file:line` 형식의 소스 근거를 출력하고, `--json`은 기계가 읽을 수 있는 전체 보고서를 출력합니다. `--no-snapshot`은 diff 기준선 기록을 건너뜁니다. manifest, 파일 시스템 또는 런타임에서 얻은 사실에는 소스 줄이 없을 수 있으며, 이 경우 그에 맞게 표시됩니다.

스캐너는 의존성이 없고 DSH를 설치하지 않아도 되므로 CI에서도 실행할 수 있습니다.

## 플러그인 작성자를 위한 안내

`harbor manifest`는 다른 모든 플러그인을 읽는 것과 같은 방식으로 사용자의 플러그인을 읽고, `package.json`의 기존 `dsh` 객체에 병합할 `capabilities` 멤버의 초안을 만듭니다. 전체 객체를 교체하여 `bundle` 또는 `client` 설정을 잃으라고 요구하지 않습니다. 선언하고 나면 harbor의 확인은 **선언 vs 감지**가 됩니다. 선언했지만 전혀 사용하지 않는 기능은 줄일 수 있는 잡음이며, 감지되었지만 선언하지 않은 기능은 설명할 가치가 있습니다. harbor도 자체 `dsh.capabilities`를 선언하므로 도구 자체에서 이 흐름을 재현할 수 있습니다. 이 저장소에서 `harbor manifest .`를 실행하세요.

규칙 자체는 [SPEC.md](./SPEC.md) ([SPEC.zh.md](./SPEC.zh.md))에 기록되어 있습니다. 한 줄로 요약하면 `dsh.capabilities`는 플러그인의 코드가 실제로 하는 일을 명시하는 `package.json`의 일반 목록입니다. 선언 비용은 적지만 두 가지 이점이 있습니다. harbor 같은 감사 도구가 선언과 코드를 대조할 수 있고, 플러그인을 실행하는 사람은 아무것도 숨기지 않았음을 알 수 있습니다. 언제든 `harbor manifest <dir>`로 자신의 선언을 자체 점검할 수 있습니다.

## 한계를 솔직히 말하면

harbor는 모든 플러그인의 소스를 읽기 때문에 이 환경에서 가장 높은 권한을 가진 도구입니다. harbor 자체도 자신의 보고서에 표시됩니다.

상위 확인을 활성화하면 harbor 자체가 외부 네트워크 통신 기능을 갖게 되며, 이미 자체 `dsh.capabilities` 선언에 이 기능을 명시했습니다.

## 라이선스

MIT
