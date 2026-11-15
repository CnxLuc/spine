// A stand-in for claude.exe or codex.exe on Windows, for testing Spine's
// connector without them. The same as test/fixtures/fake-claude and
// fake-codex, which need Python.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;

static class FakeClaude
{
    static string Json(string text)
    {
        StringBuilder escaped = new StringBuilder("\"");
        foreach (char c in text)
        {
            if (c == '"' || c == '\\') escaped.Append('\\').Append(c);
            else if (c < ' ') escaped.Append("\\u").Append(((int)c).ToString("x4"));
            else escaped.Append(c);
        }
        return escaped.Append('"').ToString();
    }

    static string After(string[] args, string flag)
    {
        int at = Array.IndexOf(args, flag);
        return at >= 0 && at + 1 < args.Length ? args[at + 1] : null;
    }

    static int Main(string[] args)
    {
        bool codex = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]).ToLowerInvariant().Contains("codex");
        string home = Environment.GetEnvironmentVariable("USERPROFILE") ?? "";
        string marker = Path.Combine(home, ".fake-claude-signed-in");
        if (args.Length > 0 && args[0] == "--version")
        {
            Console.WriteLine(codex ? "codex-cli 9.9.9" : "9.9.9 (Claude Code)");
            return 0;
        }
        if (!codex && args.Length > 1 && args[0] == "auth" && args[1] == "status")
        {
            bool signedIn = Environment.GetEnvironmentVariable("FAKE_CLAUDE_LOGGED_OUT") != "1" || File.Exists(marker);
            Console.WriteLine(signedIn ? "{\n  \"loggedIn\": true,\n  \"authMethod\": \"claude.ai\",\n  \"subscriptionType\": \"max\"\n}" : "{\n  \"loggedIn\": false,\n  \"authMethod\": \"none\"\n}");
            return 0;
        }
        if (!codex && args.Length > 1 && args[0] == "auth" && args[1] == "login")
        {
            File.WriteAllText(marker, "");
            Console.WriteLine("Login successful.");
            return 0;
        }
        if (codex && args.Length > 1 && args[0] == "login" && args[1] == "status")
        {
            Console.WriteLine("Logged in using ChatGPT");
            return 0;
        }
        // Raw bytes, so a byte order mark the connector shouldn't send would show.
        MemoryStream raw = new MemoryStream();
        Console.OpenStandardInput().CopyTo(raw);
        byte[] bytes = raw.ToArray();
        bool mark = bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
        string input = new UTF8Encoding(false).GetString(bytes);
        string pidFile = Environment.GetEnvironmentVariable("FAKE_PIDFILE");
        if (!string.IsNullOrEmpty(pidFile)) File.WriteAllText(pidFile, System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
        if (Environment.GetEnvironmentVariable("FAKE_CLAUDE_SLOW") == "1") Thread.Sleep(30000);
        Stream stdout = Console.OpenStandardOutput();
        Action<string> emit = delegate (string line)
        {
            byte[] bytes = new UTF8Encoding(false).GetBytes(line + "\n");
            stdout.Write(bytes, 0, bytes.Length);
            stdout.Flush();
        };
        if (codex)
        {
            string schemaFile = After(args, "--output-schema");
            int effortAt = Array.FindIndex(args, delegate (string a) { return a.StartsWith("model_reasoning_effort="); });
            string answer = "{\"echo\":" + Json(input.Substring(input.LastIndexOf("\n\n") + 2).Substring(0, Math.Min(24, input.Length - input.LastIndexOf("\n\n") - 2))) +
                ",\"effort\":" + Json(effortAt >= 0 ? args[effortAt] : "") + ",\"sandbox\":" + Json(After(args, "--sandbox") ?? "") +
                ",\"noShell\":" + (Array.IndexOf(args, "features.shell_tool=false") >= 0 ? "true" : "false") +
                ",\"schema\":" + (schemaFile != null && File.Exists(schemaFile) ? "true" : "false") + "}";
            emit("{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":" + Json(answer) + "}}");
            emit("{\"type\":\"turn.completed\",\"usage\":{\"output_tokens\":20}}");
            return 0;
        }
        if (Environment.GetEnvironmentVariable("FAKE_CLAUDE_FAIL") == "limit")
        {
            emit("{\"type\":\"result\",\"is_error\":true,\"result\":\"Claude AI usage limit reached|1791342600\"}");
            return 1;
        }
        string reply = "{\"echo\":" + Json(input.Substring(0, Math.Min(24, input.Length))) +
            ",\"size\":" + bytes.Length + ",\"mark\":" + (mark ? "true" : "false") +
            ",\"system\":" + Json(After(args, "--system-prompt") ?? "") +
            ",\"schema\":" + Json(After(args, "--json-schema") ?? "") +
            ",\"model\":" + Json(After(args, "--model") ?? "") +
            ",\"tools\":" + Json(After(args, "--tools") ?? "missing") +
            ",\"cwd\":" + Json(Path.GetFileName(Directory.GetCurrentDirectory())) + "}";
        emit("{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_start\",\"content_block\":{\"type\":\"tool_use\",\"name\":\"StructuredOutput\"}}}");
        for (int at = 0; at < reply.Length; at += 7)
        {
            emit("{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":" + Json(reply.Substring(at, Math.Min(7, reply.Length - at))) + "}}}");
        }
        emit("{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_stop\"}}");
        emit("{\"type\":\"result\",\"is_error\":false,\"result\":" + Json(reply) + ",\"structured_output\":" + reply + ",\"usage\":{\"output_tokens\":34}}");
        // Claude Code has been known to stay open after its result.
        if (Environment.GetEnvironmentVariable("FAKE_CLAUDE_LINGER") == "1") Thread.Sleep(30000);
        return 0;
    }
}
