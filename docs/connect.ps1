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
  $Ids = @('hbaekihlobpbmhciebgibgeljinadcib')
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
// Spine's connector for Windows: native/spine-host.sh in C# 5, so that
// Windows' own C# compiler, which comes with the .NET Framework on every
// Windows 10 and 11 computer, builds it on the reader's computer from this
// file. Nothing compiled elsewhere is downloaded.
//
// It lets the Spine extension ask Claude Code or Codex on this computer to
// read an article, so the reading runs on the reader's own plan. The browser
// starts it when Spine asks for a reading, and only Spine can. It runs the
// reader's own, unmodified claude.exe or codex.exe, passes the article
// straight to it, passes on each JSON line it prints, and exits. It never
// reads or stores anyone's sign-in. The protocol is described in
// native/spine-host.sh.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

static class SpineHost
{
    const int Version = 3;
    const int MaxMessage = 1000000;
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
    static readonly object Writing = new object();
    static Stream output;
    static string folder;
    static Process child;

    static int Main(string[] args)
    {
        folder = AppDomain.CurrentDomain.BaseDirectory;
        try
        {
            // The .NET Framework writes the console encoding's byte order mark
            // into a tool's input before the article, if the console uses
            // UTF-8. This encoding has no mark, and setting it leaves the
            // console alone. The article itself goes in as raw bytes.
            Console.InputEncoding = new UnicodeEncoding(false, false);
        }
        catch (Exception)
        {
        }
        Stream input = Console.OpenStandardInput();
        output = Console.OpenStandardOutput();
        try
        {
            byte[] header = ReadExactly(input, 4);
            if (header == null) return 0;
            int size = BitConverter.ToInt32(header, 0);
            if (size <= 0) return 0;
            byte[] body = ReadExactly(input, size);
            if (body == null) return 0;
            string request = Encoding.ASCII.GetString(body);
            if (request == "{\"type\":\"ping\"}")
            {
                // Spine 1.2 and earlier spoke JSON to a connector written in
                // Python. Answer its ping the way it understands, so it tries a
                // reading and hears that it needs updating.
                Send("{\"type\":\"pong\",\"host\":\"2\",\"claude\":{\"path\":\"\",\"version\":\"Spine needs updating\",\"signedIn\":true,\"plan\":\"\"},\"codex\":null}");
                return 0;
            }
            if (request.StartsWith("{"))
            {
                Send("{\"type\":\"error\",\"code\":\"update\",\"message\":\"Spine needs updating to use this connector. Download the latest Spine from cnxluc.github.io/spine.\"}");
                return 0;
            }
            string[] fields = request.Trim('"').Split('.');
            if (fields[0] == "ping")
            {
                Send("{\"type\":\"pong\",\"host\":" + Version + ",\"claude\":" + Describe("claude") + ",\"codex\":" + Describe("codex") + "}");
            }
            else if (fields[0] == "run")
            {
                Run(fields, input);
            }
            else
            {
                Refuse("request", "Unknown request.");
            }
        }
        catch (Exception error)
        {
            Refuse("host", error.Message);
        }
        return 0;
    }

    /* Messages */

    static byte[] ReadExactly(Stream stream, int count)
    {
        byte[] buffer = new byte[count];
        int read = 0;
        while (read < count)
        {
            int got = stream.Read(buffer, read, count - read);
            if (got <= 0) return null;
            read += got;
        }
        return buffer;
    }

    // One message: a JSON value on one line, after its length in native byte
    // order, which on Windows is little-endian.
    static void Send(string json)
    {
        byte[] bytes = Utf8.GetBytes(json);
        lock (Writing)
        {
            try
            {
                output.Write(BitConverter.GetBytes(bytes.Length), 0, 4);
                output.Write(bytes, 0, bytes.Length);
                output.Flush();
            }
            catch (IOException)
            {
                // The browser stopped listening.
            }
        }
    }

    static void Refuse(string code, string message)
    {
        Send("{\"type\":\"refused\",\"code\":\"" + code + "\",\"message\":\"" + Escape(message) + "\"}");
    }

