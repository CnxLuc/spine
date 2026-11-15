# Connects Spine to your Claude plan on Windows, through Claude Code on this
# computer, so Spine reads on your Claude Pro or Max plan with nothing extra to
# pay. It connects Codex too, if you have it. In PowerShell:
#
#   irm https://cnxluc.github.io/spine/connect.ps1 | iex
#
# To remove it:
#
#   $env:SPINE_UNINSTALL = 1; irm https://cnxluc.github.io/spine/connect.ps1 | iex
#
# 1. If Claude Code isn't installed, it offers to install it with Anthropic's
#    own installer (claude.ai/install.ps1).
# 2. If Claude Code isn't signed in, it runs Anthropic's own sign-in
#    (claude auth login), which opens your browser.
# 3. It adds Spine's connector: a small program that Windows' own C# compiler
#    builds here from its source, which your browser starts when Spine asks for
#    a reading, and only Spine may start. It runs your own Claude Code
#    (claude -p) or Codex (codex exec), signed in as you. Spine never sees your
#    sign-in, and nothing runs in the background.

function Connect-Spine {
  # Windows PowerShell turns any line a program prints as an error into a
  # failure under 'Stop', so each step checks for itself instead.
  $ErrorActionPreference = 'Continue'
  $Name = 'com.spine.local'
  # Spine's extension ids: the downloaded version, then the Chrome Web Store one.
  $Ids = @(__SPINE_EXTENSION_IDS_PS__)
  if ($env:SPINE_EXTENSION_IDS) { $Ids += $env:SPINE_EXTENSION_IDS -split ',' }
  $Installer = if ($env:SPINE_CLAUDE_INSTALLER) { $env:SPINE_CLAUDE_INSTALLER } else { 'https://claude.ai/install.ps1' }
  $Folder = Join-Path $env:LOCALAPPDATA 'Spine'
  # Where each browser looks for connectors. Chrome's channels share one.
  $Browsers = [ordered]@{
    'Chrome'   = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts'
    'Edge'     = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts'
    'Brave'    = 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts'
    'Vivaldi'  = 'HKCU:\Software\Vivaldi\NativeMessagingHosts'
    'Chromium' = 'HKCU:\Software\Chromium\NativeMessagingHosts'
  }
  $Installed = @{
    'Chrome'   = @("$env:LOCALAPPDATA\Google\Chrome", "$env:ProgramFiles\Google\Chrome", "${env:ProgramFiles(x86)}\Google\Chrome")
    'Edge'     = @("$env:LOCALAPPDATA\Microsoft\Edge", "${env:ProgramFiles(x86)}\Microsoft\Edge", "$env:ProgramFiles\Microsoft\Edge")
    'Brave'    = @("$env:LOCALAPPDATA\BraveSoftware\Brave-Browser", "$env:ProgramFiles\BraveSoftware\Brave-Browser")
    'Vivaldi'  = @("$env:LOCALAPPDATA\Vivaldi")
    'Chromium' = @("$env:LOCALAPPDATA\Chromium")
  }

  if ($env:SPINE_UNINSTALL) {
    foreach ($key in $Browsers.Values) { Remove-Item -Path "$key\$Name" -Force -ErrorAction SilentlyContinue }
    Remove-Item -Path $Folder -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removed Spine's connection to Claude Code and Codex. Claude Code itself stays installed."
    return
  }

  $interactive = [Environment]::UserInteractive -and -not $env:SPINE_YES -and -not $env:CI
  function Ask($question) {
    if ($env:SPINE_YES) { return $true }
    if (-not $interactive) { return $false }
    $answer = Read-Host "$question [Y/n]"
    return ($answer -eq '' -or $answer -match '^(y|yes)$')
  }
  function Find-Tool($tool) {
    foreach ($place in @("$env:USERPROFILE\.local\bin\$tool.exe", "$env:LOCALAPPDATA\Programs\$tool\$tool.exe")) {
      if (Test-Path -LiteralPath $place -PathType Leaf) { return $place }
    }
    $found = Get-Command "$tool.exe" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.Source }
    return $null
  }
  function Test-SignedIn($claude) {
    if (-not $claude) { return $false }
    $said = (& $claude auth status 2>$null | Out-String)
    return ($said -match '"loggedIn":\s*true')
  }

  Write-Host 'Connecting Spine to your Claude plan' -ForegroundColor White
  $claude = Find-Tool 'claude'
  $codex = Find-Tool 'codex'

  if (-not $claude) {
    Write-Host "Spine reads through Claude Code, Anthropic's app for your Claude Pro or Max plan. It isn't on this computer yet."
    if (Ask 'Install Claude Code now?') {
      Write-Host "`nInstalling Claude Code, with Anthropic's installer" -ForegroundColor White
      try {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm '$Installer' | iex"
      } catch {
        Write-Host "Claude Code didn't install. You can try again later with: irm https://claude.ai/install.ps1 | iex"
      }
      $claude = Find-Tool 'claude'
    } elseif (-not $interactive) {
      Write-Host 'To install it, run: irm https://claude.ai/install.ps1 | iex'
    }
  }

  if ($claude -and -not (Test-SignedIn $claude)) {
    if ($interactive -or $env:SPINE_YES) {
      Write-Host "`nSigning in to Claude" -ForegroundColor White
      Write-Host 'Your browser opens Claude''s sign-in. Sign in with the account that has your Pro or Max plan, then come back here.'
      try { & $claude auth login } catch { }
    } else {
      Write-Host "Claude Code isn't signed in. Run this command again in PowerShell to sign in."
    }
  }

  Write-Host "`nConnecting Spine" -ForegroundColor White
  New-Item -ItemType Directory -Force -Path (Join-Path $Folder 'work') | Out-Null
  $source = Join-Path $Folder 'SpineHost.cs'
  $program = Join-Path $Folder 'spine-host.exe'
  [IO.File]::WriteAllText($source, @'
__SPINE_HOST_CS__
'@, (New-Object Text.UTF8Encoding $false))
  # Windows' own C# compiler, from the .NET Framework that comes with Windows.
  $csc = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $csc) { throw "Spine: Windows' C# compiler wasn't found. Is the .NET Framework 4 turned on in Windows Features?" }
  Remove-Item -LiteralPath $program -Force -ErrorAction SilentlyContinue
  $built = & $csc /nologo /optimize+ /target:exe "/out:$program" $source 2>&1
  if (-not (Test-Path -LiteralPath $program)) { throw "Spine: the connector didn't build.`n$built" }

  $record = @()
  if ($claude) { $record += "CLAUDE_BIN=$claude" }
  if ($codex) { $record += "CODEX_BIN=$codex" }
  [IO.File]::WriteAllLines((Join-Path $Folder 'spine-host.cfg'), [string[]]$record, (New-Object Text.UTF8Encoding $false))

  $manifest = Join-Path $Folder "$Name.json"
  $origins = ($Ids | ForEach-Object { "`"chrome-extension://$_/`"" }) -join ', '
  $json = "{`n  `"name`": `"$Name`",`n  `"description`": `"Spine: read with Claude Code or Codex on this computer`",`n  `"path`": $(ConvertTo-Json $program),`n  `"type`": `"stdio`",`n  `"allowed_origins`": [$origins]`n}"
  [IO.File]::WriteAllText($manifest, $json, (New-Object Text.UTF8Encoding $false))

  $connected = @()
  foreach ($browser in $Browsers.Keys) {
    $here = $Installed[$browser] | Where-Object { Test-Path -LiteralPath $_ }
    if (-not $here -and $browser -ne 'Chrome') { continue }
    $key = "$($Browsers[$browser])\$Name"
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $manifest
    if ($here) { $connected += $browser }
  }
  if (-not $connected) { $connected = @('Chrome') }

  $ready = @()
  if ($claude -and (Test-SignedIn $claude)) { $ready += "Claude Code $(((& $claude --version 2>$null) | Select-Object -First 1) -replace ' .*$', '')" }
  if ($codex) {
    & $codex login status *> $null
    if ($LASTEXITCODE -eq 0) { $ready += "Codex $(((& $codex --version 2>$null) | Select-Object -First 1) -replace '^.* ', '')" }
  }
  $browsers = $connected -join ', '
  if ($ready) {
    Write-Host "Spine is connected to $($ready -join ' and ') in $browsers."
    Write-Host ''
    Write-Host 'Go back to Spine: it starts reading by itself.' -ForegroundColor White
    Write-Host 'On another article, press Alt+Shift+S to open Spine.'
  } else {
    Write-Host "Spine's connector is installed in $browsers, but Claude Code isn't ready yet."
    Write-Host 'Run this command again to install Claude Code or sign in.'
  }
}

Connect-Spine
