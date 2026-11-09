<#
.SYNOPSIS
  一条命令把本项目发布到 GitHub：替换占位符 → 建仓 → 推送 → 打 tag → 发 Release（含安装包）。

.DESCRIPTION
  需要 GitHub 个人访问令牌（PAT），勾选 repo 权限即可，用完可立即在
  https://github.com/settings/tokens 撤销。

.EXAMPLE
  # 预演：只替换占位符，不联网、不推送
  powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 -User your-name -DryRun

.EXAMPLE
  # 正式发布
  powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 -User your-name -Token ghp_xxxxxxxx
#>
param(
  [Parameter(Mandatory = $true)][string]$User,
  [string]$Token = $env:GITHUB_TOKEN,
  [string]$Repo = 'pdf-reader',
  [string]$Version = '1.0.0',
  [string]$Installer = 'dist\PDFReader-Setup-1.0.0.exe',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

# ---- 找到 git（部分环境 PATH 里没有）
$gitExe = 'git'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  $candidates = @(
    'C:\Program Files\Git\cmd\git.exe',
    'C:\Program Files (x86)\Git\cmd\git.exe',
    "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe",
    "$env:ProgramFiles\Git\mingw64\bin\git.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { $gitExe = $c; break } }
}
function RunGit { & $gitExe @args }

$Description = '界面纯净、功能丰富的 PDF 阅读器：复刻 Edge 阅读器观感，内置标注、改字、页面编辑与中英双语离线 OCR'
$Topics = @('pdf','pdf-reader','pdf-editor','pdf-annotation','ocr','offline-ocr','chinese-ocr','paddleocr',
            'onnxruntime','electron','javascript','desktop-app','windows','pdfjs','pdf-lib','edge-style',
            'dark-mode','text-recognition','dbnet','crnn-ctc')

function Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "   !   $msg" -ForegroundColor Yellow }

# ---------------------------------------------------------------- 1. 占位符
Step "替换占位符 YOUR_GITHUB_NAME -> $User"
$targets = @(
  'README.md', 'CONTRIBUTING.md', 'package.json',
  'docs\release-notes-v1.0.0.md', '.github\ISSUE_TEMPLATE\config.yml'
)
$utf8 = New-Object System.Text.UTF8Encoding($false)
$changed = 0
foreach ($f in $targets) {
  $p = Join-Path $root $f
  if (-not (Test-Path $p)) { Warn "skip (missing): $f"; continue }
  $text = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
  if ($text -notmatch 'YOUR_GITHUB_NAME') { continue }
  $text = $text -replace 'YOUR_GITHUB_NAME', $User
  [IO.File]::WriteAllText($p, $text, $utf8)
  $changed++
  Ok $f
}
if ($changed -eq 0) { Warn '没有需要替换的文件（可能已经替换过）' }

# ---------------------------------------------------------------- 2. 本地检查
Step '本地检查'
$dirty = (RunGit status --porcelain)
if ($dirty) {
  RunGit add -A
  RunGit -c "user.name=$User" -c "user.email=$User@users.noreply.github.com" commit -m "chore: 发布前替换仓库地址占位符" | Out-Null
  Ok '已提交占位符替换'
} else {
  Ok '工作区干净'
}
$branch = (RunGit rev-parse --abbrev-ref HEAD).Trim()
Ok "当前分支：$branch"

if ($DryRun) {
  Write-Host ""
  Write-Host "[DryRun] 到此为止。去掉 -DryRun 即会建仓并推送。" -ForegroundColor Yellow
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Token)) {
  throw '缺少 -Token（或设置环境变量 GITHUB_TOKEN）。请在 https://github.com/settings/tokens 生成 repo 权限的令牌。'
}

$headers = @{
  Authorization = "token $Token"
  'User-Agent'  = 'pdf-reader-publish'
  Accept        = 'application/vnd.github+json'
}
$api = 'https://api.github.com'

