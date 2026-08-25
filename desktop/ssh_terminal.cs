using Microsoft.Win32.SafeHandles;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;

// ClassDock EXE 전용 SSH 터미널.
// Windows OpenSSH를 ConPTY에 붙여 원격 PTY의 ANSI 입출력을 브라우저 xterm.js와 중계한다.
// 비밀번호·개인키 암호는 디스크·명령행·환경변수에 넣지 않고, 난수 이름의 일회성 named pipe로 askpass helper에만 전달한다.
// 개인키는 Windows 파일 선택창에서 고르고, 브라우저에는 실행 중에만 유효한 난수 ID와 파일명만 돌려준다.
// Windows OpenSSH는 개인키 파일 ACL에 소유자 외 다른 사용자·그룹 권한이 있으면 키를 무시하므로(bad permissions),
// 접속할 때마다 키를 세션 전용 사본으로 복사해 상속을 끊고 현재 사용자 전용 ACL을 건 뒤 그 사본만 -i로 넘기고,
// 세션이 끝나면 사본을 덮어써 지운다. 원본 키 파일의 권한은 건드리지 않는다.
static class ClassDockSshTerminal
{
    const int MaxSessionOutputBytes = 16 * 1024 * 1024;
    const int MaxInputBytes = 256 * 1024;
    const int MaxSessions = 4;
    const int LongPollWaitMs = 500;
    const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    const uint HANDLE_FLAG_INHERIT = 0x00000001;
    const int OFN_PATHMUSTEXIST = 0x00000800;
    const int OFN_FILEMUSTEXIST = 0x00001000;
    const int OFN_NOCHANGEDIR = 0x00000008;
    const int OFN_DONTADDTORECENT = 0x02000000;
    static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = (IntPtr)0x00020016;

    [StructLayout(LayoutKind.Sequential)]
    struct COORD
    {
        public short X;
        public short Y;
        public COORD(int x, int y) { X = (short)x; Y = (short)y; }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct OPENFILENAME
    {
        public int lStructSize;
        public IntPtr hwndOwner;
        public IntPtr hInstance;
        public string lpstrFilter;
        public string lpstrCustomFilter;
        public int nMaxCustFilter;
        public int nFilterIndex;
        public IntPtr lpstrFile;
        public int nMaxFile;
        public IntPtr lpstrFileTitle;
        public int nMaxFileTitle;
        public string lpstrInitialDir;
        public string lpstrTitle;
        public int Flags;
        public short nFileOffset;
        public short nFileExtension;
        public string lpstrDefExt;
        public IntPtr lCustData;
        public IntPtr lpfnHook;
        public string lpTemplateName;
        public IntPtr pvReserved;
        public int dwReserved;
        public int FlagsEx;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CreatePipe(out IntPtr hReadPipe, out IntPtr hWritePipe, IntPtr attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandle(string moduleName);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)]
    static extern IntPtr GetProcAddress(IntPtr module, string procedureName);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern int CreatePseudoConsole(COORD size, IntPtr input, IntPtr output, uint flags, out IntPtr pseudoConsole);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern int ResizePseudoConsole(IntPtr pseudoConsole, COORD size);
    [DllImport("kernel32.dll")]
    static extern void ClosePseudoConsole(IntPtr pseudoConsole);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")]
    static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint flags, IntPtr environment, string cwd, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
    [DllImport("comdlg32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetOpenFileName([In, Out] ref OPENFILENAME dialog);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    sealed class RollingBytes
    {
        readonly byte[] data = new byte[MaxSessionOutputBytes];
        int head;
        int length;
        long startOffset;

        public void Append(byte[] buffer, int count)
        {
            if (buffer == null || count <= 0) return;
            int capacity = data.Length;
            long previousEnd = startOffset + length;
            if (count >= capacity)
            {
                Buffer.BlockCopy(buffer, count - capacity, data, 0, capacity);
                head = 0;
                length = capacity;
                startOffset = previousEnd + count - capacity;
                return;
            }

            int overflow = Math.Max(0, length + count - capacity);
            if (overflow > 0)
            {
                head = (head + overflow) % capacity;
                length -= overflow;
                startOffset += overflow;
            }

            int tail = (head + length) % capacity;
            int first = Math.Min(count, capacity - tail);
            Buffer.BlockCopy(buffer, 0, data, tail, first);
            if (first < count) Buffer.BlockCopy(buffer, first, data, 0, count - first);
            length += count;
        }

        public byte[] Read(long requestedOffset, out long nextOffset, out bool reset)
        {
            reset = requestedOffset < startOffset || requestedOffset > startOffset + length;
            if (reset) requestedOffset = startOffset;
            int index = (int)(requestedOffset - startOffset);
            int count = length - index;
            byte[] result = new byte[count];
            if (count > 0)
            {
                int source = (head + index) % data.Length;
                int first = Math.Min(count, data.Length - source);
                Buffer.BlockCopy(data, source, result, 0, first);
                if (first < count) Buffer.BlockCopy(data, 0, result, first, count - first);
            }
            nextOffset = startOffset + length;
            return result;
        }
    }

    sealed class SshSession
    {
        public string Id;
        public string Host;
        public int Port;
        public string User;
        public Process Process;
        public IntPtr PseudoConsole;
        public Stream Input;
        public Stream Output;
        public string StagedKeyPath;
        public readonly object Sync = new object();
        public readonly object BufferSync = new object();
        public readonly RollingBytes Buffer = new RollingBytes();
        public bool Complete;
        public bool StopRequested;
        public int ExitCode = -1;
        public DateTime LastUsed = DateTime.UtcNow;
        public DateTime DoneAt = DateTime.MaxValue;
    }

    sealed class ScannedHostKey
    {
        public string HostField;
        public string Algorithm;
        public string Key;
        public string Fingerprint;
    }

    sealed class PrivateKeySelection
    {
        public string Id;
        public string Path;
        public string Name;
        public DateTime LastUsed = DateTime.UtcNow;
    }

    static readonly object SessionsLock = new object();
    static readonly Dictionary<string, SshSession> Sessions = new Dictionary<string, SshSession>();
    static readonly object PrivateKeysLock = new object();
    static readonly Dictionary<string, PrivateKeySelection> PrivateKeys = new Dictionary<string, PrivateKeySelection>();
    static readonly object PrivateKeyPickerLock = new object();
    static string PrivateKeyPickerState = "idle";
    static string PrivateKeyPickerId = "";
    static string PrivateKeyPickerName = "";
    static readonly string SshDataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClassDock", "ssh");
    static readonly string KnownHostsPath = Path.Combine(SshDataDirectory, "known_hosts");
    static readonly string PrivateKeyStageDirectory = Path.Combine(SshDataDirectory, "keys");

    public static bool TryRunAskPassHelper()
    {
        string pipeName = Environment.GetEnvironmentVariable("CLASSDOCK_SSH_ASKPASS_PIPE");
        if (string.IsNullOrWhiteSpace(pipeName)) return false;
        byte[] secret = null;
        try
        {
            using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.In))
            {
                pipe.Connect(10000);
                byte[] sizeBytes = ReadExactly(pipe, 4);
                int size = BitConverter.ToInt32(sizeBytes, 0);
                if (size < 0 || size > 16 * 1024) return true;
                secret = ReadExactly(pipe, size);
            }
            using (Stream stdout = Console.OpenStandardOutput())
            {
                stdout.Write(secret, 0, secret.Length);
                stdout.WriteByte((byte)'\n');
                stdout.Flush();
            }
        }
        catch { }
        finally { if (secret != null) Array.Clear(secret, 0, secret.Length); }
        return true;
    }

