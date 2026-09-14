using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;

// 시험 제출 받기의 실제 수락 루프를 루프백 포트에서 돌린다(LAN 포트를 열지 않아 방화벽 창이 뜨지 않는다).
static class ExamReceiveLimitTest
{
    const BindingFlags PrivateStatic = BindingFlags.NonPublic | BindingFlags.Static;
    static readonly Type Launcher = typeof(ClassDockLauncher);

    static void Require(bool ok, string label) { if (!ok) throw new Exception(label); }
    static object Field(string name) { return Launcher.GetField(name, PrivateStatic).GetValue(null); }
    static void SetField(string name, object value) { Launcher.GetField(name, PrivateStatic).SetValue(null, value); }

    static string ReadAll(TcpClient client, int timeoutMs)
    {
        client.ReceiveTimeout = timeoutMs;
        MemoryStream output = new MemoryStream();
        byte[] buffer = new byte[4096];
        try
        {
            NetworkStream stream = client.GetStream();
            int got;
            while ((got = stream.Read(buffer, 0, buffer.Length)) > 0) output.Write(buffer, 0, got);
        }
        catch (IOException) { }
        return Encoding.UTF8.GetString(output.ToArray());
    }

    public static void Main()
    {
        int max = (int)Launcher.GetField("ExamReceiveMaxConcurrent", PrivateStatic).GetRawConstantValue();
        TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        lock (Field("ExamReceiveLock"))
        {
            SetField("ExamReceiveListener", listener);
            SetField("ExamReceivePort", port);
            SetField("ExamReceiveCode", "123456");
            SetField("ExamReceiveTitle", "limit test");
            SetField("ExamReceiveLastActivity", DateTime.UtcNow);
        }
        MethodInfo loop = Launcher.GetMethod("ExamReceiveAcceptLoop", PrivateStatic);
        Thread acceptThread = new Thread(delegate() { loop.Invoke(null, new object[] { listener }); });
        acceptThread.IsBackground = true;
        acceptThread.Start();

        // 1) 아무것도 보내지 않는 연결로 한도를 채운다. 한도를 넘는 연결은 기다리지 않고 곧바로 503 을 받는다.
        List<TcpClient> held = new List<TcpClient>();
        for (int i = 0; i < max; i++)
        {
            TcpClient c = new TcpClient(); c.Connect(IPAddress.Loopback, port); held.Add(c);
        }
        for (int i = 0; i < 200 && (int)Field("ExamReceiveActive") < max; i++) Thread.Sleep(10);
        Require((int)Field("ExamReceiveActive") == max, "held connections must occupy every slot, active=" + Field("ExamReceiveActive"));
        TcpClient extra = new TcpClient(); extra.Connect(IPAddress.Loopback, port);
        DateTime sent = DateTime.UtcNow;
        string busy = ReadAll(extra, 3000);
        Require(busy.StartsWith("HTTP/1.1 503") && busy.Contains("\"busy\""), "over-limit connection must get 503 busy: " + busy);
        Require((DateTime.UtcNow - sent).TotalMilliseconds < 2500, "busy answer must not wait for a free slot");
        Require((int)Field("ExamReceiveActive") == max, "rejected connection must not leak a slot");

        // 2) 붙잡던 연결을 놓으면 자리가 돌아오고 정상 요청이 다시 통과한다.
        foreach (TcpClient c in held) c.Close();
        for (int i = 0; i < 300 && (int)Field("ExamReceiveActive") > 0; i++) Thread.Sleep(10);
        Require((int)Field("ExamReceiveActive") == 0, "slots must be released after clients close, active=" + Field("ExamReceiveActive"));
        TcpClient hello = new TcpClient(); hello.Connect(IPAddress.Loopback, port);
        byte[] request = Encoding.ASCII.GetBytes("GET /exam-hello HTTP/1.1\r\nHost: t\r\nX-Exam-Code: 123456\r\n\r\n");
        hello.GetStream().Write(request, 0, request.Length);
        string ok = ReadAll(hello, 3000);
        Require(ok.StartsWith("HTTP/1.1 200") && ok.Contains("limit test"), "normal request must pass after slots free up: " + ok);

        lock (Field("ExamReceiveLock")) SetField("ExamReceiveListener", null);
        listener.Stop();
        Console.WriteLine("Exam receive limit checks passed: max=" + max);
    }
}
