using System;
using System.Collections;
using System.Reflection;
using System.Text;

// SSH 프로세스나 창을 열지 않고 실제 서버의 정리 정책과 Poll/Stop을 실행한다.
static class SshSessionRetentionTest
{
    static readonly Type Server = typeof(ClassDockSshTerminal);
    static readonly Type Session = Server.GetNestedType("SshSession", BindingFlags.NonPublic);
    static readonly IDictionary Sessions = (IDictionary)Server.GetField("Sessions", BindingFlags.NonPublic | BindingFlags.Static).GetValue(null);

    static void Require(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    static void AddSession(string id, bool complete, bool stopped, DateTime doneAt)
    {
        object session = Activator.CreateInstance(Session, true);
        Session.GetField("Id").SetValue(session, id);
        Session.GetField("Complete").SetValue(session, complete);
        Session.GetField("StopRequested").SetValue(session, stopped);
        Session.GetField("DoneAt").SetValue(session, doneAt);
        Session.GetField("ExitCode").SetValue(session, 0);
        object buffer = Session.GetField("Buffer").GetValue(session);
        byte[] bytes = Encoding.UTF8.GetBytes("last-output");
        buffer.GetType().GetMethod("Append").Invoke(buffer, new object[] { bytes, bytes.Length });
        Sessions.Add(id, session);
    }

    static void Sweep()
    {
        Server.GetMethod("SweepSessions", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, null);
    }

    public static void Main()
    {
        DateTime old = DateTime.UtcNow.AddMinutes(-30);
        AddSession("unread", true, false, old);
        AddSession("closed", true, true, old);
        AddSession("recent", true, true, DateTime.UtcNow);
        AddSession("active", false, false, DateTime.MaxValue);
        Sweep();
        Require(Sessions.Contains("unread"), "Unread output expired while workspace was inactive");
        Require(!Sessions.Contains("closed"), "Old explicitly closed session was not collected");
        Require(Sessions.Contains("recent"), "Recent closed session lost its grace period");
        Require(Sessions.Contains("active"), "Live session was collected");
        string reply = ClassDockSshTerminal.Poll("unread", "0");
        Require(reply.Contains("\"data\":\"" + Convert.ToBase64String(Encoding.UTF8.GetBytes("last-output")) + "\""), "Final output was lost");
        Require(reply.Contains("\"complete\":true") && reply.Contains("\"code\":0"), "Exit status was lost");
        // 응답을 받지 못한 클라이언트는 Stop 전까지 같은 출력을 다시 요청할 수 있다.
        Sweep();
        Require(Sessions.Contains("unread"), "Poll delivery alone must not allow collection");
        ClassDockSshTerminal.Stop("unread");
        Sweep();
        Require(!Sessions.Contains("unread"), "Consumed output was not collected after client release");
        Console.WriteLine("SSH session retention checks passed");
    }
}
