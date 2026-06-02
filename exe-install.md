# James PDF V4.0.0.0 EXE 설치 파일 제작 지침

이 문서는 **James PDF V4.0.0.0**을 Windows 배포용 `EXE` 설치 파일로 만드는 절차를 정리한 문서입니다.  
기준 방식은 **JamesPDF_V3.0.0_Final**에서 사용한 런처 + Inno Setup 패키징 구조를 따릅니다.

## 기준 정보

- 앱 이름: **James PDF**
- 버전: **V4.0.0.0**
- 설치 파일 이름: `JamesPDF_Setup.exe`
- 실행 런처 이름: `JamePDF.exe`
- 기본 포트: `5200`
- 개발 작업본: `C:\JamePDF-work\JamesPDF_V4.0.0.0`
- 참고 기준본: `Z:\내 드라이브\AI\안티그래비티\james-PDF\JamesPDF_V3.0.0_Final`
- 참고 installer 자료: `Z:\내 드라이브\AI\안티그래비티\james-PDF\installer`

## V3.0.0_Final에서 사용된 제작 방식

V3 Final은 다음 구조로 설치 파일을 만들었습니다.

1. C# 런처 소스 `installer\launcher\JamePDFLauncher.cs`를 컴파일하여 `JamePDF.exe`를 생성합니다.
2. 런처는 설치 폴더 안의 `node.exe`와 `app\server.js`를 실행합니다.
3. 서버가 `http://localhost:5200/`에서 준비되면 Edge 또는 Chrome을 `--app=` 모드로 실행합니다.
4. Inno Setup 스크립트 `installer\setup.iss`가 앱 파일 전체를 설치 폴더로 복사합니다.
5. 설치 마법사에는 `installer\images` 폴더의 아이콘과 이미지를 사용합니다.
6. 최종 결과물은 `installer\Output\JamesPDF_Setup.exe`로 생성됩니다.

V4에서도 같은 흐름을 사용하시면 됩니다.

## 필요한 도구

### 1. Windows .NET Framework C# Compiler

V3 방식은 별도 Visual Studio 프로젝트 없이 Windows 기본 .NET Framework 컴파일러를 사용합니다.

예상 위치:

```powershell
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
```

확인 명령:

```powershell
Test-Path "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
```

### 2. Inno Setup 6

설치 파일 생성에는 Inno Setup Compiler인 `ISCC.exe`가 필요합니다.

V3 스크립트에서 확인한 후보 위치:

```text
%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe
%LOCALAPPDATA%\Programs\Antigravity IDE\resources\app\node_modules\innosetup\bin\ISCC.exe
C:\Program Files (x86)\Inno Setup 6\ISCC.exe
C:\Program Files\Inno Setup 6\ISCC.exe
```

확인 명령:

```powershell
Get-Command ISCC.exe -ErrorAction SilentlyContinue
```

없으면 Inno Setup 6을 설치하신 뒤 다시 진행하시면 됩니다.

## V4 배포 폴더 구성

V4 설치 패키지에는 다음 항목이 포함되어야 합니다.

```text
JamesPDF_V4.0.0.0\
  app\
    public\
    server.js
    package.json
    package-lock.json
    node_modules\
    uploads\
    outputs\
    data\
  installer\
    images\
      app_icon.ico
      app_icon.png
      sidebar.bmp
      sidebar.png
      logo.bmp
      logo.png
    launcher\
      JamePDFLauncher.cs
    setup.iss
    build-v4.ps1
  JamePDF.exe
  node.exe
  README.md
  LICENSE
```

`uploads`, `outputs`, `data` 폴더는 설치 후 앱이 사용할 작업 폴더입니다. 비어 있더라도 설치 스크립트에서 생성되도록 지정하는 것이 좋습니다.

## V3 이미지 자산 재사용

V3에서 사용된 설치 마법사 이미지는 다음 폴더에 있습니다.

```text
Z:\내 드라이브\AI\안티그래비티\james-PDF\installer\images
```

주요 파일:

```text
app_icon.ico
app_icon.png
sidebar.bmp
sidebar.png
logo.bmp
logo.png
```

V4에서도 이 이미지를 그대로 사용하시면 됩니다.

복사 예시:

