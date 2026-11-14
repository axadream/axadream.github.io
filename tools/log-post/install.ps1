# install.ps1 - installs the Claude Code skill `log-post` for the current user.
#
# What it does:
#   1. Copies this folder (the skill: SKILL.md, post.mjs, the schema copy and
#      README.md) to the user's Claude Code skills folder, %USERPROFILE%\.claude\skills\log-post.
#      The copy replaces any earlier install. install.ps1 is not part of the
#      skill, so it is removed from the copy.
#   2. Creates the config folder %USERPROFILE%\.alepax-log OUTSIDE any repository,
#      with a pending\ subfolder and two config files. Existing files are never
#      overwritten.
#
# Usage (from the repository root):
#   powershell -ExecutionPolicy Bypass -File tools/log-post/install.ps1
#
# The token is not stored by this script. Set ALEPAX_LOG_TOKEN in your shell
# before posting (see the README section on logging from Claude Code).

$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dst = Join-Path $HOME '.claude\skills\log-post'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
if (Test-Path -LiteralPath $dst) {
    Remove-Item -LiteralPath $dst -Recurse -Force
}
Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
$copiedInstaller = Join-Path $dst 'install.ps1'
if (Test-Path -LiteralPath $copiedInstaller) {
    Remove-Item -LiteralPath $copiedInstaller -Force
}

$cfg = Join-Path $HOME '.alepax-log'
New-Item -ItemType Directory -Force -Path $cfg | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $cfg 'pending') | Out-Null

$utf8 = New-Object System.Text.UTF8Encoding($false)

$allowed = Join-Path $cfg 'allowed-projects.txt'
if (-not (Test-Path -LiteralPath $allowed)) {
    $text = "# absolute project paths, one per line; post.mjs refuses to run from anywhere else`n"
    [System.IO.File]::WriteAllText($allowed, $text, $utf8)
}

$deny = Join-Path $cfg 'deny-terms.txt'
if (-not (Test-Path -LiteralPath $deny)) {
    $text = "# one term per line, case-insensitive; entries whose text or link contain a term are refused`n"
    [System.IO.File]::WriteAllText($deny, $text, $utf8)
}

Write-Output "Skill installed to: $dst"
Write-Output "Config folder:      $cfg"
Write-Output "Set ALEPAX_LOG_TOKEN in your shell before posting (see README)"
