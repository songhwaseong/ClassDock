using System;
using System.Reflection;

class SshShellCommandTest
{
    static void Main(string[] args)
    {
        MethodInfo build = typeof(ClassDockSshTerminal).GetMethod("BuildShellIntegrationCommand", BindingFlags.NonPublic | BindingFlags.Static);
        Console.Write((string)build.Invoke(null, new object[] { args[0] }));
    }
}