```powershell
$root = "C:\JamePDF-work\JamesPDF_V4.0.0.0"
$v3Images = "Z:\내 드라이브\AI\안티그래비티\james-PDF\installer\images"

New-Item -ItemType Directory -Force "$root\installer\images"
Copy-Item "$v3Images\*" "$root\installer\images" -Recurse -Force
```

V3 Final 내부에는 최소 이미지로 `installer\images\app_icon.ico`가 들어 있습니다.  
설치 마법사의 왼쪽 배너와 작은 로고까지 V3처럼 쓰려면 루트 `installer\images` 폴더의 `sidebar.bmp`, `logo.bmp`도 함께 복사해야 합니다.

## V4 런처 수정 지침

V3 런처 소스:

```text
Z:\내 드라이브\AI\안티그래비티\james-PDF\installer\launcher\JamePDFLauncher.cs
```

V4용으로 복사한 뒤 다음 값을 수정합니다.

| 항목 | V3 값 | V4 값 |
|---|---|---|
| AssemblyDescription | `JamesPDF V3.0.0 launcher` | `James PDF V4.0.0.0 launcher` |
| AssemblyCompany | `Eun Jun-Ug` | `Cybereun` |
| AssemblyProduct | `JamesPDF` | `James PDF` |
| AssemblyFileVersion | `3.0.0.0` | `4.0.0.0` |
| AssemblyVersion | `3.0.0.0` | `4.0.0.0` |
| AppTitle | `JamesPDF V3.0.0` | `James PDF V4.0.0.0` |
| Health version check | `"version":"3.0.0"` | `"version":"4.0.0.0"` |
| Error messages | `JamesPDF V3.0.0` | `James PDF V4.0.0.0` |

V4 런처의 핵심 동작은 V3와 동일하게 유지합니다.

- `JamePDF.exe`가 있는 폴더를 기준으로 `app\server.js`를 찾습니다.
- 같은 폴더의 `node.exe`를 사용해 서버를 실행합니다.
- 환경변수 `PORT=5200`을 설정합니다.
- `/api/health`가 준비될 때까지 대기합니다.
- Edge 또는 Chrome이 있으면 `--app=http://localhost:5200/` 모드로 실행합니다.
- Edge/Chrome이 없으면 기본 브라우저로 URL을 엽니다.

## V4 런처 컴파일 예시

```powershell
$ErrorActionPreference = "Stop"

$root = "C:\JamePDF-work\JamesPDF_V4.0.0.0"
$launcherSource = "$root\installer\launcher\JamePDFLauncher.cs"
$launcherExe = "$root\JamePDF.exe"
$iconPath = "$root\installer\images\app_icon.ico"
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (!(Test-Path $csc)) {
  throw "C# compiler not found: $csc"
}

& $csc `
  /nologo `
  /target:winexe `
  /optimize+ `
  /platform:anycpu `
  "/out:$launcherExe" `
  "/win32icon:$iconPath" `
  /reference:System.dll `
  /reference:System.Windows.Forms.dll `
  "$launcherSource"
