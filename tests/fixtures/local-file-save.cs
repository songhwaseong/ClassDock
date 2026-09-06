using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;

// 앱 Main/브라우저를 시작하지 않고 실제 HTTP 라우터와 파일 저장을 임시 폴더에서 실행한다.
static class LocalFileSaveTest
{
    const BindingFlags PrivateStatic = BindingFlags.NonPublic | BindingFlags.Static;
    static readonly Type Launcher = typeof(ClassDockLauncher);
    static readonly Type Connection = Launcher.GetNestedType("HttpConnectionStream", BindingFlags.NonPublic);
    static readonly MethodInfo Handle = Launcher.GetMethod("HandleRequest", PrivateStatic);
    static string token;
    static int checks;

    sealed class Duplex : Stream
    {
        readonly MemoryStream input;
        public readonly MemoryStream Output = new MemoryStream();
        readonly int fragment;
        public bool ThrowAtEnd;
        public Duplex(byte[] request, int fragmentSize) { input = new MemoryStream(request); fragment = fragmentSize; }
        public override bool CanRead { get { return true; } }
        public override bool CanWrite { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override long Length { get { return input.Length; } }
        public override long Position { get { return input.Position; } set { throw new NotSupportedException(); } }
        public override int Read(byte[] bytes, int offset, int count)
        {
            if (ThrowAtEnd && input.Position == input.Length) throw new IOException("simulated receive failure");
            return input.Read(bytes, offset, Math.Min(count, fragment));
        }
        public override void Write(byte[] bytes, int offset, int count) { Output.Write(bytes, offset, count); }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long value) { throw new NotSupportedException(); }
    }

