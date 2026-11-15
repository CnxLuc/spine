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
