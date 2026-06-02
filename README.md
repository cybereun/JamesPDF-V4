# James PDF

![Version](https://img.shields.io/badge/version-V4.0.0.0-2563eb?style=for-the-badge)
![Developer](https://img.shields.io/badge/developer-Eun%20Jun%20Ug-111827?style=for-the-badge)
![Platform](https://img.shields.io/badge/platform-Windows%20Desktop-0f766e?style=for-the-badge)
![PDF Studio](https://img.shields.io/badge/PDF-Studio-f97316?style=for-the-badge)
![AI Agent](https://img.shields.io/badge/AI-Agent%20Panel-7c3aed?style=for-the-badge)

**Version:** V4.0.0.0  
**Developer:** Eun Jun Ug  
**Application Name:** James PDF  
**Studio Label:** V4.0.0.0 PDF Studio

James PDF V4.0.0.0 is a Windows-focused PDF studio that combines PDF viewing, extraction, editing, conversion, security tools, printing workflows, search, OCR-assisted analysis, and an AI Agent panel in a single desktop-style web application.

## 제작 과정 기록

### 1. V4.0.0.0 작업본 복원

- V4.0.0.0 원본 경로를 분석했다.
- 안정적인 개발을 위해 C 드라이브에 격리 작업본을 만들었다.
- `JamesPDF_V3.0.0_Final`을 기준으로 누락된 `app/public` UI 파일을 복원했다.
- V3 최종본의 정적 UI를 V4 서버 구조와 다시 연결했다.
- 필요한 Node 런타임과 서버 실행 환경을 C 작업본에서 구성했다.
- `http://localhost:5200/`에서 앱이 실행되도록 서버를 띄웠다.

### 2. V4 브랜딩 정리

- 화면 제목과 버전 표기를 V4 기준으로 정리했다.
- 앱 이름을 **James PDF**로 수정했다.
- 상단 스튜디오 라벨인 **V4.0.0.0 PDF Studio**는 유지했다.

### 3. 오른쪽 AI Agent 패널 재구성

- V4 서버에 존재하던 `/api/ai/status`, `/api/ai/chat` API를 확인했다.
- `JamesPDF_V3.0.0_Final`의 UI를 기준으로 오른쪽 패널에 AI Agent 탭을 재구성했다.
- `agy-obsidian` 자료를 참고하여 CLI agent 상태 확인, provider 선택, 모델 선택 구조를 설계했다.
- AI 패널에 연결 상태, 프리셋 버튼, 채팅 로그, 입력 composer를 추가했다.

### 4. AI 연결 상태 표시

- Codex CLI, Antigravity CLI, Claude CLI, Ollama/Gemma 상태를 표시하도록 구성했다.
- 선택된 provider가 연결되면 초록색 연결 배지를 표시한다.
- 연결되지 않은 provider는 오프라인 상태로 표시한다.
- AI 상태 새로고침 버튼을 추가했다.

### 5. 채팅 UX 개선

- 질문 입력 후 보내면 사용자의 질문이 채팅창에 먼저 표시되도록 만들었다.
- AI 답변은 질문 아래에 표시되며, 응답 대기 중에는 pending 메시지를 보여준다.
- 대화 내용은 계속 유지되고, 지우기 버튼을 누를 때만 초기화된다.
- `Ctrl + Enter` 또는 `Cmd + Enter`로 질문을 보낼 수 있게 했다.
- 전송 중에는 보내기 버튼이 중지 버튼으로 바뀌고, 클릭하면 현재 요청을 취소한다.

### 6. 입력창 디자인 개선

- AI 입력창을 둥근 composer 스타일로 재설계했다.
- PDF 컨텍스트 버튼, 대화 지우기 버튼, provider 선택, model 선택, 보내기/중지 버튼을 한 줄에 배치했다.
- 오른쪽 패널 폭이 좁아도 보내기 버튼이 잘리지 않도록 provider/model 선택창 폭을 조정했다.

### 7. Markdown 및 표 렌더링

- AI 답변의 `**굵게**`, 번호 목록, 불릿 목록을 보기 좋은 HTML로 렌더링하도록 개선했다.
- Markdown 표 형식의 답변은 실제 표로 렌더링한다.
- 표가 패널 폭을 넘는 경우 가로 스크롤로 볼 수 있게 했다.
- AI 답변 HTML은 먼저 escape한 뒤 제한된 Markdown만 변환하여 안전성을 유지했다.

### 8. CLI Agent 및 Model 선택 구조

- provider 선택창을 `Codex`, `Antigravity`, `Claude`, `Ollama`로 구성했다.
- provider를 바꾸면 model/agent 선택 목록이 자동으로 변경된다.
- Codex 선택 시 Codex 계열 preset을 보여준다.
- Antigravity 선택 시 Gemini, Claude, GPT-OSS 계열 agent/model preset을 보여준다.
- Claude 선택 시 Claude 계열 preset을 보여준다.
- Ollama 선택 시 `gemma4:e4b`와 실제 Ollama 모델 목록을 보여준다.
- 선택한 agent/model 정보는 AI 요청 컨텍스트에 함께 포함된다.

### 9. 최종본 동기화

- 주요 변경은 C 작업본에 먼저 적용했다.
- 검증 후 Y 드라이브의 V4.0.0.0 최종본 경로에도 `app/public` 변경분을 복사했다.

## 주요 특징

### PDF 보기 및 탐색

- PDF 파일 열기, 닫기, 저장을 지원한다.
- 페이지 이동, 이전/다음 페이지 이동, 페이지 번호 입력 이동을 지원한다.
- 확대, 축소, 폭 맞춤 보기 기능을 제공한다.
- 왼쪽 썸네일 패널을 통해 문서 구조를 빠르게 탐색할 수 있다.
- 현재 페이지 번호, 전체 페이지 수, 확대 비율을 상태바에서 확인할 수 있다.

### PDF 텍스트 및 데이터 추출

- 현재 페이지 텍스트 복사를 지원한다.
- PDF에서 Markdown과 JSON 형태의 분석 결과를 추출할 수 있다.
- Hybrid OCR/Formula 서버 연동 구조를 지원한다.
- 추출 결과를 복사하거나 후속 AI 분석 컨텍스트로 사용할 수 있다.

### 검색 기능

- 문서 내 텍스트 검색을 지원한다.
- 검색 결과 목록과 결과 개수를 표시한다.
- 검색 결과를 클릭해 해당 위치로 이동할 수 있다.
- 검색 위젯을 통해 이전/다음 결과를 빠르게 탐색할 수 있다.

### 편집 기능

- 텍스트 주석 추가를 지원한다.
- 글꼴, 글자 크기, 굵게, 기울임, 밑줄, 취소선, 색상 편집 도구를 제공한다.
- 워터마크 적용 기능을 지원한다.
- 페이지 회전, 추출, 분할 등 페이지 단위 편집 기능을 제공한다.

### 변환 및 파일 작업

- 이미지 파일을 PDF로 변환할 수 있다.
- 여러 PDF 파일을 병합할 수 있다.
- PDF를 다른 출력 형식으로 내보내는 구조를 포함한다.
- 문서 저장과 다운로드 중심의 작업 흐름을 지원한다.

### 인쇄 도구

- 인쇄 레이아웃 생성 기능을 제공한다.
- 인쇄 미리보기와 다운로드 전용 실행 흐름을 지원한다.
- 페이지 범위 기반 인쇄 작업을 구성할 수 있다.

### 보안 도구

- PDF 암호 설정 기능을 지원한다.
- PDF 암호 해제 기능을 지원한다.
- qpdf가 설치된 환경에서는 보안 관련 작업이 활성화된다.

### AI Agent 패널

- 오른쪽 사이드 패널에서 AI Agent를 사용할 수 있다.
- 문서 요약, 정리, 질문, 새 제안 프리셋을 제공한다.
- 질문 입력 후 채팅 로그에 사용자 질문과 AI 답변이 순서대로 표시된다.
- AI 답변은 Markdown 목록, 굵은 글씨, 표를 보기 좋은 형태로 렌더링한다.
- 전송 중 중지 버튼으로 요청 취소가 가능하다.
- provider별 연결 상태를 표시한다.
- Codex CLI, Antigravity CLI, Claude CLI, Ollama/Gemma 기반의 AI 작업 흐름을 지원한다.

### AI Provider 및 Model 선택

- Codex: Codex 계열 agent preset 선택을 지원한다.
- Antigravity: Gemini, Claude, GPT-OSS 계열 agent/model preset 선택을 지원한다.
- Claude: Claude 계열 preset 선택을 지원한다.
- Ollama: 로컬 Ollama 모델을 선택할 수 있으며 기본 모델은 `gemma4:e4b`이다.
- 선택한 provider와 model 정보는 AI 요청에 함께 포함되어 답변 스타일과 처리 방향에 반영된다.

### 사용자 경험

- Microsoft Office 스타일의 리본 메뉴 구조를 사용한다.
- 왼쪽 썸네일, 중앙 PDF 뷰어, 오른쪽 도구 패널로 구성된다.
- 오른쪽 패널 접기/펼치기를 지원한다.
- 버튼에는 Lucide 아이콘을 사용해 도구 의미를 직관적으로 보여준다.
- 채팅 입력창은 둥근 composer 형태로 구성되어 자연스러운 AI 채팅 경험을 제공한다.

## 실행 정보

개발 작업본:

```text
C:\JamePDF-work\JamesPDF_V4.0.0.0
```

실행 URL:

```text
http://localhost:5200/
```

최종 복사 대상:

```text
Y:\내 드라이브\AI\안티그래비티\james-PDF\JamesPDF_V4.0.0.0
```

## 변경 관리 메모

- V4 작업은 C 드라이브 격리 작업본에서 먼저 진행했다.
- 화면 UI 변경은 `app/public/index.html`, `app/public/app.js`, `app/public/style.css`에 집중되어 있다.
- 서버 재시작 없이 정적 파일 새로고침만으로 대부분의 UI 변경을 확인할 수 있다.
- 검증 후 Y 드라이브 최종본으로 변경분을 복사한다.

