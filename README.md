# 마크다운 뷰어

Windows 데스크톱에서 Markdown 문서를 읽기 전용으로 열어 보기 위한 Tauri 기반 뷰어입니다. `마크다운 뷰어.dc.html`의 화면 구성과 사용 경험을 기준으로 React/TypeScript 프론트엔드와 Rust/Tauri 백엔드로 구현했습니다.

## 주요 기능

- `.md`, `.markdown`, `.txt` 파일 읽기 전용 열람
- 상단 파일 메뉴와 `Ctrl+O`를 통한 파일 열기
- Windows 탐색기/데스크톱에서 파일 드래그 앤 드롭으로 열기
- Windows 파일 연결을 통한 `.md`, `.markdown` 문서 열기
- 여러 문서를 동시에 열고 전환하는 탭 UI
- 최근 열었던 파일 목록
- 파일 북마크와 제목 위치 북마크
- 북마크 이름 직접 편집
- Claude Serif 기본 서체와 시스템 폰트 선택
- 확대/축소 메뉴, 툴바, `Ctrl + 마우스 휠`, `Ctrl + +/-/0`
- 라이트/다크 모드
- Mermaid 다이어그램 렌더링
- 코드 하이라이트, 표, 인용문, 체크리스트 등 Markdown 표시 스타일
- 커스텀 타이틀바의 창 이동, 최소화, 최대화, 종료 버튼
- 릴리스 빌드에서 Windows 콘솔 창 없이 실행

## 기술 스택

- Tauri v2
- Rust 2021
- React 18
- TypeScript
- Vite
- marked
- highlight.js
- mermaid

## 프로젝트 구조

```text
.
├─ src/                         # React 프론트엔드
│  ├─ App.tsx                   # 메인 뷰어 UI와 상태 관리
│  ├─ main.tsx                  # React 진입점
│  └─ styles.css                # 앱 스타일
├─ src-tauri/                   # Tauri/Rust 앱
│  ├─ src/main.rs               # 파일 읽기, 폰트 목록, 시작 인자 처리
│  ├─ tauri.conf.json           # 창, 번들, 파일 연결, 아이콘 설정
│  ├─ capabilities/default.json # Tauri 권한 설정
│  └─ icons/                    # 앱 아이콘 자산
├─ 마크다운 뷰어.dc.html        # 원본 참고 HTML
├─ markdown-samples.js          # 참고 샘플 데이터
├─ support.js                   # 원본 참고 런타임 스크립트
├─ img.png                      # 대표 아이콘 원본 이미지
└─ PLAN.md                      # 구현 계획 문서
```

## 개발 환경 준비

필요한 도구:

- Node.js
- npm
- Rust
- Tauri v2 개발에 필요한 Windows 빌드 도구

의존성 설치:

```powershell
npm install
```

## 개발 실행

Tauri 개발 모드:

```powershell
npx tauri dev
```

프론트엔드만 실행:

```powershell
npm run dev
```

프론트엔드 미리보기:

```powershell
npm run preview
```

## 빌드

프론트엔드 빌드:

```powershell
npm run build
```

Tauri 실행 파일 빌드:

```powershell
npx tauri build --no-bundle
```

Windows 설치 파일까지 포함한 전체 빌드:

```powershell
npx tauri build
```

빌드 산출물:

- 실행 파일: `src-tauri/target/release/markdown-viewer.exe`
- NSIS 설치 파일: `src-tauri/target/release/bundle/nsis/마크다운 뷰어_0.1.0_x64-setup.exe`

## 사용 방법

앱 실행 후 상단 메뉴의 `파일 > 열기` 또는 `Ctrl+O`로 Markdown 파일을 선택합니다. 파일을 창 안으로 드래그 앤 드롭해도 열 수 있습니다.

설치 파일로 앱을 설치하면 `.md`, `.markdown` 파일 연결을 통해 탐색기에서 문서를 바로 열 수 있습니다. 이미 앱이 실행 중인 경우 단일 인스턴스 플러그인이 기존 창으로 파일 열기 이벤트를 전달합니다.

## 단축키

| 단축키 | 기능 |
| --- | --- |
| `Ctrl+O` | 파일 열기 |
| `Ctrl+D` | 현재 파일 북마크 토글 |
| `Ctrl+W` | 현재 탭 닫기 |
| `Ctrl++` | 확대 |
| `Ctrl+-` | 축소 |
| `Ctrl+0` | 확대율 100% |
| `Ctrl + 마우스 휠` | 확대/축소 |

## 앱 데이터

최근 파일, 테마, 폰트, 확대율, 사이드바 상태, 북마크 정보는 브라우저 로컬 저장소에 저장됩니다. 저장 키는 `markdown-viewer-tauri-v1`입니다.

## 아이콘

대표 아이콘은 루트의 `img.png`를 원본으로 사용합니다. Tauri 번들용 아이콘은 `src-tauri/icons/` 아래에 생성되어 있으며, `src-tauri/tauri.conf.json`의 `bundle.icon` 설정에서 참조합니다.

## 검증 명령

최근 검증한 명령:

```powershell
cargo check
npm run build
npx tauri build --no-bundle
npx tauri build
```

Mermaid 번들 때문에 Vite가 일부 chunk 크기 경고를 출력할 수 있습니다. 현재 경고는 빌드를 막지 않습니다.
