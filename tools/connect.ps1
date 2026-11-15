# Connects Spine to your Claude plan on Windows, through Claude Code on this
# computer, so Spine reads on your Claude Pro or Max plan with nothing extra to
# pay. It connects Codex too, if you have it. In PowerShell:
#
#   irm https://raw.githubusercontent.com/CnxLuc/spine/main/docs/connect.ps1 | iex
#
# To remove it:
#
#   $env:SPINE_UNINSTALL = 1; irm https://raw.githubusercontent.com/CnxLuc/spine/main/docs/connect.ps1 | iex
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
  # A folder no other app uses.
  $Folder = Join-Path $env:LOCALAPPDATA $Name
  # Chrome's key is the one every Chromium browser falls back to; Edge, Brave,
  # Vivaldi and Chromium also have their own.
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
    # Only for this run: the setting would otherwise stay on in this window.
    Remove-Item Env:SPINE_UNINSTALL -ErrorAction SilentlyContinue
    foreach ($key in $Browsers.Values) { Remove-Item -LiteralPath "$key\$Name" -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $Folder -Recurse -Force -ErrorAction SilentlyContinue
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
  # Claude Code's or Codex's own program. A copy installed with npm starts
  # through a .cmd file, which can't take Spine's instructions safely, so
  # Spine looks for the program inside the npm package instead.
  function Find-Tool($tool) {
    foreach ($place in @("$env:USERPROFILE\.local\bin\$tool.exe", "$env:LOCALAPPDATA\Programs\$tool\$tool.exe")) {
      if (Test-Path -LiteralPath $place -PathType Leaf) { return $place }
    }
    $found = Get-Command "$tool.exe" -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.Source }
    $package = @{ 'claude' = '@anthropic-ai'; 'codex' = '@openai' }[$tool]
    $npm = Join-Path $env:APPDATA "npm\node_modules\$package"
    if (Test-Path -LiteralPath $npm) {
      $inside = Get-ChildItem -LiteralPath $npm -Recurse -Filter "$tool.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($inside) { return $inside.FullName }
    }
    return $null
  }
  function Test-SignedIn($claude) {
    if (-not $claude) { return $false }
    $said = (& $claude auth status 2>$null | Out-String)
    return ($said -match '"loggedIn"\s*:\s*true')
  }
  function Join-Words($words) {
    $words = @($words)
    if ($words.Count -gt 1) { return ($words[0..($words.Count - 2)] -join ', ') + ' and ' + $words[-1] }
    return $words[0]
  }
  $utf8 = New-Object Text.UTF8Encoding $false

  Write-Host 'Connecting Spine to your Claude plan' -ForegroundColor White
  $claude = Find-Tool 'claude'
  $codex = Find-Tool 'codex'

  if (-not $claude) {
    Write-Host "Spine reads through Claude Code, Anthropic's app for your Claude Pro or Max plan. It isn't on this computer yet."
    if (Ask 'Install Claude Code now?') {
      Write-Host "`nInstalling Claude Code, with Anthropic's installer" -ForegroundColor White
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm '$Installer' | iex"
      $claude = Find-Tool 'claude'
      if (-not $claude) { Write-Host "Claude Code didn't install. You can try again later with: irm https://claude.ai/install.ps1 | iex" }
    } elseif (-not $interactive) {
      Write-Host 'To install it, run: irm https://claude.ai/install.ps1 | iex'
    }
  }

  if ($claude -and -not (Test-SignedIn $claude)) {
    if ($interactive -or $env:SPINE_YES) {
      Write-Host "`nSigning in to Claude" -ForegroundColor White
      Write-Host 'Your browser opens Claude''s sign-in. Sign in with the account that has your Pro or Max plan, then come back here.'
      & $claude auth login
    } else {
      Write-Host "Claude Code isn't signed in. Run this command again in PowerShell to sign in."
    }
  }

  Write-Host "`nConnecting Spine" -ForegroundColor White
  New-Item -ItemType Directory -Force -Path (Join-Path $Folder 'work') | Out-Null
  $source = Join-Path $Folder 'SpineHost.cs'
  $program = Join-Path $Folder 'spine-host.exe'
  $fresh = Join-Path $Folder 'spine-host.new.exe'
  [IO.File]::WriteAllText($source, @'
__SPINE_HOST_CS__
'@, $utf8)
  # Windows' own C# compiler, from the .NET Framework that comes with Windows.
  $csc = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $csc) {
    Write-Host "Spine: Windows' C# compiler wasn't found. Turn on .NET Framework 4.8 in Windows Features, then run this again." -ForegroundColor Red
    return
  }
  Remove-Item -LiteralPath $fresh -Force -ErrorAction SilentlyContinue
  $built = & $csc /nologo /optimize+ /target:exe "/out:$fresh" $source 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $fresh)) {
    Write-Host "Spine: the connector didn't build.`n$built" -ForegroundColor Red
    return
  }
  # Windows can't replace a program that's running, but it can rename it. A
  # connector the browser started a moment ago finishes as it was.
  Get-ChildItem -LiteralPath $Folder -Filter 'spine-host.old-*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $program) {
    Rename-Item -LiteralPath $program -NewName "spine-host.old-$([guid]::NewGuid().ToString('N')).exe" -ErrorAction SilentlyContinue
  }
  Move-Item -LiteralPath $fresh -Destination $program -Force

  $record = @()
  if ($claude) { $record += "CLAUDE_BIN=$claude" }
  if ($codex) { $record += "CODEX_BIN=$codex" }
  [IO.File]::WriteAllLines((Join-Path $Folder 'spine-host.cfg'), [string[]]$record, $utf8)

  # Ask the connector what it finds, the way the browser does. Windows' Smart
  # App Control can refuse to run a program built on this computer.
  $ping = Join-Path $Folder 'work\ping.in'
  $pong = Join-Path $Folder 'work\ping.out'
  $request = [Text.Encoding]::ASCII.GetBytes('"ping"')
  [IO.File]::WriteAllBytes($ping, [byte[]]([BitConverter]::GetBytes([int]$request.Length) + $request))
  $answer = ''
  try {
    $run = Start-Process -FilePath $program -RedirectStandardInput $ping -RedirectStandardOutput $pong -NoNewWindow -PassThru -ErrorAction Stop
    if ($run.WaitForExit(30000) -and (Test-Path -LiteralPath $pong)) { $answer = [IO.File]::ReadAllText($pong) }
  } catch {
    $answer = ''
  }
  Remove-Item -LiteralPath $ping, $pong -Force -ErrorAction SilentlyContinue
  if ($answer -notmatch '"type":"pong"') {
    Write-Host "`nWindows didn't let Spine's connector run. Smart App Control, in Windows Security, blocks programs built on this computer." -ForegroundColor Red
    Write-Host 'Spine can still read on your ChatGPT Plus or Pro plan: choose ChatGPT in Spine instead.'
    return
  }

  $manifest = Join-Path $Folder "$Name.json"
  $origins = ($Ids | ForEach-Object { "`"chrome-extension://$_/`"" }) -join ', '
  $json = "{`n  `"name`": `"$Name`",`n  `"description`": `"Spine: read with Claude Code or Codex on this computer`",`n  `"path`": $(ConvertTo-Json $program),`n  `"type`": `"stdio`",`n  `"allowed_origins`": [$origins]`n}"
  [IO.File]::WriteAllText($manifest, $json, $utf8)

  $connected = @()
  foreach ($browser in $Browsers.Keys) {
    $here = $Installed[$browser] | Where-Object { Test-Path -LiteralPath $_ }
    if (-not $here -and $browser -ne 'Chrome') { continue }
    $key = "$($Browsers[$browser])\$Name"
    New-Item -Path $key -Force | Out-Null
    Set-Item -LiteralPath $key -Value $manifest
    if ($here) { $connected += $browser }
  }
  if (-not $connected) { $connected = @('Chrome') }

  $ready = @()
  if ($claude -and (Test-SignedIn $claude)) { $ready += "Claude Code $(((& $claude --version 2>$null) | Select-Object -First 1) -replace ' .*$', '')" }
  if ($codex) {
    & $codex login status *> $null
    if ($LASTEXITCODE -eq 0) { $ready += "Codex $(((& $codex --version 2>$null) | Select-Object -First 1) -replace '^.* ', '')" }
  }
  $browsers = Join-Words $connected
  if ($ready) {
    Write-Host "Spine is connected to $(Join-Words $ready) in $browsers."
    Write-Host ''
    Write-Host 'Go back to Spine: it starts reading by itself.' -ForegroundColor White
    Write-Host 'On another article, press Alt+Shift+S to open Spine.'
  } else {
    Write-Host "Spine's connector is installed in $browsers, but Claude Code isn't ready yet."
    Write-Host 'Run this command again to install Claude Code or sign in.'
  }
}

Connect-Spine
