$ErrorActionPreference = 'Stop'

$installerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $installerDir '..')
$launcherSource = Join-Path $installerDir 'launcher\JamePDFLauncher.cs'
$launcherExe = Join-Path $repoRoot 'JamePDF.exe'
$iconPath = Join-Path $installerDir 'images\app_icon.ico'
$setupScript = Join-Path $installerDir 'setup.iss'
$outputSetup = Join-Path $installerDir 'Output\JamesPDF_Setup.exe'
$rootSetup = Join-Path $repoRoot 'JamesPDF_Setup.exe'
$packageJson = Join-Path $repoRoot 'app\package.json'

$packageVersion = (Get-Content $packageJson -Raw | ConvertFrom-Json).version
$setupText = Get-Content $setupScript -Raw
if ($setupText -notmatch ('#define MyAppVersion "' + [regex]::Escape($packageVersion) + '"')) {
  throw "Version mismatch: app/package.json is $packageVersion but installer/setup.iss is different."
}

if (!(Test-Path (Join-Path $repoRoot 'node.exe'))) {
  throw 'Bundled node.exe was not found at the project root.'
}

if (!(Test-Path (Join-Path $repoRoot 'app\node_modules'))) {
  throw 'app/node_modules was not found. Run npm ci in the app directory first.'
}

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