    static byte[] ReadExactly(Stream stream, int count)
    {
        byte[] result = new byte[count];
        int offset = 0;
        while (offset < count)
        {
            int read = stream.Read(result, offset, count - offset);
            if (read <= 0) throw new EndOfStreamException();
            offset += read;
        }
        return result;
    }

    public static string CapabilityJson()
    {
        string ssh = FindOpenSsh("ssh.exe");
        bool windowsConPty = HasConPtyApi();
        bool conpty = windowsConPty && ssh != null;
        string reason = conpty ? "" : (!windowsConPty
            ? "Windows 10 1809 이상이 필요합니다."
            : "Windows OpenSSH Client가 필요합니다.");
        return "{\"available\":" + (conpty ? "true" : "false")
            + ",\"client\":\"Windows OpenSSH\",\"reason\":" + JsonString(reason) + "}";
    }

    public static bool StartPrivateKeyPicker()
    {
        lock (PrivateKeyPickerLock)
        {
            if (PrivateKeyPickerState == "opening") return false;
            PrivateKeyPickerState = "opening";
            PrivateKeyPickerId = "";
            PrivateKeyPickerName = "";
        }
        Thread thread = new Thread(delegate()
        {
            try
            {
                string selected = RunPrivateKeyPicker();
                lock (PrivateKeyPickerLock)
                {
                    if (selected.Length == 0)
                    {
                        PrivateKeyPickerState = "cancelled";
                    }
                    else
                    {
                        PrivateKeySelection key = RegisterPrivateKey(selected);
                        PrivateKeyPickerId = key.Id;
                        PrivateKeyPickerName = key.Name;
                        PrivateKeyPickerState = "selected";
                    }
                }
            }
            catch (Exception ex)
            {
                lock (PrivateKeyPickerLock)
                {
                    PrivateKeyPickerState = "error";
                    PrivateKeyPickerName = ex is InvalidOperationException && ex.Message.StartsWith("ssh-private-key-", StringComparison.Ordinal)
                        ? ex.Message : "ssh-private-key-read-failed";
                    PrivateKeyPickerId = "";
                }
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        return true;
    }

    public static string PrivateKeyPickerStatusJson()
    {
        lock (PrivateKeyPickerLock)
            return "{\"state\":" + JsonString(PrivateKeyPickerState)
                + ",\"id\":" + JsonString(PrivateKeyPickerId)
                + ",\"name\":" + JsonString(PrivateKeyPickerName) + "}";
    }

    static string RunPrivateKeyPicker()
    {
        const int capacity = 32768;
        IntPtr fileBuffer = IntPtr.Zero;
        try
        {
            // StringBuilder를 구조체 필드로 마샬링하면 일부 .NET Framework/x64 환경에서
            // 대화상자가 열리기 전에 MarshalDirectiveException이 발생한다. 출력 버퍼를 직접 할당한다.
            fileBuffer = Marshal.AllocHGlobal(capacity * 2);
            Marshal.WriteInt16(fileBuffer, 0, 0);
            OPENFILENAME dialog = new OPENFILENAME();
            dialog.lStructSize = Marshal.SizeOf(typeof(OPENFILENAME));
            dialog.hwndOwner = GetForegroundWindow();
            dialog.lpstrFilter = "OpenSSH/PEM 개인키\0id_*;*.pem;*.key\0모든 파일\0*.*\0\0";
            dialog.nFilterIndex = 1;
            dialog.lpstrFile = fileBuffer;
            dialog.nMaxFile = capacity;
            dialog.lpstrTitle = "SSH 개인키 파일을 선택하세요";
            dialog.Flags = OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_NOCHANGEDIR | OFN_DONTADDTORECENT;
            return GetOpenFileName(ref dialog) ? (Marshal.PtrToStringUni(fileBuffer) ?? "") : "";
        }
        catch { throw new InvalidOperationException("ssh-private-key-picker-failed"); }
        finally { if (fileBuffer != IntPtr.Zero) Marshal.FreeHGlobal(fileBuffer); }
    }

    static PrivateKeySelection RegisterPrivateKey(string path)
    {
        string fullPath = ValidatePrivateKeyPath(path);
        PrivateKeySelection selection = new PrivateKeySelection();
        selection.Id = Guid.NewGuid().ToString("N");
        selection.Path = fullPath;
        selection.Name = Path.GetFileName(fullPath);
        lock (PrivateKeysLock)
        {
            DateTime cutoff = DateTime.UtcNow.AddHours(-8);
            List<string> stale = new List<string>();
            foreach (KeyValuePair<string, PrivateKeySelection> item in PrivateKeys)
                if (item.Value.LastUsed < cutoff) stale.Add(item.Key);
            foreach (string id in stale) PrivateKeys.Remove(id);
            while (PrivateKeys.Count >= 16)
            {
                string oldest = null;
                DateTime used = DateTime.MaxValue;
                foreach (KeyValuePair<string, PrivateKeySelection> item in PrivateKeys)
                    if (item.Value.LastUsed < used) { oldest = item.Key; used = item.Value.LastUsed; }
                if (oldest == null) break;
                PrivateKeys.Remove(oldest);
            }
            PrivateKeys[selection.Id] = selection;
        }
        return selection;
    }

    static PrivateKeySelection ResolvePrivateKey(string id)
    {
        PrivateKeySelection selection;
        lock (PrivateKeysLock)
        {
            PrivateKeys.TryGetValue((id ?? "").Trim(), out selection);
            if (selection != null) selection.LastUsed = DateTime.UtcNow;
        }
        if (selection == null) throw new InvalidOperationException("ssh-private-key-not-selected");
        ValidatePrivateKeyPath(selection.Path);
        return selection;
    }

    static string ValidatePrivateKeyPath(string path)
    {
        string fullPath;
        try { fullPath = Path.GetFullPath(path ?? ""); }
        catch { throw new InvalidOperationException("ssh-private-key-not-found"); }
        if (!File.Exists(fullPath)) throw new InvalidOperationException("ssh-private-key-not-found");
        FileInfo info = new FileInfo(fullPath);
        if (info.Length <= 0 || info.Length > 1024 * 1024) throw new InvalidOperationException("ssh-private-key-size");
        byte[] head = new byte[(int)Math.Min(info.Length, 512)];
        try
        {
            using (FileStream stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                int offset = 0;
                while (offset < head.Length)
                {
                    int read = stream.Read(head, offset, head.Length - offset);
                    if (read <= 0) break;
                    offset += read;
                }
            }
            string text = Encoding.ASCII.GetString(head);
            if (text.StartsWith("PuTTY-User-Key-File-", StringComparison.Ordinal))
                throw new InvalidOperationException("ssh-private-key-putty-format");
            if (string.Equals(Path.GetExtension(fullPath), ".pub", StringComparison.OrdinalIgnoreCase)
                || text.StartsWith("ssh-", StringComparison.Ordinal) || text.StartsWith("ecdsa-", StringComparison.Ordinal))
                throw new InvalidOperationException("ssh-private-key-is-public");
            if (text.IndexOf("-----BEGIN OPENSSH PRIVATE KEY-----", StringComparison.Ordinal) < 0
                && text.IndexOf("-----BEGIN RSA PRIVATE KEY-----", StringComparison.Ordinal) < 0
                && text.IndexOf("-----BEGIN DSA PRIVATE KEY-----", StringComparison.Ordinal) < 0
                && text.IndexOf("-----BEGIN EC PRIVATE KEY-----", StringComparison.Ordinal) < 0
                && text.IndexOf("-----BEGIN PRIVATE KEY-----", StringComparison.Ordinal) < 0
                && text.IndexOf("-----BEGIN ENCRYPTED PRIVATE KEY-----", StringComparison.Ordinal) < 0)
                throw new InvalidOperationException("ssh-private-key-invalid-format");
        }
        finally { Array.Clear(head, 0, head.Length); }
        return fullPath;
    }

    // 원본 키가 어느 폴더에 있든(다운로드 폴더처럼 다른 사용자·그룹 ACE를 상속하는 곳이어도)
    // Windows OpenSSH의 개인키 권한 검사를 통과하도록, 현재 사용자만 접근 가능한 일회용 사본을 만든다.
    static string StagePrivateKey(string sourcePath)
    {
        SweepStagedPrivateKeys();
        Directory.CreateDirectory(PrivateKeyStageDirectory);
        try { ApplyOwnerOnlyAcl(PrivateKeyStageDirectory, true); } catch { }
        string staged = Path.Combine(PrivateKeyStageDirectory, Guid.NewGuid().ToString("N") + ".key");
        byte[] data = null;
        try
        {
            data = File.ReadAllBytes(sourcePath);
            if (data.Length <= 0 || data.Length > 1024 * 1024) throw new InvalidOperationException("ssh-private-key-size");
            using (FileStream stream = new FileStream(staged, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                stream.Write(data, 0, data.Length);
            ApplyOwnerOnlyAcl(staged, false);
            return staged;
        }
        catch (InvalidOperationException) { WipeStagedPrivateKey(staged); throw; }
        catch { WipeStagedPrivateKey(staged); throw new InvalidOperationException("ssh-private-key-secure-copy-failed"); }
        finally { if (data != null) Array.Clear(data, 0, data.Length); }
    }

    // 상속을 끊고 현재 사용자 계정 하나만 남긴다. SYSTEM·Administrators까지 지워도 OpenSSH 검사에는 문제가 없다.
    static void ApplyOwnerOnlyAcl(string path, bool directory)
    {
        SecurityIdentifier self = WindowsIdentity.GetCurrent().User;
        FileSystemAccessRule rule = new FileSystemAccessRule(self, FileSystemRights.FullControl,
            directory ? InheritanceFlags.ObjectInherit | InheritanceFlags.ContainerInherit : InheritanceFlags.None,
            PropagationFlags.None, AccessControlType.Allow);
        if (directory)
        {
            DirectorySecurity security = Directory.GetAccessControl(path, AccessControlSections.Access);
            security.SetAccessRuleProtection(true, false);
            foreach (FileSystemAccessRule existing in security.GetAccessRules(true, false, typeof(SecurityIdentifier)))
                security.RemoveAccessRuleSpecific(existing);
            security.AddAccessRule(rule);
            Directory.SetAccessControl(path, security);
            return;
        }
        FileSecurity fileSecurity = File.GetAccessControl(path, AccessControlSections.Access);
        fileSecurity.SetAccessRuleProtection(true, false);
        foreach (FileSystemAccessRule existing in fileSecurity.GetAccessRules(true, false, typeof(SecurityIdentifier)))
            fileSecurity.RemoveAccessRuleSpecific(existing);
        fileSecurity.AddAccessRule(rule);
        File.SetAccessControl(path, fileSecurity);
        try
        {
            FileSecurity owner = new FileSecurity();
            owner.SetOwner(self);
            File.SetAccessControl(path, owner);
        }
        catch { }
    }

    static void WipeStagedPrivateKey(string path)
    {
        if (string.IsNullOrEmpty(path)) return;
        try
        {
            if (!File.Exists(path)) return;
            long length = new FileInfo(path).Length;
            if (length > 0 && length <= 1024 * 1024)
            {
                byte[] noise = new byte[(int)length];
                using (RandomNumberGenerator random = RandomNumberGenerator.Create()) random.GetBytes(noise);
                using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.None))
                {
                    stream.Write(noise, 0, noise.Length);
                    stream.Flush();
                }
                Array.Clear(noise, 0, noise.Length);
            }
            File.Delete(path);
        }
        catch { }
    }

    // 비정상 종료로 남은 사본을 정리한다.
    static void SweepStagedPrivateKeys()
    {
        try
        {
            if (!Directory.Exists(PrivateKeyStageDirectory)) return;
            DateTime cutoff = DateTime.UtcNow.AddHours(-12);
            List<string> live = new List<string>();
            lock (SessionsLock)
                foreach (SshSession session in Sessions.Values)
                    if (!string.IsNullOrEmpty(session.StagedKeyPath)) live.Add(session.StagedKeyPath);
            foreach (string file in Directory.GetFiles(PrivateKeyStageDirectory, "*.key"))
            {
                if (live.Contains(file)) continue;
                bool old;
                try { old = File.GetLastWriteTimeUtc(file) < cutoff; } catch { continue; }
                if (old) WipeStagedPrivateKey(file);
            }
        }
        catch { }
    }

    static bool HasConPtyApi()
    {
        try
        {
            IntPtr kernel32 = GetModuleHandle("kernel32.dll");
            return kernel32 != IntPtr.Zero
                && GetProcAddress(kernel32, "CreatePseudoConsole") != IntPtr.Zero
                && GetProcAddress(kernel32, "ResizePseudoConsole") != IntPtr.Zero
                && GetProcAddress(kernel32, "ClosePseudoConsole") != IntPtr.Zero;
        }
        catch { return false; }
    }

    public static string ScanHostKey(byte[] body)
    {
        string[] request = ReadBundle(body, 2, 8 * 1024);
        string host = ValidateHost(request[0]);
        int port = ValidatePort(request[1]);
        string keyscan = FindOpenSsh("ssh-keyscan.exe");
        string stdout = "";
        string stderr = "";
        if (keyscan != null)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = keyscan;
                psi.Arguments = "-T 8 -p " + port + " " + QuoteArgument(host);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = new UTF8Encoding(false);
                psi.StandardErrorEncoding = new UTF8Encoding(false);
                using (Process process = Process.Start(psi))
                {
                    if (!process.WaitForExit(12000))
                    {
                        try { process.Kill(); } catch { }
                        stderr = "ssh-keyscan-timeout";
                    }
                    else
                    {
                        stdout = process.StandardOutput.ReadToEnd();
                        stderr = process.StandardError.ReadToEnd();
                    }
                }
            }
            catch (Exception ex) { stderr = ex.Message; }
        }

        ScannedHostKey scanned = PickHostKey(stdout, host, port);
        if (scanned == null)
        {
            string probeError;
            scanned = ProbeHostKeyWithSsh(host, port, out probeError);
            if (scanned == null)
                throw new InvalidOperationException("ssh-host-key-not-found: " + OneLine(probeError.Length > 0 ? probeError : stderr));
        }
        string trusted = TrustedFingerprint(scanned.HostField);
        string state = string.IsNullOrEmpty(trusted) ? "new" : (trusted == scanned.Fingerprint ? "trusted" : "changed");
        return "{\"state\":" + JsonString(state)
            + ",\"host\":" + JsonString(host) + ",\"port\":" + port
            + ",\"algorithm\":" + JsonString(scanned.Algorithm)
            + ",\"key\":" + JsonString(scanned.Key)
            + ",\"fingerprint\":" + JsonString(scanned.Fingerprint)
            + ",\"trustedFingerprint\":" + JsonString(trusted) + "}";
    }

    static ScannedHostKey ProbeHostKeyWithSsh(string host, int port, out string error)
    {
        error = "";
        string ssh = FindOpenSsh("ssh.exe");
        if (ssh == null) { error = "ssh-client-not-found"; return null; }
        string scanPath = Path.Combine(Path.GetTempPath(), "classdock_ssh_scan_" + Guid.NewGuid().ToString("N") + ".known_hosts");
        try
        {
            string[] args = new string[] {
                "-F", "NUL", "-T", "-p", port.ToString(),
                "-o", "BatchMode=yes", "-o", "PasswordAuthentication=no",
                "-o", "KbdInteractiveAuthentication=no", "-o", "PubkeyAuthentication=no",
                "-o", "NumberOfPasswordPrompts=0", "-o", "ConnectTimeout=8",
                "-o", "ConnectionAttempts=1", "-o", "StrictHostKeyChecking=accept-new",
                "-o", "UserKnownHostsFile=" + scanPath, "-o", "GlobalKnownHostsFile=NUL",
                "-o", "HashKnownHosts=no", "-o", "ClearAllForwardings=yes",
                "classdock-keyscan@" + host, "exit"
            };
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = ssh;
            psi.Arguments = JoinArguments(args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = new UTF8Encoding(false);
            psi.StandardErrorEncoding = new UTF8Encoding(false);
            using (Process process = Process.Start(psi))
            {
                if (!process.WaitForExit(12000))
                {
                    try { process.Kill(); } catch { }
                    error = "ssh-host-key-probe-timeout";
                    return null;
                }
                process.StandardOutput.ReadToEnd();
                error = process.StandardError.ReadToEnd();
            }
            string knownHost = File.Exists(scanPath) ? File.ReadAllText(scanPath, Encoding.UTF8) : "";
            return PickHostKey(knownHost, host, port);
        }
        catch (Exception ex) { error = ex.Message; return null; }
        finally { try { if (File.Exists(scanPath)) File.Delete(scanPath); } catch { } }
    }

    public static string TrustHostKey(byte[] body)
    {
        string[] request = ReadBundle(body, 5, 64 * 1024);
        string host = ValidateHost(request[0]);
        int port = ValidatePort(request[1]);
        string algorithm = ValidateAlgorithm(request[2]);
        string key = ValidateKey(request[3]);
        bool replace = request[4] == "1";
        string hostField = KnownHostField(host, port);
        string fingerprint = Fingerprint(key);
        Directory.CreateDirectory(SshDataDirectory);
        lock (SessionsLock)
        {
            List<string> kept = new List<string>();
            if (File.Exists(KnownHostsPath))
            {
                foreach (string line in File.ReadAllLines(KnownHostsPath, Encoding.UTF8))
                {
                    string trimmed = line.Trim();
                    if (trimmed.Length == 0 || trimmed.StartsWith("#", StringComparison.Ordinal)) { kept.Add(line); continue; }
                    string[] parts = trimmed.Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length < 3 || !string.Equals(parts[0], hostField, StringComparison.OrdinalIgnoreCase)) kept.Add(line);
                    else if (!replace && Fingerprint(parts[2]) != fingerprint) throw new InvalidOperationException("ssh-host-key-changed");
                }
            }
            kept.Add(hostField + " " + algorithm + " " + key);
            File.WriteAllLines(KnownHostsPath, kept.ToArray(), new UTF8Encoding(false));
        }
        return "{\"ok\":true,\"fingerprint\":" + JsonString(fingerprint) + "}";
    }

    public static string Open(byte[] body)
    {
        string[] request = ReadBundle(body, 8, 64 * 1024);
        string authentication = ValidateAuthentication(request[0]);
        string host = ValidateHost(request[1]);
        int port = ValidatePort(request[2]);
        string user = ValidateUser(request[3]);
        string secret = request[4] ?? "";
        string privateKeyId = request[5] ?? "";
        int cols = ClampNumber(request[6], 20, 300, 100);
        int rows = ClampNumber(request[7], 5, 120, 30);
        if (secret.Length > 16 * 1024 || secret.IndexOf('\0') >= 0
            || (authentication == "password" && secret.Length == 0))
            throw new InvalidOperationException(authentication == "password" ? "bad-ssh-password" : "bad-ssh-key-passphrase");
        if (TrustedFingerprint(KnownHostField(host, port)).Length == 0)
            throw new InvalidOperationException("ssh-host-key-not-trusted");
        string ssh = FindOpenSsh("ssh.exe");
        if (ssh == null) throw new InvalidOperationException("ssh-client-not-found");
        PrivateKeySelection privateKey = authentication == "private-key" ? ResolvePrivateKey(privateKeyId) : null;

        SweepSessions();
        lock (SessionsLock)
        {
            int active = 0;
            foreach (SshSession value in Sessions.Values) if (!value.Complete) active++;
            if (active >= MaxSessions) throw new InvalidOperationException("ssh-session-limit");
        }

        string stagedKeyPath = privateKey == null ? "" : StagePrivateKey(privateKey.Path);

        byte[] secretBytes = Encoding.UTF8.GetBytes(secret);
        string pipeName = "classdock_ssh_askpass_" + Guid.NewGuid().ToString("N");
        StartAskPassServer(pipeName, secretBytes);

        string arguments = BuildSshArguments(host, port, user, authentication, stagedKeyPath);
        Dictionary<string, string> environment = CurrentEnvironment();
        environment["SSH_ASKPASS"] = Process.GetCurrentProcess().MainModule.FileName;
        environment["SSH_ASKPASS_REQUIRE"] = "force";
        environment["DISPLAY"] = "ClassDock";
        environment["CLASSDOCK_SSH_ASKPASS_PIPE"] = pipeName;
        environment["TERM"] = "xterm-256color";

        SshSession session = new SshSession();
        session.Id = Guid.NewGuid().ToString("N");
        session.Host = host;
        session.Port = port;
        session.User = user;
        session.StagedKeyPath = stagedKeyPath;
        try { StartConPtyProcess(session, ssh, arguments, environment, cols, rows); }
        catch { WipeStagedPrivateKey(stagedKeyPath); throw; }
        lock (SessionsLock) Sessions[session.Id] = session;
        StartReaders(session);
        return "{\"id\":" + JsonString(session.Id) + ",\"host\":" + JsonString(host)
            + ",\"port\":" + port + ",\"user\":" + JsonString(user) + "}";
    }

    public static void Input(string id, byte[] body)
    {
        if (body == null || body.Length == 0 || body.Length > MaxInputBytes) throw new InvalidOperationException("bad-ssh-input");
        SshSession session = FindSession(id);
        lock (session.Sync)
        {
            if (session.Complete || session.Input == null) throw new InvalidOperationException("ssh-session-closed");
            session.Input.Write(body, 0, body.Length);
            session.Input.Flush();
            session.LastUsed = DateTime.UtcNow;
        }
    }

    public static string Poll(string id, string offsetText)
    {
        SshSession session = FindSession(id);
        long offset;
        if (!long.TryParse(offsetText, out offset) || offset < 0) offset = 0;
        long next;
        bool reset;
        byte[] data;
        lock (session.BufferSync)
        {
            data = session.Buffer.Read(offset, out next, out reset);
            if (data.Length == 0)
            {
                bool alreadyComplete;
                lock (session.Sync) alreadyComplete = session.Complete;
                if (!alreadyComplete)
                {
                    Monitor.Wait(session.BufferSync, LongPollWaitMs);
                    data = session.Buffer.Read(offset, out next, out reset);
                }
            }
        }
        bool complete;
        bool stopped;
        int code;
        lock (session.Sync)
        {
            session.LastUsed = DateTime.UtcNow;
            complete = session.Complete;
            stopped = session.StopRequested;
            code = session.ExitCode;
        }
        return "{\"alive\":" + (complete ? "false" : "true")
            + ",\"complete\":" + (complete ? "true" : "false")
            + ",\"stopped\":" + (stopped ? "true" : "false")
            + ",\"code\":" + code + ",\"offset\":" + next
            + ",\"reset\":" + (reset ? "true" : "false")
            + ",\"data\":" + JsonString(Convert.ToBase64String(data)) + "}";
    }

    public static void Resize(string id, byte[] body)
    {
        string[] request = ReadBundle(body, 2, 1024);
        int cols = ClampNumber(request[0], 20, 300, 100);
        int rows = ClampNumber(request[1], 5, 120, 30);
        SshSession session = FindSession(id);
        lock (session.Sync)
        {
            if (session.Complete || session.PseudoConsole == IntPtr.Zero) return;
            int hr = ResizePseudoConsole(session.PseudoConsole, new COORD(cols, rows));
            if (hr != 0) throw new InvalidOperationException("ssh-resize-failed");
        }
    }

    public static void Stop(string id)
    {
        SshSession session;
        lock (SessionsLock) Sessions.TryGetValue(id ?? "", out session);
        if (session == null) return;
        lock (session.Sync) session.StopRequested = true;
        CloseSession(session);
    }

    public static void ShutdownAll()
    {
        List<SshSession> all = new List<SshSession>();
        lock (SessionsLock) { foreach (SshSession session in Sessions.Values) all.Add(session); Sessions.Clear(); }
        foreach (SshSession session in all) CloseSession(session);
        lock (PrivateKeysLock) PrivateKeys.Clear();
        SweepStagedPrivateKeys();
    }

    static void StartReaders(SshSession session)
    {
        Thread reader = new Thread(delegate()
        {
            byte[] buffer = new byte[8192];
            try
            {
                int read;
                while ((read = session.Output.Read(buffer, 0, buffer.Length)) > 0)
                    lock (session.BufferSync)
                    {
                        session.Buffer.Append(buffer, read);
                        Monitor.PulseAll(session.BufferSync);
                    }
            }
            catch { }
        });
        reader.IsBackground = true;
        reader.Start();

        Thread watcher = new Thread(delegate()
        {
            int code = -1;
            try { session.Process.WaitForExit(); code = session.Process.ExitCode; } catch { }
            try { reader.Join(1500); } catch { }
            lock (session.Sync)
            {
                session.Complete = true;
                session.ExitCode = session.StopRequested ? 130 : code;
                session.DoneAt = DateTime.UtcNow;
            }
            lock (session.BufferSync) Monitor.PulseAll(session.BufferSync);
            CloseSessionHandles(session, true);
        });
        watcher.IsBackground = true;
        watcher.Start();
    }

    static void CloseSession(SshSession session)
    {
        lock (session.Sync)
        {
            try { if (session.Input != null) session.Input.Dispose(); } catch { }
            session.Input = null;
            try { if (session.Process != null && !session.Process.HasExited) session.Process.Kill(); } catch { }
        }
        try { if (session.Process != null) session.Process.WaitForExit(1500); } catch { }
        lock (session.Sync)
        {
            session.Complete = true;
            if (session.ExitCode < 0) session.ExitCode = session.StopRequested ? 130 : -1;
            if (session.DoneAt == DateTime.MaxValue) session.DoneAt = DateTime.UtcNow;
        }
        lock (session.BufferSync) Monitor.PulseAll(session.BufferSync);
        CloseSessionHandles(session, true);
    }

    static void SweepSessions()
    {
        DateTime cutoff = DateTime.UtcNow.AddMinutes(-15);
        List<string> stale = new List<string>();
        lock (SessionsLock)
        {
            foreach (KeyValuePair<string, SshSession> item in Sessions)
            {
                lock (item.Value.Sync)
                    if (item.Value.Complete && item.Value.DoneAt < cutoff) stale.Add(item.Key);
            }
            foreach (string id in stale) Sessions.Remove(id);
        }
    }

    static void CloseSessionHandles(SshSession session, bool closeOutput)
    {
        string stagedKeyPath;
        lock (session.Sync)
        {
            if (closeOutput) { try { if (session.Output != null) session.Output.Dispose(); } catch { } session.Output = null; }
            if (session.PseudoConsole != IntPtr.Zero)
            {
                try { ClosePseudoConsole(session.PseudoConsole); } catch { }
                session.PseudoConsole = IntPtr.Zero;
            }
            stagedKeyPath = session.StagedKeyPath;
            session.StagedKeyPath = null;
        }
        WipeStagedPrivateKey(stagedKeyPath);
    }

    static SshSession FindSession(string id)
    {
        SshSession session;
        lock (SessionsLock) Sessions.TryGetValue(id ?? "", out session);
        if (session == null) throw new InvalidOperationException("ssh-session-not-found");
        return session;
    }

    static void StartAskPassServer(string pipeName, byte[] secret)
    {
        Thread thread = new Thread(delegate()
        {
            try
            {
                DateTime until = DateTime.UtcNow.AddMinutes(2);
                for (int attempt = 0; attempt < 3 && DateTime.UtcNow < until; attempt++)
                {
                    using (NamedPipeServerStream pipe = new NamedPipeServerStream(pipeName, PipeDirection.Out, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous))
                    {
                        IAsyncResult wait = pipe.BeginWaitForConnection(null, null);
                        if (!wait.AsyncWaitHandle.WaitOne(until - DateTime.UtcNow)) break;
                        pipe.EndWaitForConnection(wait);
                        byte[] size = BitConverter.GetBytes(secret.Length);
                        pipe.Write(size, 0, size.Length);
                        pipe.Write(secret, 0, secret.Length);
                        pipe.Flush();
                    }
                }
            }
            catch { }
            finally { Array.Clear(secret, 0, secret.Length); }
        });
        thread.IsBackground = true;
        thread.Start();
    }

    static void StartConPtyProcess(SshSession session, string executable, string arguments,
        Dictionary<string, string> environment, int cols, int rows)
    {
        IntPtr inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero, outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero, environmentBlock = IntPtr.Zero, pseudoConsole = IntPtr.Zero;
        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
        try
        {
            if (!CreatePipe(out inputRead, out inputWrite, IntPtr.Zero, 0) || !CreatePipe(out outputRead, out outputWrite, IntPtr.Zero, 0))
                throw new InvalidOperationException("conpty-pipe-failed:" + Marshal.GetLastWin32Error());
            SetHandleInformation(inputWrite, HANDLE_FLAG_INHERIT, 0);
            SetHandleInformation(outputRead, HANDLE_FLAG_INHERIT, 0);
            int hr = CreatePseudoConsole(new COORD(cols, rows), inputRead, outputWrite, 0, out pseudoConsole);
            if (hr != 0) throw new InvalidOperationException("conpty-create-failed:" + hr);

            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attributeList = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref size))
                throw new InvalidOperationException("conpty-attribute-list-failed:" + Marshal.GetLastWin32Error());
            if (!UpdateProcThreadAttribute(attributeList, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                pseudoConsole, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))
                throw new InvalidOperationException("conpty-attribute-update-failed:" + Marshal.GetLastWin32Error());

            STARTUPINFOEX startup = new STARTUPINFOEX();
            startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            startup.lpAttributeList = attributeList;
            environmentBlock = BuildEnvironmentBlock(environment);
            StringBuilder command = new StringBuilder(QuoteArgument(executable) + " " + arguments);
            bool started = CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT, environmentBlock,
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ref startup, out pi);
            if (!started) throw new InvalidOperationException("ssh-start-failed:" + Marshal.GetLastWin32Error());