# ---------------------------------------------------------------- 3. 建仓
Step "创建仓库 $User/$Repo"
$repoBody = @{
  name        = $Repo
  description = $Description
  private     = $false
  has_issues  = $true
  has_wiki    = $false
  auto_init   = $false
} | ConvertTo-Json
try {
  $repoInfo = Invoke-RestMethod -Method Post -Uri "$api/user/repos" -Headers $headers `
    -Body ([Text.Encoding]::UTF8.GetBytes($repoBody)) -ContentType 'application/json; charset=utf-8'
  Ok "已创建：$($repoInfo.html_url)"
} catch {
  if ($_.Exception.Message -match '422|already exists') {
    Warn "仓库已存在，继续使用 $User/$Repo"
  } else {
    throw
  }
}

Step '设置 Topics'
try {
  Invoke-RestMethod -Method Put -Uri "$api/repos/$User/$Repo/topics" -Headers $headers `
    -Body ([Text.Encoding]::UTF8.GetBytes((@{ names = $Topics } | ConvertTo-Json))) `
    -ContentType 'application/json; charset=utf-8' | Out-Null
  Ok "$($Topics.Count) 个 topics 已设置"
} catch {
  Warn "设置 topics 失败（可稍后在网页补）：$($_.Exception.Message)"
}

# ---------------------------------------------------------------- 4. 推送
Step '推送代码'
$remoteUrl = "https://$User`:$Token@github.com/$User/$Repo.git"
$remotes = (RunGit remote) -split "`n" | ForEach-Object { $_.Trim() }
if ($remotes -contains 'origin') { RunGit remote set-url origin $remoteUrl } else { RunGit remote add origin $remoteUrl }
RunGit push -u origin $branch 2>&1 | ForEach-Object { "   $_" }
if ($LASTEXITCODE -ne 0) { throw '推送失败，请检查令牌权限（需要 repo 权限）' }
Ok "已推送 $branch"

Step "打 tag v$Version"
RunGit tag -a "v$Version" -m "v$Version 首个公开版本" 2>$null
RunGit push origin "v$Version" 2>&1 | ForEach-Object { "   $_" }
Ok "tag v$Version 已推送"

# 把带 token 的 remote 换回干净地址
RunGit remote set-url origin "https://github.com/$User/$Repo.git"

# ---------------------------------------------------------------- 5. Release
Step "创建 Release v$Version"
$notesPath = Join-Path $root 'docs\release-notes-v1.0.0.md'
$notes = [IO.File]::ReadAllText($notesPath, [Text.Encoding]::UTF8)
$relBody = @{
  tag_name = "v$Version"
  name     = "v$Version —— 界面纯净，功能丰富"
  body     = $notes
  draft    = $false
} | ConvertTo-Json -Depth 3
$rel = Invoke-RestMethod -Method Post -Uri "$api/repos/$User/$Repo/releases" -Headers $headers `
  -Body ([Text.Encoding]::UTF8.GetBytes($relBody)) -ContentType 'application/json; charset=utf-8'
Ok "Release：$($rel.html_url)"

# ---------------------------------------------------------------- 6. 上传安装包
$installerPath = Join-Path $root $Installer
if (Test-Path $installerPath) {
  Step "上传安装包 $(Split-Path $installerPath -Leaf)（约 150 MB，稍等）"
  $assetName = Split-Path $installerPath -Leaf
  $uploadHeaders = $headers.Clone()
  $uploadHeaders['Content-Type'] = 'application/octet-stream'
  Invoke-RestMethod -Method Post `
    -Uri "https://uploads.github.com/repos/$User/$Repo/releases/$($rel.id)/assets?name=$assetName" `
    -Headers $uploadHeaders -InFile $installerPath -TimeoutSec 1800 | Out-Null
  Ok '安装包已作为 Release 附件上传'
} else {
  Warn "未找到 $Installer，跳过附件上传（可稍后手动拖到 Release 页面）"
}

Write-Host ""
Write-Host "完成 -> https://github.com/$User/$Repo" -ForegroundColor Green
Write-Host "别忘了在 https://github.com/settings/tokens 撤销刚才用的令牌。" -ForegroundColor Yellow