    static void Require(bool ok, string label)
    {
        checks++;
        if (!ok) throw new Exception(label);
    }
    static byte[] Join(byte[] first, byte[] second)
    {
        byte[] result = new byte[first.Length + second.Length];
        Buffer.BlockCopy(first, 0, result, 0, first.Length);
        Buffer.BlockCopy(second, 0, result, first.Length, second.Length);
        return result;
    }
    static byte[] Request(string route, string relative, string length, byte[] body, string extra)
    {
        return Join(Encoding.ASCII.GetBytes("POST " + route + " HTTP/1.1\r\nHost: 127.0.0.1:17645\r\n"
            + "Origin: http://127.0.0.1:17645\r\nX-ClassDock-Token: " + token
            + "\r\nX-ClassDock-Action: 1\r\nX-Save-Path: " + Uri.EscapeDataString(relative)
            + "\r\nContent-Length: " + length + "\r\n" + extra + "\r\n"), body);
    }
    static string Send(byte[] request, int fragment, bool readError)
    {
        Duplex wire = new Duplex(request, fragment); wire.ThrowAtEnd = readError;
        object connection = Activator.CreateInstance(Connection, new object[] { wire });
        try { Handle.Invoke(null, new object[] { connection }); Require(!readError, "read failure must propagate before routing"); }
        catch (TargetInvocationException ex)
        {
            if (!readError || !(ex.InnerException is IOException)) throw;
        }
        string response = Encoding.UTF8.GetString(wire.Output.ToArray());
        if (response.Contains("incomplete-request-body") || response.Contains("invalid-content-length") || response.Contains("unsupported-transfer-encoding"))
            Require(!(bool)Connection.GetField("KeepAlive").GetValue(connection), "invalid request must close connection");
        return response;
    }
    static void BytesEqual(string full, byte[] expected, string label)
    {
        byte[] actual = File.ReadAllBytes(full);
        Require(Convert.ToBase64String(actual) == Convert.ToBase64String(expected), label);
    }
    static void NoTemps(string root)
    {
        Require(Directory.GetFiles(root, ".classdock-save-*.tmp", SearchOption.AllDirectories).Length == 0, "temporary files must be removed");
    }
    static void CheckRoute(string root, bool source)
    {
        string relative = (source ? "source " : "save ") + "한글.bin";
        string full = Path.Combine(root, relative);
        string route = source ? "/source-folder-file?id=test&path=" + Uri.EscapeDataString(relative) : "/save-file";
        byte[] original = new byte[] { 0, 255, 13, 10, 42, 128 };
        byte[] replacement = new byte[] { 7, 0, 9 };
        string ok = Send(Request(route, relative, original.Length.ToString(), original, ""), 1, false);
        Require(ok.StartsWith("HTTP/1.1 200"), "new file save"); BytesEqual(full, original, "fragmented binary body");

        foreach (byte[] partial in new[] { replacement, new byte[0] })
        {
            string response = Send(Request(route, relative, "100", partial, ""), 7, false);
            Require(response.StartsWith("HTTP/1.1 400") && response.Contains("incomplete-request-body"), "incomplete body rejected");
            BytesEqual(full, original, "EOF must preserve original");
        }
        Send(Request(route, relative, "100", replacement, ""), 7, true);
        BytesEqual(full, original, "read exception must preserve original");
        foreach (string invalid in new[] { "-1", "2147483648", "not-a-length" })
        {
            Require(Send(Request(route, relative, invalid, replacement, ""), 8192, false).StartsWith("HTTP/1.1 400"), "invalid length rejected");
            BytesEqual(full, original, "invalid length must preserve original");
        }
        foreach (string extra in new[] { "Content-Length: 0\r\n", "Transfer-Encoding: chunked\r\n" })
        {
            Require(Send(Request(route, relative, "3", replacement, extra), 8192, false).StartsWith("HTTP/1.1 400"), "ambiguous framing rejected");
            BytesEqual(full, original, "framing error must preserve original");
        }
        // 기존 파일 핸들이 교체를 허용하지 않으면 원본을 보존하고 임시 파일만 정리한다.
        using (FileStream held = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            string response = Send(Request(route, relative, "3", replacement, ""), 8192, false);
            Require(!response.StartsWith("HTTP/1.1 200"), "locked destination must fail");
            BytesEqual(full, original, "replacement failure must preserve original");
            NoTemps(root);
        }
        File.SetAttributes(full, FileAttributes.ReadOnly);
        try
        {
            Require(!Send(Request(route, relative, "3", replacement, ""), 8192, false).StartsWith("HTTP/1.1 200"), "read-only destination must fail");
            BytesEqual(full, original, "read-only file must be preserved");
        }
        finally { File.SetAttributes(full, FileAttributes.Normal); }
        Require(Send(Request(route, relative, "3", replacement, "Content-Length: 3\r\n"), 2, false).StartsWith("HTTP/1.1 200"), "matching lengths remain valid");
        BytesEqual(full, replacement, "successful replacement");
        Require(Send(Request(route, relative, "0", new byte[0], ""), 7, false).StartsWith("HTTP/1.1 200"), "intentional empty overwrite");
        BytesEqual(full, new byte[0], "empty overwrite bytes");
        File.Delete(full);
        Require(Send(Request(route, relative, "0", new byte[0], ""), 7, false).StartsWith("HTTP/1.1 200"), "new empty file");
        BytesEqual(full, new byte[0], "new empty file bytes");
        NoTemps(root);

        string missing = (source ? "missing-source" : "missing-save") + ".bin";
        string missingRoute = source ? "/source-folder-file?id=test&path=" + missing : route;
        Send(Request(missingRoute, missing, "10", new byte[] { 1 }, ""), 8192, false);
        Require(!File.Exists(Path.Combine(root, missing)), "incomplete request must not create a file");
    }
    static void CheckKeepAlive(string root)
    {
        byte[] body = new byte[18000]; for (int i = 0; i < body.Length; i++) body[i] = (byte)i;
        byte[] first = Request("/save-file", "first.bin", body.Length.ToString(), body, "");
        byte[] second = Request("/save-file", "second.bin", "0", new byte[0], "");
        Duplex wire = new Duplex(Join(first, second), 8192);
        object connection = Activator.CreateInstance(Connection, new object[] { wire });
        Handle.Invoke(null, new object[] { connection });
        Require((bool)Connection.GetField("KeepAlive").GetValue(connection), "valid first request keeps connection");
        Handle.Invoke(null, new object[] { connection });
        BytesEqual(Path.Combine(root, "first.bin"), body, "large body boundary");
        BytesEqual(Path.Combine(root, "second.bin"), new byte[0], "next buffered request");
        NoTemps(root);
    }
    public static void Main(string[] args)
    {
        string root = Path.Combine(Path.GetFullPath(args[0]), "files"); Directory.CreateDirectory(root);
        Launcher.GetField("SaveRoot", PrivateStatic).SetValue(null, root);
        token = (string)Launcher.GetField("LocalAuthToken", PrivateStatic).GetValue(null);
        var folders = (Dictionary<string, string>)Launcher.GetField("SourceFolders", PrivateStatic).GetValue(null);
        folders["test"] = root;
        CheckRoute(root, false); CheckRoute(root, true); CheckKeepAlive(root);
        Console.WriteLine("Local file save checks passed: " + checks);
    }
}