            session.PseudoConsole = pseudoConsole;
            pseudoConsole = IntPtr.Zero;
            session.Input = new FileStream(new SafeFileHandle(inputWrite, true), FileAccess.Write, 4096, false);
            inputWrite = IntPtr.Zero;
            session.Output = new FileStream(new SafeFileHandle(outputRead, true), FileAccess.Read, 8192, false);
            outputRead = IntPtr.Zero;
            session.Process = Process.GetProcessById((int)pi.dwProcessId);
        }
        finally
        {
            if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
            if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
            if (attributeList != IntPtr.Zero) { DeleteProcThreadAttributeList(attributeList); Marshal.FreeHGlobal(attributeList); }
            if (environmentBlock != IntPtr.Zero) Marshal.FreeHGlobal(environmentBlock);
            if (inputRead != IntPtr.Zero) CloseHandle(inputRead);
            if (inputWrite != IntPtr.Zero) CloseHandle(inputWrite);
            if (outputRead != IntPtr.Zero) CloseHandle(outputRead);
            if (outputWrite != IntPtr.Zero) CloseHandle(outputWrite);
            if (pseudoConsole != IntPtr.Zero) ClosePseudoConsole(pseudoConsole);
        }
    }

    static string BuildSshArguments(string host, int port, string user, string authentication, string privateKeyPath)
    {
        List<string> args = new List<string>(new string[] {
            "-F", "NUL", "-tt", "-p", port.ToString(), "-l", user,
            "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
            "-o", "ClearAllForwardings=yes", "-o", "StrictHostKeyChecking=yes",
            "-o", "UserKnownHostsFile=" + KnownHostsPath, "-o", "GlobalKnownHostsFile=NUL"
        });
        if (authentication == "private-key")
        {
            args.AddRange(new string[] {
                "-o", "PreferredAuthentications=publickey", "-o", "PubkeyAuthentication=yes",
                "-o", "PasswordAuthentication=no", "-o", "KbdInteractiveAuthentication=no",
                "-o", "IdentityFile=none", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
                "-i", privateKeyPath, "-o", "NumberOfPasswordPrompts=3"
            });
        }
        else
        {
            args.AddRange(new string[] {
                "-o", "BatchMode=no", "-o", "PreferredAuthentications=password,keyboard-interactive",
                "-o", "PubkeyAuthentication=no", "-o", "NumberOfPasswordPrompts=3"
            });
        }
        args.Add(host);
        return JoinArguments(args.ToArray());
    }

    static string JoinArguments(string[] args)
    {
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < args.Length; i++) { if (i > 0) result.Append(' '); result.Append(QuoteArgument(args[i])); }
        return result.ToString();
    }

    static IntPtr BuildEnvironmentBlock(Dictionary<string, string> environment)
    {
        List<string> keys = new List<string>(environment.Keys);
        keys.Sort(StringComparer.OrdinalIgnoreCase);
        StringBuilder block = new StringBuilder();
        foreach (string key in keys) block.Append(key).Append('=').Append(environment[key] ?? "").Append('\0');
        block.Append('\0');
        byte[] bytes = Encoding.Unicode.GetBytes(block.ToString());
        IntPtr pointer = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, pointer, bytes.Length);
        return pointer;
    }

    static Dictionary<string, string> CurrentEnvironment()
    {
        Dictionary<string, string> result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
            result[String.Format("{0}", entry.Key)] = String.Format("{0}", entry.Value);
        return result;
    }

    static ScannedHostKey PickHostKey(string output, string host, int port)
    {
        Dictionary<string, int> rank = new Dictionary<string, int>(StringComparer.Ordinal) {
            { "ssh-ed25519", 0 }, { "ecdsa-sha2-nistp521", 1 }, { "ecdsa-sha2-nistp384", 2 },
            { "ecdsa-sha2-nistp256", 3 }, { "ssh-rsa", 4 }
        };
        ScannedHostKey best = null;
        int bestRank = int.MaxValue;
        foreach (string raw in (output ?? "").Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            string line = raw.Trim();
            if (line.Length == 0 || line.StartsWith("#", StringComparison.Ordinal)) continue;
            string[] parts = line.Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            int value;
            if (parts.Length < 3 || !rank.TryGetValue(parts[1], out value)) continue;
            try { Convert.FromBase64String(parts[2]); } catch { continue; }
            if (value >= bestRank) continue;
            bestRank = value;
            best = new ScannedHostKey {
                HostField = KnownHostField(host, port), Algorithm = parts[1], Key = parts[2], Fingerprint = Fingerprint(parts[2])
            };
        }
        return best;
    }

    static string TrustedFingerprint(string hostField)
    {
        try
        {
            if (!File.Exists(KnownHostsPath)) return "";
            foreach (string raw in File.ReadAllLines(KnownHostsPath, Encoding.UTF8))
            {
                string[] parts = raw.Trim().Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 3 && string.Equals(parts[0], hostField, StringComparison.OrdinalIgnoreCase)) return Fingerprint(parts[2]);
            }
        }
        catch { }
        return "";
    }

    static string Fingerprint(string base64Key)
    {
        byte[] key = Convert.FromBase64String(base64Key);
        using (SHA256 sha = SHA256.Create())
            return "SHA256:" + Convert.ToBase64String(sha.ComputeHash(key)).TrimEnd('=');
    }

    static string KnownHostField(string host, int port) { return port == 22 ? host : "[" + host + "]:" + port; }

    static string ValidateHost(string value)
    {
        string host = (value ?? "").Trim();
        if (host.Length >= 2 && host[0] == '[' && host[host.Length - 1] == ']')
            host = host.Substring(1, host.Length - 2);
        if (host.Length == 0 || host.Length > 253 || host[0] == '-') throw new InvalidOperationException("bad-ssh-host");
        foreach (char c in host)
            if (!(char.IsLetterOrDigit(c) || c == '.' || c == '-' || c == ':'))
                throw new InvalidOperationException("bad-ssh-host");
        return host;
    }

    static string ValidateAuthentication(string value)
    {
        string authentication = (value ?? "").Trim();
        if (authentication == "password" || authentication == "private-key") return authentication;
        throw new InvalidOperationException("bad-ssh-authentication");
    }

    static string ValidateUser(string value)
    {
        string user = (value ?? "").Trim();
        if (user.Length == 0 || user.Length > 128 || user[0] == '-') throw new InvalidOperationException("bad-ssh-user");
        foreach (char c in user)
            if (!(char.IsLetterOrDigit(c) || c == '.' || c == '_' || c == '-')) throw new InvalidOperationException("bad-ssh-user");
        return user;
    }

    static string ValidateAlgorithm(string value)
    {
        string algorithm = (value ?? "").Trim();
        string[] allowed = { "ssh-ed25519", "ecdsa-sha2-nistp521", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp256", "ssh-rsa" };
        foreach (string item in allowed) if (algorithm == item) return algorithm;
        throw new InvalidOperationException("bad-ssh-host-key-algorithm");
    }

    static string ValidateKey(string value)
    {
        string key = (value ?? "").Trim();
        if (key.Length == 0 || key.Length > 32 * 1024) throw new InvalidOperationException("bad-ssh-host-key");
        byte[] decoded;
        try { decoded = Convert.FromBase64String(key); } catch { throw new InvalidOperationException("bad-ssh-host-key"); }
        if (decoded.Length < 32 || decoded.Length > 16 * 1024) throw new InvalidOperationException("bad-ssh-host-key");
        return key;
    }

    static int ValidatePort(string value)
    {
        int port;
        if (!int.TryParse(value, out port) || port < 1 || port > 65535) throw new InvalidOperationException("bad-ssh-port");
        return port;
    }

    static int ClampNumber(string value, int min, int max, int fallback)
    {
        int number;
        if (!int.TryParse(value, out number)) return fallback;
        return Math.Max(min, Math.Min(max, number));
    }

    static string[] ReadBundle(byte[] body, int expected, int maxBytes)
    {
        if (body == null || body.Length == 0 || body.Length > maxBytes) throw new InvalidOperationException("bad-ssh-request");
        List<string> values = new List<string>();
        int offset = 0;
        while (offset < body.Length)
        {
            if (offset + 4 > body.Length) throw new InvalidOperationException("bad-ssh-request");
            int count = BitConverter.ToInt32(body, offset); offset += 4;
            if (count < 0 || offset + count > body.Length) throw new InvalidOperationException("bad-ssh-request");
            values.Add(Encoding.UTF8.GetString(body, offset, count)); offset += count;
        }
        if (values.Count != expected) throw new InvalidOperationException("bad-ssh-request");
        return values.ToArray();
    }

    static string FindOpenSsh(string name)
    {
        string system = Environment.GetFolderPath(Environment.SpecialFolder.System);
        string candidate = Path.Combine(system, "OpenSSH", name);
        if (File.Exists(candidate)) return candidate;
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string part in path.Split(';'))
        {
            try { candidate = Path.Combine(part.Trim(), name); if (File.Exists(candidate)) return candidate; } catch { }
        }
        return null;
    }

    static string QuoteArgument(string value)
    {
        if (value == null) return "\"\"";
        StringBuilder quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value)
        {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') { quoted.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            if (slashes > 0) { quoted.Append('\\', slashes); slashes = 0; }
            quoted.Append(ch);
        }
        if (slashes > 0) quoted.Append('\\', slashes * 2);
        return quoted.Append('"').ToString();
    }

    static string OneLine(string value)
    {
        string text = (value ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
        return text.Length > 300 ? text.Substring(0, 300) : text;
    }

    static string JsonString(string value)
    {
        if (value == null) return "null";
        StringBuilder result = new StringBuilder("\"");
        foreach (char ch in value)
        {
            if (ch == '"') result.Append("\\\"");
            else if (ch == '\\') result.Append("\\\\");
            else if (ch == '\b') result.Append("\\b");
            else if (ch == '\f') result.Append("\\f");
            else if (ch == '\n') result.Append("\\n");
            else if (ch == '\r') result.Append("\\r");
            else if (ch == '\t') result.Append("\\t");
            else if (ch < 32) result.Append("\\u").Append(((int)ch).ToString("x4"));
            else result.Append(ch);
        }
        return result.Append('"').ToString();
    }
}

static class ClassDockProgram
{
    [STAThread]
    static void Main()
    {
        if (ClassDockSshTerminal.TryRunAskPassHelper()) return;
        ClassDockLauncher.Run();
    }
}