```

컴파일 후 확인:

```powershell
Test-Path "C:\JamePDF-work\JamesPDF_V4.0.0.0\JamePDF.exe"
```

## V4 Inno Setup 스크립트 지침

V3 스크립트:

```text
Z:\내 드라이브\AI\안티그래비티\james-PDF\installer\setup.iss
```

V4용으로 복사한 뒤 다음 값을 수정합니다.

```ini
#define MyAppName "James PDF"
#define MyAppVersion "4.0.0.0"
#define MyAppPublisher "Cybereun"
#define MyAppExeName "JamePDF.exe"
```

권장 `[Setup]` 주요 값:

```ini
[Setup]
AppId={{A8A9F7D7-7B43-4A3F-9A6C-JAMESPDFV4000}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://github.com/cybereun
AppSupportURL=https://github.com/cybereun/JamesPDF-V4
DefaultDirName={localappdata}\JamesPDF
DefaultGroupName=James PDF
AllowNoIcons=yes
OutputDir=Output
OutputBaseFilename=JamesPDF_Setup
Compression=lzma2/ultra64
SolidCompression=yes
SetupIconFile=images\app_icon.ico
WizardImageFile=images\sidebar.bmp
WizardSmallImageFile=images\logo.bmp
DisableWelcomePage=no
DisableFinishedPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=James PDF V4.0.0.0 standalone PDF studio
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
```

주의: `AppId`는 V3와 다른 새 GUID를 사용해야 합니다.  
위 예시는 형식 안내용입니다. 실제 스크립트에서는 Inno Setup GUID 형식에 맞는 새 GUID를 생성해 사용하십시오.

PowerShell에서 GUID 생성:

```powershell
[guid]::NewGuid().ToString().ToUpper()
```

권장 `[InstallDelete]`:

```ini
[InstallDelete]
Type: filesandordirs; Name: "{app}\JamePDF_v3.0.0"
Type: filesandordirs; Name: "{app}\JamePDF V3.0.0"
Type: filesandordirs; Name: "{app}\JamesPDF_V3.0.0_Final"
Type: filesandordirs; Name: "{app}\JamesPDF V2.0.0"
Type: filesandordirs; Name: "{app}\james-app"
Type: filesandordirs; Name: "{app}\james-portal"
Type: files; Name: "{app}\run-portal.bat"
```

권장 `[Dirs]`:

```ini
[Dirs]
Name: "{app}\app\uploads"
Name: "{app}\app\data"
Name: "{app}\app\outputs"
```

권장 `[Files]`:

```ini
[Files]
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: ".git\*,installer\Output\*,app\uploads\*,app\outputs\*,app\data\*"
Source: "images\app_icon.ico"; DestDir: "{app}\installer\images"; Flags: ignoreversion
```

권장 `[Icons]`:

```ini
[Icons]
Name: "{group}\James PDF V4.0.0.0"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\installer\images\app_icon.ico"
Name: "{group}\{cm:UninstallProgram,James PDF}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\James PDF V4.0.0.0"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\installer\images\app_icon.ico"; Tasks: desktopicon
```

권장 `[Run]`:

```ini
[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch James PDF V4.0.0.0"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent
```

## V4 build-v4.ps1 예시

V3의 `build-v3.ps1`을 복사해 `build-v4.ps1`로 만든 뒤 다음처럼 수정합니다.

```powershell
$ErrorActionPreference = 'Stop'

$installerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $installerDir '..')
$launcherSource = Join-Path $installerDir 'launcher\JamePDFLauncher.cs'
$launcherExe = Join-Path $repoRoot 'JamePDF.exe'
$iconPath = Join-Path $installerDir 'images\app_icon.ico'
$setupScript = Join-Path $installerDir 'setup.iss'
$outputSetup = Join-Path $installerDir 'Output\JamesPDF_Setup.exe'
$rootSetup = Join-Path $repoRoot 'JamesPDF_Setup.exe'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path $csc)) {
  throw "C# compiler not found: $csc"
}

& $csc `
  /nologo `
  /target:winexe `
  /optimize+ `
  /platform:anycpu `
  "/out:$launcherExe" `
  "/win32icon:$iconPath" `
  /reference:System.dll `
  /reference:System.Windows.Forms.dll `
  "$launcherSource"

$isccCandidates = @()
$command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($command) {
  $isccCandidates += $command.Source
}
$isccCandidates += @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity IDE\resources\app\node_modules\innosetup\bin\ISCC.exe'),
  'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  'C:\Program Files\Inno Setup 6\ISCC.exe'
)

$iscc = $isccCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (!$iscc) {
  throw 'Inno Setup compiler ISCC.exe was not found.'
}

& $iscc "$setupScript"
Copy-Item -LiteralPath $outputSetup -Destination $rootSetup -Force

Write-Host "Built $rootSetup"
```

## 제작 순서

### 1. V4 작업본 준비

```powershell
$root = "C:\JamePDF-work\JamesPDF_V4.0.0.0"
Test-Path "$root\app\server.js"
Test-Path "$root\node.exe"
Test-Path "$root\app\public\index.html"
```

### 2. 의존성 확인

설치 패키지에는 `app\node_modules`가 포함되어야 합니다.  
현재 V4 작업본은 V3 Final의 의존성을 기반으로 복원되어 있으므로, 패키징 전 다음 파일이 있는지 확인하십시오.

```powershell
Test-Path "$root\app\node_modules\express"
Test-Path "$root\app\node_modules\pdf-lib"
Test-Path "$root\app\node_modules\@opendataloader\pdf\lib\opendataloader-pdf-cli.jar"
```

`node_modules`가 없으면 설치 프로그램으로 배포해도 실행되지 않습니다.

### 3. V3 이미지와 스크립트 복사

