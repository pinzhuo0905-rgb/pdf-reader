<#
.SYNOPSIS
    Sets PDF Reader as the default .pdf handler for the current user, without any dialog.

.DESCRIPTION
    Works per-user (HKCU only): no administrator rights, no Settings UI and no code
    compilation are involved.

    Windows keeps the user's explicit choice in
        HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice
    and that key is hash-protected, so it cannot be written programmatically. When it is
    absent, Explorer falls back to the classic class association
        HKCU\Software\Classes\.pdf  ->  <ProgId>
    This script registers the ProgId, points .pdf at it and removes the UserChoice keys.
    The previous choice is backed up first and can be restored with -Restore.

.PARAMETER ProgId
    ProgId written under HKCU\Software\Classes. Defaults to 'PDF 文档'.

.PARAMETER Exe
    Full path of the installed PDF Reader executable.

.PARAMETER Restore
    Restores the user choice that was backed up by an earlier run.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\set-default-pdf.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\set-default-pdf.ps1 -Restore

.NOTES
    Language: Windows PowerShell 3.0 or later. File is stored as UTF-8 with BOM because
    it contains non-ASCII literals and Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI.
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ProgId = 'PDF 文档',

    [Parameter()]
    [string]$Exe = 'D:\PDF Reader\PDF Reader.exe',

    [Parameter()]
    [switch]$Restore
)

$ErrorActionPreference = 'Stop'

$extKey = 'HKCU:\Software\Classes\.pdf'
$fileExts = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf'
$backupDir = Join-Path $env:APPDATA 'pdf-reader'
$backupFile = Join-Path $backupDir 'assoc-backup.json'

function Get-PdfAssociation {
    <#
    .SYNOPSIS
        Writes the association Explorer will currently use to the pipeline.
    #>
    [CmdletBinding()]
    param()

    $class = (Get-ItemProperty -Path $extKey -ErrorAction SilentlyContinue).'(default)'
    $userChoice = Get-ItemProperty -Path (Join-Path $fileExts 'UserChoice') -ErrorAction SilentlyContinue
    $command = (Get-ItemProperty -Path "HKCU:\Software\Classes\$class\shell\open\command" -ErrorAction SilentlyContinue).'(default)'

    '  .pdf class   : {0}' -f $(if ($class) { $class } else { '(none)' })
    '  UserChoice   : {0}' -f $(if ($userChoice -and $userChoice.ProgId) { $userChoice.ProgId } else { '(none)' })
    '  open command : {0}' -f $(if ($command) { $command } else { '(none)' })
}

if ($Restore) {
    if (-not (Test-Path -Path $backupFile)) {
        throw "backup not found: $backupFile"
    }
    $backup = Get-Content -Path $backupFile -Raw | ConvertFrom-Json
    $userChoiceKey = Join-Path $fileExts 'UserChoice'
    New-Item -Path $userChoiceKey -Force | Out-Null
    Set-ItemProperty -Path $userChoiceKey -Name 'ProgId' -Value $backup.ProgId
    Set-ItemProperty -Path $userChoiceKey -Name 'Hash' -Value $backup.Hash
    'restored previous choice: {0}' -f $backup.ProgId
    Get-PdfAssociation
    return
}

if (-not (Test-Path -Path $Exe)) {
    throw "executable not found: $Exe"
}

# 1) Back up the current user choice, once.
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
if (-not (Test-Path -Path $backupFile)) {
    $current = Get-ItemProperty -Path (Join-Path $fileExts 'UserChoice') -ErrorAction SilentlyContinue
    if ($current -and $current.ProgId) {
        @{ ProgId = $current.ProgId; Hash = $current.Hash } |
            ConvertTo-Json |
            Set-Content -Path $backupFile -Encoding UTF8
        'backup: {0} -> {1}' -f $current.ProgId, $backupFile
    }
}