    static string Escape(string text)
    {
        StringBuilder escaped = new StringBuilder();
        foreach (char c in text ?? "")
        {
            if (c == '"' || c == '\\') escaped.Append('\\').Append(c);
            else if (c < ' ') escaped.Append("\\u").Append(((int)c).ToString("x4"));
            else escaped.Append(c);
        }
        return escaped.ToString();
    }

    static string Base64(string text)
    {
        return Convert.ToBase64String(Utf8.GetBytes(text ?? ""));
    }

    // A request field: base64url in, the bytes it stands for out.
    static byte[] FieldBytes(string text)
    {
        string padded = text.Replace('-', '+').Replace('_', '/');
        if (padded.Length % 4 == 2) padded += "==";
        else if (padded.Length % 4 == 3) padded += "=";
        return padded.Length == 0 ? new byte[0] : Convert.FromBase64String(padded);
    }

    static string Field(string[] fields, int index)
    {
        return index < fields.Length ? Utf8.GetString(FieldBytes(fields[index])) : "";
    }

    /* Finding Claude Code and Codex */

    // The path the installer recorded, from spine-host.cfg beside this program
    // or the environment, else the first in the usual places.
    static string Find(string name)
    {
        string key = name.ToUpperInvariant() + "_BIN";
        string given = Environment.GetEnvironmentVariable(key);
        if (string.IsNullOrEmpty(given)) given = Recorded(key);
        if (!string.IsNullOrEmpty(given) && File.Exists(given)) return given;
        List<string> places = new List<string>();
        places.AddRange((Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'));
        string search = Environment.GetEnvironmentVariable("SPINE_SEARCH");
        if (search != null)
        {
            places.AddRange(search.Split(';'));
        }
        else
        {
            string home = Environment.GetEnvironmentVariable("USERPROFILE") ?? "";
            string local = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "";
            places.Add(Path.Combine(home, ".local\\bin"));
            places.Add(Path.Combine(local, "Programs\\claude"));
            places.Add(Path.Combine(local, "Programs\\codex"));
        }
        foreach (string place in places)
        {
            string dir = place.Trim().Trim('"');
            if (dir.Length == 0) continue;
            try
            {
                string candidate = Path.Combine(dir, name + ".exe");
                if (File.Exists(candidate)) return candidate;
            }
            catch (ArgumentException)
            {
                // A malformed folder on the PATH.
            }
        }
        return null;
    }

    static string Recorded(string key)
    {
        string file = Path.Combine(folder, "spine-host.cfg");
        if (!File.Exists(file)) return null;
        foreach (string line in File.ReadAllLines(file, Utf8))
        {
            if (line.StartsWith(key + "=")) return line.Substring(key.Length + 1).Trim();
        }
        return null;
    }

    static string Describe(string name)
    {
        string bin = Find(name);
        if (bin == null) return "null";
        int code;
        string version = Quietly(bin, new string[] { "--version" }, out code);
        string status = name == "claude"
            ? Quietly(bin, new string[] { "auth", "status" }, out code)
            : Quietly(bin, new string[] { "login", "status" }, out code);
        return "{\"path\":\"" + Base64(bin) + "\",\"version\":\"" + Base64(version) + "\",\"status\":\"" + Base64(status) +
               "\",\"code\":" + code + "}";
    }

    /* Running them */

    // Windows passes a program one command line; this quotes each argument so
    // the program reads back exactly the argument given.
    static string Quote(string argument)
    {
        if (argument.Length > 0 && argument.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0) return argument;
        StringBuilder quoted = new StringBuilder("\"");
        for (int i = 0; ; i++)
        {
            int slashes = 0;
            while (i < argument.Length && argument[i] == '\\')
            {
                slashes++;
                i++;
            }
            if (i == argument.Length)
            {
                quoted.Append('\\', slashes * 2);
                break;
            }
            if (argument[i] == '"') quoted.Append('\\', slashes * 2 + 1).Append('"');
            else quoted.Append('\\', slashes).Append(argument[i]);
        }
        return quoted.Append('"').ToString();
    }

    static Process Start(string bin, List<string> arguments, string work)
    {
        List<string> quoted = new List<string>();
        foreach (string argument in arguments) quoted.Add(Quote(argument));
        ProcessStartInfo info = new ProcessStartInfo(bin, string.Join(" ", quoted.ToArray()));
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.StandardOutputEncoding = Utf8;
        info.StandardErrorEncoding = Utf8;
        info.WorkingDirectory = work;
        info.EnvironmentVariables["PATH"] = Path.GetDirectoryName(bin) + ";" + (Environment.GetEnvironmentVariable("PATH") ?? "");
        return Process.Start(info);
    }

    static string WorkFolder()
    {
        string work = Path.Combine(folder, "work");
        Directory.CreateDirectory(work);
        return work;
    }

    // Runs a short command with no input, for at most 15 seconds. Returns
    // what it printed, its output before its errors, so a warning can't land
    // in the middle of its JSON.
    static string Quietly(string bin, string[] arguments, out int code)
    {
        StringBuilder said = new StringBuilder();
        StringBuilder warned = new StringBuilder();
        ManualResetEvent saidAll = new ManualResetEvent(false);
        ManualResetEvent warnedAll = new ManualResetEvent(false);
        Process process;
        try
        {
            process = Start(bin, new List<string>(arguments), WorkFolder());
        }
        catch (Exception error)
        {
            code = 1;
            return error.Message;
        }
        process.OutputDataReceived += delegate (object sender, DataReceivedEventArgs line)
        {
            if (line.Data == null)
            {
                saidAll.Set();
                return;
            }
            lock (said)
            {
                if (said.Length < 4000) said.AppendLine(line.Data);
            }
        };
        process.ErrorDataReceived += delegate (object sender, DataReceivedEventArgs line)
        {
            if (line.Data == null)
            {
                warnedAll.Set();
                return;
            }
            lock (warned)
            {
                if (warned.Length < 4000) warned.AppendLine(line.Data);
            }
        };
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        process.StandardInput.Close();
        if (process.WaitForExit(15000))
        {
            code = process.ExitCode;
        }
        else
        {
            Stop(process);
            code = 1;
        }
        // Anything the tool started can keep its output open; don't wait on
        // that for long.
        saidAll.WaitOne(2000);
        warnedAll.WaitOne(2000);
        lock (said)
        {
            lock (warned)
            {
                return said.ToString() + warned.ToString();
            }
        }
    }

    // Stops a tool and anything it started.
    static void Stop(Process process)
    {
        try
        {
            if (process == null || process.HasExited) return;
            ProcessStartInfo info = new ProcessStartInfo("taskkill", "/T /F /PID " + process.Id);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            Process.Start(info).WaitForExit(5000);
        }
        catch (Exception)
        {
            try
            {
                process.Kill();
            }
            catch (Exception)
            {
            }
        }
    }

    static bool Plain(string text)
    {
        foreach (char c in text)
        {
            if (!(char.IsLetterOrDigit(c) && c < 128) && c != '.' && c != '_' && c != ':' && c != '-') return false;
        }
        return true;
    }

    static void Run(string[] fields, Stream input)
    {
        string engine = Field(fields, 1);
        string model = Field(fields, 2);
        string effort = Field(fields, 3);
        if (engine != "claude" && engine != "codex")
        {
            Refuse("request", "Unknown engine.");
            return;
        }
        if (!Plain(model))
        {
            Refuse("request", "Unknown model.");
            return;
        }
        if (effort.Length == 0) effort = "medium";
        if (Array.IndexOf(new string[] { "low", "medium", "high", "xhigh", "max" }, effort) < 0)
        {
            Refuse("request", "Unknown effort.");
            return;
        }
        string bin = Find(engine);
        if (bin == null)
        {
            Send("{\"type\":\"exit\",\"code\":127,\"missing\":true,\"stderr\":\"\"}");
            return;
        }
        string system = Field(fields, 4);
        string schema = Field(fields, 5);
        byte[] article = fields.Length > 6 ? FieldBytes(fields[6]) : new byte[0];
        string work = WorkFolder();
        string schemaFile = null;
        List<string> arguments = new List<string>();
        if (engine == "claude")
        {
            arguments.AddRange(new string[] {
                "-p", "--model", model.Length > 0 ? model : "claude-opus-5-5",
                "--output-format", "stream-json", "--include-partial-messages", "--verbose",
                "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands",
                "--no-session-persistence", "--effort", effort });
            if (system.Length > 0) arguments.AddRange(new string[] { "--system-prompt", system });
            if (schema.Length > 0) arguments.AddRange(new string[] { "--json-schema", schema });
        }
        else
        {
            // The reader's own Codex settings are for coding; Spine wants their
            // plan's default model and nothing else.
            // Codex's read-only sandbox still lets it run commands that read
            // any file, and an article could ask it to. Without its shell, it
            // can't.
            arguments.AddRange(new string[] {
                "exec", "--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules",
                "--sandbox", "read-only", "-c", "features.shell_tool=false",
                "-c", "model_reasoning_effort=\"" + effort + "\"", "-C", work });
            if (schema.Length > 0)
            {
                schemaFile = Path.Combine(work, "schema-" + Guid.NewGuid().ToString("N") + ".json");
                File.WriteAllText(schemaFile, schema, Utf8);
                arguments.AddRange(new string[] { "--output-schema", schemaFile });
            }
            arguments.Add("-");
        }

        try
        {
            child = Start(bin, arguments, work);
        }
        catch (Exception error)
        {
            // Windows wouldn't start it: blocked, quarantined or half updated.
            Send("{\"type\":\"exit\",\"code\":126,\"stderr\":\"" + Base64(bin + ": " + error.Message) + "\"}");
            return;
        }
        StringBuilder errors = new StringBuilder();
        child.ErrorDataReceived += delegate (object sender, DataReceivedEventArgs line)
        {
            if (line.Data == null) return;
            lock (errors)
            {
                errors.AppendLine(line.Data);
                if (errors.Length > 8000) errors.Remove(0, errors.Length - 4000);
            }
        };
        child.BeginErrorReadLine();

        // The article goes straight to the tool's input, on its own thread, so
        // a tool that prints before it has read everything can't stall.
        Thread feeder = new Thread(delegate ()
        {
            try
            {
                child.StandardInput.BaseStream.Write(article, 0, article.Length);
                child.StandardInput.Close();
            }
            catch (Exception)
            {
            }
        });
        feeder.IsBackground = true;
        feeder.Start();

        // When Spine goes away, the browser closes this program's input: stop
        // the tool too, so it doesn't use the reader's plan for nothing.
        Thread goodbye = new Thread(delegate ()
        {
            try
            {
                byte[] one = new byte[1];
                while (input.Read(one, 0, 1) > 0)
                {
                }
            }
            catch (Exception)
            {
            }
            Stop(child);
            Environment.Exit(0);
        });
        goodbye.IsBackground = true;
        goodbye.Start();

        string line2;
        while ((line2 = child.StandardOutput.ReadLine()) != null)
        {
            if (!line2.StartsWith("{") || !line2.EndsWith("}")) continue;
            if (Utf8.GetByteCount(line2) < MaxMessage) Send(line2);
            else Send("{\"type\":\"skipped\",\"bytes\":" + Utf8.GetByteCount(line2) + "}");
        }
        child.WaitForExit();
        string tail;
        lock (errors)
        {
            tail = errors.ToString();
        }
        if (tail.Length > 2000) tail = tail.Substring(tail.Length - 2000);
        if (schemaFile != null)
        {
            try
            {
                File.Delete(schemaFile);
            }
            catch (Exception)
            {
            }
        }
        Send("{\"type\":\"exit\",\"code\":" + child.ExitCode + ",\"stderr\":\"" + Base64(tail) + "\"}");
    }
}
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