```powershell
$v3Installer = "Z:\내 드라이브\AI\안티그래비티\james-PDF\installer"

New-Item -ItemType Directory -Force "$root\installer\images"
New-Item -ItemType Directory -Force "$root\installer\launcher"

Copy-Item "$v3Installer\images\*" "$root\installer\images" -Recurse -Force
Copy-Item "$v3Installer\launcher\JamePDFLauncher.cs" "$root\installer\launcher\JamePDFLauncher.cs" -Force
Copy-Item "$v3Installer\setup.iss" "$root\installer\setup.iss" -Force
Copy-Item "$v3Installer\build-v3.ps1" "$root\installer\build-v4.ps1" -Force
```

### 4. V4 값으로 수정

다음 파일을 V4 기준으로 수정합니다.

```text
installer\launcher\JamePDFLauncher.cs
installer\setup.iss
installer\build-v4.ps1
```

수정해야 하는 핵심 값:

```text
3.0.0 또는 3.0.0.0 -> 4.0.0.0
JamesPDF V3.0.0 -> James PDF V4.0.0.0
Eun Jun-Ug -> Cybereun
JamePDF_v3.0.0 -> JamesPDF_V4.0.0.0 또는 현재 루트 기준 경로
```

### 5. 설치 파일 빌드

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
& "$root\installer\build-v4.ps1"
```

성공하면 다음 파일이 생성됩니다.

```text
C:\JamePDF-work\JamesPDF_V4.0.0.0\installer\Output\JamesPDF_Setup.exe
C:\JamePDF-work\JamesPDF_V4.0.0.0\JamesPDF_Setup.exe
```

## 설치 파일 검증

### 1. 런처 단독 검증

```powershell
& "C:\JamePDF-work\JamesPDF_V4.0.0.0\JamePDF.exe" --check-only
```

정상 기준:

- 종료 코드가 `0`이어야 합니다.
- `app\server.js`와 `node.exe`를 찾을 수 있어야 합니다.

### 2. 서버 실행 검증

```powershell
& "C:\JamePDF-work\JamesPDF_V4.0.0.0\JamePDF.exe" --no-browser
Invoke-WebRequest "http://localhost:5200/api/health" -UseBasicParsing
```

정상 기준:

- `/api/health` 응답에 V4 버전 정보가 포함되어야 합니다.
- 브라우저에서 `http://localhost:5200/` 접속 시 **James PDF** 화면이 표시되어야 합니다.

### 3. 설치 파일 검증

1. `JamesPDF_Setup.exe`를 실행합니다.
2. 설치 위치는 기본값 `{localappdata}\JamesPDF`를 사용합니다.
3. 설치 완료 후 `James PDF V4.0.0.0` 바로가기로 실행합니다.
4. 앱 화면 상단에 `James PDF`와 `V4.0.0.0 PDF Studio`가 표시되는지 확인합니다.
5. PDF 열기, AI 탭 열기, `/api/health` 응답을 확인합니다.
6. 제거 프로그램이 정상 등록되는지 확인합니다.

## 주의 사항

- `node.exe`는 GitHub 저장소에는 제외되어 있어도 설치 패키지에는 포함되어야 합니다.
- `app\node_modules`는 GitHub 저장소에는 제외되어 있어도 설치 패키지에는 포함되어야 합니다.
- `app\uploads`, `app\outputs`, `app\data`는 사용자 작업 데이터 폴더이므로 빌드 시 기존 테스트 파일은 제외하고 빈 폴더만 생성하는 것이 좋습니다.
- `installer\Output`은 빌드 결과 폴더이므로 소스 패키지에는 제외해도 됩니다.
- V3와 같은 AppId를 사용하면 Windows가 같은 앱으로 인식할 수 있으므로 V4는 새 AppId를 사용하십시오.
- 설치 파일을 재빌드하기 전에 기존 `installer\Output\JamesPDF_Setup.exe`를 삭제하고 새로 만드는 것이 좋습니다.

## 권장 산출물

최종 배포용으로 보관할 파일:

```text
JamesPDF_Setup.exe
README.md
LICENSE
exe-install.md
```

선택적으로 함께 보관할 파일:

```text
installer\setup.iss
installer\build-v4.ps1
installer\launcher\JamePDFLauncher.cs
installer\images\app_icon.ico
installer\images\sidebar.bmp
installer\images\logo.bmp
```

