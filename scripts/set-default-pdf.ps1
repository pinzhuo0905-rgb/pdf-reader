# Set PDF Reader as the default .pdf handler without any dialog.
# Works per-user (HKCU only), no admin required, no Settings UI, no code compilation.
#
#   powershell -ExecutionPolicy Bypass -File scripts\set-default-pdf.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\set-default-pdf.ps1 -Restore
#
# How it works:
#   Windows keeps the user's explicit choice in
#     HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice
#   and that key is hash-protected (cannot be written programmatically).
#   When it is absent, Explorer falls back to the classic class association
#     HKCU\Software\Classes\.pdf  ->  <ProgId>
#   so we register our ProgId, point .pdf at it, and drop the UserChoice keys.
#   The previous choice is backed up first and can be restored with -Restore.

param(
  [string]$ProgId = 'PDF 文档',
  [string]$Exe = 'D:\PDF Reader\PDF Reader.exe',
  [switch]$Restore
)

$ErrorActionPreference = 'Stop'
$extKey = 'HKCU:\Software\Classes\.pdf'
$fileExts = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf'
$backupDir = Join-Path $env:APPDATA 'pdf-reader'
$backupFile = Join-Path $backupDir 'assoc-backup.json'

function Show-State {
  $cls = (Get-ItemProperty $extKey -ErrorAction SilentlyContinue).'(default)'
  $uc = Get-ItemProperty (Join-Path $fileExts 'UserChoice') -ErrorAction SilentlyContinue
  $cmd = (Get-ItemProperty "HKCU:\Software\Classes\$cls\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
  "  .pdf class   : $cls"
  "  UserChoice   : " + $(if ($uc -and $uc.ProgId) { $uc.ProgId } else { '(none)' })
  "  open command : " + $(if ($cmd) { $cmd } else { '(none)' })
}

if ($Restore) {
  if (-not (Test-Path $backupFile)) { throw "backup not found: $backupFile" }
  $b = Get-Content $backupFile -Raw | ConvertFrom-Json
  $uc = Join-Path $fileExts 'UserChoice'
  New-Item -Path $uc -Force | Out-Null
  Set-ItemProperty -Path $uc -Name 'ProgId' -Value $b.ProgId
  Set-ItemProperty -Path $uc -Name 'Hash' -Value $b.Hash
  "restored previous choice: $($b.ProgId)"
  Show-State
  return
}

if (-not (Test-Path $Exe)) { throw "executable not found: $Exe" }

# 1) back up the current user choice (only the first time)
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
if (-not (Test-Path $backupFile)) {
  $uc = Get-ItemProperty (Join-Path $fileExts 'UserChoice') -ErrorAction SilentlyContinue
  if ($uc -and $uc.ProgId) {
    @{ ProgId = $uc.ProgId; Hash = $uc.Hash } | ConvertTo-Json | Set-Content -Path $backupFile -Encoding UTF8
    "backup: $($uc.ProgId) -> $backupFile"
  }
}

# 2) make sure our ProgId exists and points at the installed exe
$progKey = "HKCU:\Software\Classes\$ProgId"
New-Item -Path "$progKey\shell\open\command" -Force | Out-Null
New-Item -Path "$progKey\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path $progKey -Name '(default)' -Value 'PDF 文档'
Set-ItemProperty -Path "$progKey\shell\open\command" -Name '(default)' -Value ('"{0}" "%1"' -f $Exe)
$ico = Join-Path (Split-Path $Exe) 'resources\pdf-file.ico'
if (Test-Path $ico) { Set-ItemProperty -Path "$progKey\DefaultIcon" -Name '(default)' -Value ('{0},0' -f $ico) }
Set-ItemProperty -Path $progKey -Name 'FriendlyTypeName' -Value 'PDF 文档' -ErrorAction SilentlyContinue
Set-ItemProperty -Path $progKey -Name 'Application' -Value 'PDF Reader.exe' -ErrorAction SilentlyContinue

# 2b) also register the executable so it always shows up in "Open with"
$appKey = 'HKCU://Software//Classes//Applications//PDF Reader.exe'
New-Item -Path "$appKey\shell\open\command" -Force | Out-Null
New-Item -Path "$appKey\SupportedTypes" -Force | Out-Null
Set-ItemProperty -Path $appKey -Name 'FriendlyAppName' -Value 'PDF Reader'
Set-ItemProperty -Path "$appKey\shell\open\command" -Name '(default)' -Value ('"{0}" "%1"' -f $Exe)
New-ItemProperty -Path "$appKey\SupportedTypes" -Name '.pdf' -Value '' -PropertyType String -Force | Out-Null

# 3) point the extension at it and expose it in "Open with"
New-Item -Path $extKey -Force | Out-Null
Set-ItemProperty -Path $extKey -Name '(default)' -Value $ProgId
New-Item -Path "$extKey\OpenWithProgids" -Force | Out-Null
New-ItemProperty -Path "$extKey\OpenWithProgids" -Name $ProgId -Value ([byte[]]@()) -PropertyType Binary -Force | Out-Null

# 4) drop the hash-protected user choice so the class association takes effect
#    The key carries a non-inherited "Deny SetValue" ACE for the current user,
#    so the deny rule has to be lifted first (we own the key, so this is allowed).
$extSub = 'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf'
foreach ($sub in @('UserChoice', 'UserChoiceLatest')) {
  $subPath = "$extSub\$sub"
  try {
    $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subPath, 'ReadWriteSubTree', 'ChangePermissions')
    if ($k) {
      $sec = $k.GetAccessControl()
      $denies = @($sec.GetAccessRules($true, $true, [System.Security.Principal.NTAccount]) | Where-Object { $_.AccessControlType -eq 'Deny' })
      if ($denies.Count) {
        foreach ($r in $denies) { [void]$sec.RemoveAccessRule($r) }
        $k.SetAccessControl($sec)
      }
      $k.Close()
    }
  } catch { }
  $exists = $null -ne [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subPath)
  if ($exists) {
    try {
      [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($subPath, $false)
      "removed: $sub"
    } catch { "could not remove ${sub}: $($_.Exception.Message)" }
  }
}

# 5) verify from the registry what Explorer will use
"--- state after change ---"
Show-State
$cls = (Get-ItemProperty $extKey -ErrorAction SilentlyContinue).'(default)'
$cmd = (Get-ItemProperty "HKCU:\Software\Classes\$cls\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
$uc = Get-ItemProperty (Join-Path $fileExts 'UserChoice') -ErrorAction SilentlyContinue
if ($cls -eq $ProgId -and $cmd -like "*$Exe*" -and -not ($uc -and $uc.ProgId)) {
  "OK: .pdf opens with $Exe"
} else {
  "WARN: association not fully applied"
}