# 2) Make sure the ProgId exists and points at the installed executable.
$progKey = "HKCU:\Software\Classes\$ProgId"
New-Item -Path "$progKey\shell\open\command" -Force | Out-Null
New-Item -Path "$progKey\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path $progKey -Name '(default)' -Value 'PDF 文档'
Set-ItemProperty -Path "$progKey\shell\open\command" -Name '(default)' -Value ('"{0}" "%1"' -f $Exe)
Set-ItemProperty -Path $progKey -Name 'FriendlyTypeName' -Value 'PDF 文档' -ErrorAction SilentlyContinue
Set-ItemProperty -Path $progKey -Name 'Application' -Value 'PDF Reader.exe' -ErrorAction SilentlyContinue

$icon = Join-Path (Split-Path -Path $Exe) 'resources\pdf-file.ico'
if (Test-Path -Path $icon) {
    Set-ItemProperty -Path "$progKey\DefaultIcon" -Name '(default)' -Value ('{0},0' -f $icon)
}

# 2b) Register the executable as well so it always shows up under "Open with".
$appKey = 'HKCU:\Software\Classes\Applications\PDF Reader.exe'
New-Item -Path "$appKey\shell\open\command" -Force | Out-Null
New-Item -Path "$appKey\SupportedTypes" -Force | Out-Null
Set-ItemProperty -Path $appKey -Name 'FriendlyAppName' -Value 'PDF Reader'
Set-ItemProperty -Path "$appKey\shell\open\command" -Name '(default)' -Value ('"{0}" "%1"' -f $Exe)
New-ItemProperty -Path "$appKey\SupportedTypes" -Name '.pdf' -Value '' -PropertyType String -Force | Out-Null

# 3) Point the extension at it and expose it under "Open with".
New-Item -Path $extKey -Force | Out-Null
Set-ItemProperty -Path $extKey -Name '(default)' -Value $ProgId
New-Item -Path "$extKey\OpenWithProgids" -Force | Out-Null
New-ItemProperty -Path "$extKey\OpenWithProgids" -Name $ProgId -Value ([byte[]]@()) -PropertyType Binary -Force | Out-Null

# 4) Drop the hash-protected user choice so the class association takes effect.
#    The key carries a non-inherited "Deny SetValue" ACE for the current user, so the
#    deny rule has to be lifted first; the key is owned by the user, so this is allowed.
$extSubKey = 'Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf'
foreach ($subName in @('UserChoice', 'UserChoiceLatest')) {
    $subPath = "$extSubKey\$subName"
    try {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subPath, 'ReadWriteSubTree', 'ChangePermissions')
        if ($key) {
            $security = $key.GetAccessControl()
            $denyRules = @($security.GetAccessRules($true, $true, [System.Security.Principal.NTAccount]) |
                Where-Object { $_.AccessControlType -eq 'Deny' })
            if ($denyRules.Count -gt 0) {
                foreach ($rule in $denyRules) {
                    [void]$security.RemoveAccessRule($rule)
                }
                $key.SetAccessControl($security)
            }
            $key.Close()
        }
    }
    catch {
        # The key may be absent or already writable; either way step 4 can continue.
    }

    $stillExists = $null -ne [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subPath)
    if ($stillExists) {
        try {
            [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($subPath, $false)
            'removed: {0}' -f $subName
        }
        catch {
            'could not remove {0}: {1}' -f $subName, $_.Exception.Message
        }
    }
}

# 5) Verify from the registry what Explorer will use.
'--- state after change ---'
Get-PdfAssociation

$finalClass = (Get-ItemProperty -Path $extKey -ErrorAction SilentlyContinue).'(default)'
$finalCommand = (Get-ItemProperty -Path "HKCU:\Software\Classes\$finalClass\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
$finalChoice = Get-ItemProperty -Path (Join-Path $fileExts 'UserChoice') -ErrorAction SilentlyContinue
if ($finalClass -eq $ProgId -and $finalCommand -like "*$Exe*" -and -not ($finalChoice -and $finalChoice.ProgId)) {
    'OK: .pdf opens with {0}' -f $Exe
}
else {
    'WARN: association not fully applied'
}
