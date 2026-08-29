using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

class ClassDockLauncher
{
    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int dwProcessId);
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll")]
    static extern uint GetOEMCP();

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct BROWSEINFO
    {
        public IntPtr hwndOwner;
        public IntPtr pidlRoot;
        public IntPtr pszDisplayName;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpszTitle;
        public uint ulFlags;
        public IntPtr lpfn;
        public IntPtr lParam;
        public int iImage;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "SHBrowseForFolderW")]
    static extern IntPtr SHBrowseForFolder(ref BROWSEINFO info);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "SHGetPathFromIDListW")]
    static extern bool SHGetPathFromIDList(IntPtr pidl, StringBuilder path);
    [DllImport("ole32.dll")]
    static extern void CoTaskMemFree(IntPtr ptr);

    // ── 프로세스 트리(자기 자신 + 파이썬 커널·드라이버 등 자식) 메모리 측정용 ──
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }
    const uint TH32CS_SNAPPROCESS = 0x00000002;
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr hObject);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr hJob, int infoType, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }
    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

    static readonly string LocalAuthToken = CreateLocalAuthToken();
    static readonly byte[] Page = InjectLocalAuthToken(ReadResource("app.html"));
    static readonly byte[] PythonKernelRunner = ReadResource("python_kernel.py");
    static readonly byte[] NpmPackageRunner = ReadResource("npm_package_runner.js");
    static readonly object ConvLock = new object();   // PowerPoint 변환은 한 번에 하나만
    static readonly object MediaConvLock = new object();   // ffmpeg 영상 변환도 한 번에 하나만
    static readonly object FfmpegProbeLock = new object();
    static string _ffmpegCmd = null;                   // 찾은 ffmpeg 경로 캐시(없으면 매번 재탐색 — 나중에 놓아도 인식)
    static readonly object FfmpegInstallLock = new object();
    static volatile string _ffInstallState = "idle";   // idle | downloading | extracting | done | error
    static long _ffInstallReceived = 0;                // 내려받은 바이트(진행률 표시용 — 근사값이면 충분)
    static long _ffInstallTotal = 0;
    static volatile string _ffInstallError = "";
    static readonly object WorkspaceLock = new object();
    static readonly string WorkspacePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClassDock", "workspace.bin");
    // 브라우저 origin(포트) 변경과 무관하게 유지할 설정 저장소(localStorage 스냅샷 JSON).
    // 런처가 다른 포트로 떠도 테마·자동복원·탭 순서 등이 초기화되지 않도록 서버측 원본으로 삼는다.
    static readonly string AppStatePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClassDock", "app-state.json");
    static readonly string NpmPackageCachePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClassDock", "js-npm-packages");
    static readonly string NpmPackageRunnerPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClassDock", "npm-package-runner.js");
    static readonly object AppStateLock = new object();
    const int AppStateMaxBytes = 8 * 1024 * 1024;
    const int MaxHttpHeaderBytes = 64 * 1024;
    const int MaxHttpRequestBodyBytes = 1034 * 1024 * 1024;
    // 일반적인 수업용 데이터 분석은 허용하면서, 실수로 큰 배열을 반복 생성해 PC 전체가 멈추는 일을 줄인다.
    const long PythonProcessMemoryLimitBytes = 4096L * 1024 * 1024;
    // 지속형 노트북 커널은 프로세스가 살아 있어 일반 실행의 WaitForExit 제한을 타지 않는다.
    // 셀 하나가 무한 실행되는 상황을 막되, 데이터 분석 셀은 일반 스크립트보다 길 수 있어 10분을 허용한다.
    const int PythonKernelExecutionTimeoutMs = 10 * 60 * 1000;
    // 직전 인스턴스가 실제로 바인딩한 포트. 다음 실행이 후보 포트 전체를 HTTP 로 뒤지지 않고 이 한 곳만 확인해
    // 단일 인스턴스 여부를 빠르게 판단하도록 기록한다(기동 지연 방지).
    static readonly string InstancePortPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClassDock", "instance-port.txt");
    // 포트 파일 확인 전에 두 프로세스가 동시에 기동하는 경쟁을 막는다. 뮤텍스는 프로세스가
    // 강제 종료되어도 OS가 자동으로 해제하므로 별도의 종료 정리가 필요 없다.
    const string SingleInstanceMutexName = @"Local\ClassDock_SingleInstance";
    static Mutex SingleInstanceMutex;
    // 앱 모드(탭·주소창 없는 --app 창)로 열지 여부. 브라우저는 앱 화면이 뜨기 전에 실행되므로
    // 이 설정만은 localStorage 가 아니라 런처가 기동 중 읽을 수 있는 파일에 둔다. 값은 "1" 또는 "0".
    static readonly string AppModeConfigPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClassDock", "app-mode.txt");
    // 실행 중인 서버의 주소. 설정의 '지금 앱 모드로 열기'가 같은 origin 으로 새 창을 띄울 때 쓴다.
    static string ServerUrl = "";
    // 편집한 코드를 브라우저 권한 팝업 없이 바로 저장하는 폴더. 사용자가 바꾸지 않으면 내 문서\ClassDock 저장.
    static readonly string DefaultSaveRoot = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        "ClassDock 저장");
    static readonly string SaveRootConfigPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClassDock", "save-root.txt");
    static readonly object SaveRootLock = new object();
    static string SaveRoot = LoadSaveRoot();
    static readonly object ImageMemoLock = new object();
    static readonly object SaveRootPickerLock = new object();
    static string SaveRootPickerState = "idle";
    static string SaveRootPickerResult = "";
    // EXE의 '폴더 열기'는 브라우저 File System Access API 대신 Windows 폴더 선택창을 사용한다.
    // 브라우저 API가 숨기는 드라이브 포함 절대경로를 터미널 작업폴더로 전달하면서도,
    // 선택한 루트 밖의 파일에는 접근할 수 없도록 실행 중 발급한 ID로만 후속 요청을 받는다.
    static readonly object SourceFolderLock = new object();
    static readonly Dictionary<string, string> SourceFolders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    static readonly string SourceFolderConfigPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClassDock", "source-folders.txt");
    static readonly object SourceFolderPickerLock = new object();
    static string SourceFolderPickerState = "idle";
    static string SourceFolderPickerResult = "";
    static string SourceFolderPickerId = "";
    // 오프라인 실행용으로 번들된 Pyodide 코어 폴더(exe 옆 vendor/pyodide/). tools/download-pyodide.js 로 채운다.
    static readonly string PyodideDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "vendor", "pyodide");
    const int WorkspaceMaxBytes = 500 * 1024 * 1024;

    class WorkspaceFile
    {
        public string Path;
        public byte[] Data;
    }

    // 학생 코드의 무한 print가 서버 메모리와 폴링 응답을 계속 키우지 않도록 앞 4MB까지만 보관한다.
    // 진단·채점·단계 실행은 stdout 끝의 전용 마커 뒤 JSON을 사용하므로 그 구간만 별도 6MB까지 보존한다.
    class LimitedTextBuffer
    {
        const int HeadLimit = 4 * 1024 * 1024;
        const int ProtocolLimit = 6 * 1024 * 1024;
        const string Notice = "\n\n[출력이 4MB를 넘어 이후 내용은 생략했습니다. 실행은 계속됩니다.]\n";
        static readonly string[] Markers = { "__CLASSDOCK_DIAG__", "__CLASSDOCK_GRADE__", "__CLASSDOCK_TRACE__" };
        readonly object Sync = new object();
        readonly StringBuilder Head = new StringBuilder();
        readonly StringBuilder Protocol = new StringBuilder();
        string ScanTail = "";
        bool CapturingProtocol;
        bool Truncated;

        public void Append(char[] buffer, int offset, int count)
        {
            if (buffer == null || count <= 0) return;
            Append(new string(buffer, offset, count));
        }

        public void Append(string value)
        {
            string text = value ?? "";
            if (text.Length == 0) return;
            lock (Sync)
            {
                string combined = ScanTail + text;
                int markerAt = -1;
                for (int i = 0; i < Markers.Length; i++)
                    markerAt = Math.Max(markerAt, combined.LastIndexOf(Markers[i], StringComparison.Ordinal));
                if (markerAt >= 0)
                {
                    CapturingProtocol = true;
                    Protocol.Length = 0;
                    AppendProtocol(combined.Substring(markerAt));
                }
                else if (CapturingProtocol) AppendProtocol(text);

                int scanSize = 0;
                for (int i = 0; i < Markers.Length; i++) scanSize = Math.Max(scanSize, Markers[i].Length - 1);
                ScanTail = combined.Length > scanSize ? combined.Substring(combined.Length - scanSize) : combined;

                int remaining = HeadLimit - Head.Length;
                if (remaining > 0) Head.Append(text, 0, Math.Min(remaining, text.Length));
                if (text.Length > Math.Max(0, remaining)) Truncated = true;
            }
        }

        void AppendProtocol(string text)
        {
            int remaining = ProtocolLimit - Protocol.Length;
            if (remaining > 0) Protocol.Append(text, 0, Math.Min(remaining, text.Length));
        }

        public void AppendLine(string value)
        {
            Append((value ?? "") + Environment.NewLine);
        }

        public string GetText()
        {
            lock (Sync)
            {
                if (!Truncated) return Head.ToString();
                return Head.ToString() + Notice + (Protocol.Length > 0 ? Protocol.ToString() : "");
            }
        }

        // GetText() 결과의 길이만 문자열 생성 없이 계산 — 폴링의 "변경 없음" 판정용.
        // 버퍼는 덧붙이기 전용이라 길이가 같으면 내용도 같다.
        public int TextLength
        {
            get
            {
                lock (Sync)
                {
                    if (!Truncated) return Head.Length;
                    return Head.Length + Notice.Length + Protocol.Length;
                }
            }
        }

        // GetText() 논리 문자열(Head + [Notice + Protocol])에서 from 이후의 새 내용만 만든다.
        // 폴링마다 누적 출력 전체(최대 1MB+)를 복사·전송하지 않기 위한 증분 응답용.
        public string GetTextFrom(int from)
        {
            lock (Sync)
            {
                if (from <= 0) return GetText();
                StringBuilder sb = new StringBuilder();
                int headLen = Head.Length;
                if (from < headLen) sb.Append(Head.ToString(from, headLen - from));
                if (Truncated)
                {
                    int f2 = Math.Max(from - headLen, 0);
                    if (f2 < Notice.Length) sb.Append(Notice.Substring(f2));
                    int f3 = Math.Max(f2 - Notice.Length, 0);
                    if (f3 < Protocol.Length) sb.Append(Protocol.ToString(f3, Protocol.Length - f3));
                }
                return sb.ToString();
            }
        }
    }

    class PythonSession
    {
        public string Id;
        public Process Process;
        public readonly object Sync = new object();
        public readonly LimitedTextBuffer Stdout = new LimitedTextBuffer();
        public readonly LimitedTextBuffer Stderr = new LimitedTextBuffer();
        public bool Complete;
        public int ExitCode = -1;
        public string ImagesJson = "[]";
        public string VariablesJson = "[]";
        public string RunnerPath;
        public string PlotDir;
        public string TempRoot;
        public Dictionary<string, long> InitSize = new Dictionary<string, long>();   // 실행 전 입력 파일 크기
        public Dictionary<string, long> InitMtime = new Dictionary<string, long>();  // 실행 전 입력 파일 수정시각(Ticks)
        public string OutputsJson = "[]";                                            // 실행이 만든/바꾼 파일 목록
        public DateTime DoneAt = DateTime.MaxValue;                                   // 완료 시각(보존 정리용)
        public readonly List<int[]> Echoes = new List<int[]>();                       // stdout 속 입력 에코 구간 [시작,길이] — 프런트가 입력값만 다른 색으로 표시
    }

    static readonly object PySessionsLock = new object();
    static readonly Dictionary<string, PythonSession> PySessions = new Dictionary<string, PythonSession>();

    // pip 설치 1건. 로그를 프로세스가 끝날 때까지 붙들고 있으면 화면이 멈춘 것처럼 보이므로,
    // 파이썬 세션과 같은 방식으로 버퍼에 흘려 담고 프런트가 /pip-install-poll 로 증분만 받아간다.
    class PipJob
    {
        public string Id;
        public Process Process;
        public readonly object Sync = new object();
        public readonly LimitedTextBuffer Log = new LimitedTextBuffer();
        public bool Complete;
        public int ExitCode = -1;
        public bool CancelRequested;
        public DateTime DoneAt = DateTime.MaxValue;
    }

    static readonly object PipJobsLock = new object();
    static readonly Dictionary<string, PipJob> PipJobs = new Dictionary<string, PipJob>();

    // npm 설치·브라우저 번들 작업. 사용자 패키지 설치 스크립트는 helper가 --ignore-scripts로 차단한다.
    class NpmJob
    {
        public string Id;
        public Process Process;
        public readonly object Sync = new object();
        public readonly LimitedTextBuffer Log = new LimitedTextBuffer();
        public bool Complete;
        public int ExitCode = -1;
        public bool CancelRequested;
        public DateTime DoneAt = DateTime.MaxValue;
    }

    static readonly object NpmJobsLock = new object();
    static readonly Dictionary<string, NpmJob> NpmJobs = new Dictionary<string, NpmJob>();

    class TerminalSession
    {
        public string Id;
        public Process Process;
        public readonly object Sync = new object();
        public LimitedTextBuffer Stdout = new LimitedTextBuffer();
        public LimitedTextBuffer Stderr = new LimitedTextBuffer();
        public StreamWriter Input;
        public bool CommandRunning;
        public bool CommandComplete = true;
        public bool ShellExited;
        public int ExitCode = -1;
        public int Sequence;
        public string Cwd = "";
        public string Marker = "";
        public string ScriptPath = "";
        public bool CwdFallback;
        public IntPtr JobHandle = IntPtr.Zero;
        public bool StopRequested;
        public DateTime CommandStartedAt = DateTime.MaxValue;
        public DateTime LastUsed = DateTime.UtcNow;
        public DateTime DoneAt = DateTime.MaxValue;
    }

    static readonly object TerminalSessionsLock = new object();
    static readonly Dictionary<string, TerminalSession> TerminalSessions = new Dictionary<string, TerminalSession>();

    // 노트북 셀을 같은 전역 변수 공간에서 차례로 실행하는 지속형 로컬 Python 커널.
    // Selenium driver 같은 객체도 다음 셀까지 살아 있어 Jupyter와 같은 흐름으로 사용할 수 있다.
    class PythonKernel
    {
        public string Id;
        public Process Process;
        public readonly object ExecLock = new object();
        public readonly LimitedTextBuffer Stderr = new LimitedTextBuffer();
        public string RunnerPath;
        public string TempRoot;
        public DateTime LastUsed = DateTime.UtcNow;
    }

    static readonly object PyKernelsLock = new object();
    static readonly Dictionary<string, PythonKernel> PyKernels = new Dictionary<string, PythonKernel>();
    static readonly object HeartbeatLock = new object();
    static readonly Dictionary<string, DateTime> HeartbeatClients = new Dictionary<string, DateTime>();
    static bool HeartbeatRequired;
    static bool HeartbeatSeen;
    static DateTime HeartbeatStartedAt;
    static DateTime NoHeartbeatClientsSince = DateTime.MaxValue;
    // 기존 창에서 새 앱 창으로 넘어가는 동안 새 페이지의 스크립트가 로드될 시간을 보장한다.
    // 이 시간이 없으면 기존 창을 닫은 뒤 5초 안에 새 heartbeat가 오지 않을 때 서버가 먼저 종료될 수 있다.
    static DateTime BrowserHandoffUntil = DateTime.MinValue;

    static byte[] ReadResource(string name)
    {
        Assembly asm = Assembly.GetExecutingAssembly();
        string[] names = asm.GetManifestResourceNames();
        for (int i = 0; i < names.Length; i++)
        {
            if (names[i].EndsWith(name, StringComparison.OrdinalIgnoreCase))
            {
                using (Stream stream = asm.GetManifestResourceStream(names[i]))
                using (MemoryStream ms = new MemoryStream())
                {
                    stream.CopyTo(ms);
                    return ms.ToArray();
                }
            }
        }
        throw new InvalidOperationException("Embedded app.html was not found.");
    }

    static string CreateLocalAuthToken()
    {
        byte[] bytes = new byte[32];
        using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider())
        {
            rng.GetBytes(bytes);
        }
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    static byte[] InjectLocalAuthToken(byte[] page)
    {
        string html = Encoding.UTF8.GetString(page);
        string tokenScript = "<script>window.__CLASSDOCK_LOCAL_TOKEN__=" + JsonString(LocalAuthToken) + ";</script>\n";
        int at = html.IndexOf("<script", StringComparison.OrdinalIgnoreCase);
        if (at < 0) at = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
        if (at >= 0) html = html.Insert(at, tokenScript);
        else html = tokenScript + html;
        return Encoding.UTF8.GetBytes(html);
    }

    static string NormalizeSaveRoot(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path)) return null;
        try { return Path.GetFullPath(path.Trim()); }
        catch { return null; }
    }

    static string LoadSaveRoot()
    {
        try
        {
            if (File.Exists(SaveRootConfigPath))
            {
                string configured = NormalizeSaveRoot(File.ReadAllText(SaveRootConfigPath, Encoding.UTF8));
                if (!string.IsNullOrEmpty(configured)) return configured;
            }
        }
        catch { }
        return DefaultSaveRoot;
    }

    static string CurrentSaveRoot()
    {
        lock (SaveRootLock) { return SaveRoot; }
    }

    static void SetSaveRoot(string path)
    {
        string normalized = NormalizeSaveRoot(path);
        if (string.IsNullOrEmpty(normalized)) throw new InvalidDataException("invalid-save-root");
        Directory.CreateDirectory(normalized);
        string configDir = Path.GetDirectoryName(SaveRootConfigPath);
        if (!string.IsNullOrEmpty(configDir)) Directory.CreateDirectory(configDir);
        File.WriteAllText(SaveRootConfigPath, normalized, new UTF8Encoding(false));
        lock (SaveRootLock) { SaveRoot = normalized; }
    }

    static void OpenSaveRootFolder()
    {
        string root = CurrentSaveRoot();
        Directory.CreateDirectory(root);
        Process.Start(new ProcessStartInfo { FileName = root, UseShellExecute = true });
    }

    // 직전에 저장한 파일이 있는 폴더를 연다(가능하면 그 파일을 하이라이트).
    // rel 은 저장 루트 기준 상대경로. SafeRelPath 로 검증해 저장 루트 밖으로 벗어나지 못하게 한다.
    // 파일이 없으면 그 상위 폴더를, 그마저 없으면 저장 루트를 연다.
    static string OpenFileFolder(string rel)
    {
        string root = CurrentSaveRoot();
        string safe = SafeRelPath(rel ?? "");
        if (safe != null)
        {
            string full = Path.Combine(root, safe);
            if (File.Exists(full))
            {
                Process.Start("explorer.exe", "/select,\"" + full + "\"");   // 폴더를 열고 파일 선택
                return Path.GetDirectoryName(full);
            }
            string dir = Path.GetDirectoryName(full);
            if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir))
            {
                Process.Start(new ProcessStartInfo { FileName = dir, UseShellExecute = true });
                return dir;
            }
        }
        OpenSaveRootFolder();
        return root;
    }

    static void SetSaveRootPickerStatus(string state, string result)
    {
        lock (SaveRootPickerLock)
        {
            SaveRootPickerState = state;
            SaveRootPickerResult = result ?? "";
        }
    }

    static string RunSaveRootPickerProcess(string current)
    {
        string powershell = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            "WindowsPowerShell", "v1.0", "powershell.exe");
        if (!File.Exists(powershell)) powershell = "powershell.exe";
        string script =
            "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n" +
            "$shell = New-Object -ComObject Shell.Application\n" +
            "try {\n" +
            "  $folder = $shell.BrowseForFolder(0, 'ClassDock에서 파일을 자동 저장할 폴더를 선택하세요.', 81, 0)\n" +
            "  if ($null -ne $folder) { [Console]::Write($folder.Self.Path) }\n" +
            "} finally {\n" +
            "  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)\n" +
            "}\n";
        string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = powershell;
        psi.Arguments = "-NoLogo -NoProfile -STA -WindowStyle Hidden -EncodedCommand " + encoded;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = new UTF8Encoding(false);
        psi.StandardErrorEncoding = new UTF8Encoding(false);
        psi.EnvironmentVariables["MN_SAVE_ROOT"] = current;
        Process process = Process.Start(psi);
        if (process == null) throw new InvalidOperationException("folder-picker-process-failed");
        try
        {
            AllowSetForegroundWindow(process.Id);
            for (int i = 0; i < 40 && !process.HasExited; i++)
            {
                process.Refresh();
                IntPtr hwnd = process.MainWindowHandle;
                if (hwnd != IntPtr.Zero) { SetForegroundWindow(hwnd); break; }
                Thread.Sleep(50);
            }
            string output = process.StandardOutput.ReadToEnd();
            string error = process.StandardError.ReadToEnd();
            process.WaitForExit();
            if (process.ExitCode != 0) throw new InvalidOperationException("folder-picker-process-error: " + error.Trim());
            return output.Trim();
        }
        finally { process.Dispose(); }
    }

    static bool StartSaveRootPicker()
    {
        lock (SaveRootPickerLock)
        {
            if (SaveRootPickerState == "opening") return false;
            SaveRootPickerState = "opening";
            SaveRootPickerResult = "";
        }
        Thread dialogThread = new Thread(delegate()
        {
            try
            {
                string current = CurrentSaveRoot();
                Directory.CreateDirectory(current);
                string selected = RunSaveRootPickerProcess(current);
                if (!string.IsNullOrEmpty(selected))
                {
                    SetSaveRoot(selected);
                    SetSaveRootPickerStatus("saved", selected);
                }
                else SetSaveRootPickerStatus("cancelled", "");
            }
            catch (Exception ex) { SetSaveRootPickerStatus("error", FlattenMessage(ex)); }
        });
        dialogThread.SetApartmentState(ApartmentState.STA);
        dialogThread.IsBackground = true;
        dialogThread.Start();
        return true;
    }

    static string SaveRootPickerStatusJson()
    {
        lock (SaveRootPickerLock)
        {
            return "{\"state\":" + JsonString(SaveRootPickerState)
                + ",\"result\":" + JsonString(SaveRootPickerResult) + "}";
        }
    }

    static string RunSourceFolderPickerDialog()
    {
        IntPtr displayName = Marshal.AllocHGlobal(520);
        IntPtr pidl = IntPtr.Zero;
        try
        {
            BROWSEINFO info = new BROWSEINFO();
            // 사용자가 버튼을 누른 브라우저 창을 소유자로 지정해 선택창이 뒤에 숨지 않게 한다.
            info.hwndOwner = GetForegroundWindow();
            info.pszDisplayName = displayName;
            info.lpszTitle = "ClassDock에서 열 폴더를 선택하세요.";
            // BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE | BIF_EDITBOX | BIF_NONEWFOLDERBUTTON
            info.ulFlags = 1 | 64 | 16 | 512;
            pidl = SHBrowseForFolder(ref info);
            if (pidl == IntPtr.Zero) return "";
            StringBuilder selected = new StringBuilder(32768);
            if (!SHGetPathFromIDList(pidl, selected)) throw new InvalidOperationException("folder-path-unavailable");
            return selected.ToString().Trim();
        }
        finally
        {
            if (pidl != IntPtr.Zero) CoTaskMemFree(pidl);
            Marshal.FreeHGlobal(displayName);
        }
    }

    static void RememberSourceFolder(string path)
    {
        try
        {
            string normalized = Path.GetFullPath(path);
            string dir = Path.GetDirectoryName(SourceFolderConfigPath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            List<string> rows = new List<string>();
            if (File.Exists(SourceFolderConfigPath))
                foreach (string row in File.ReadAllLines(SourceFolderConfigPath, Encoding.UTF8))
                    try
                    {
                        string value = Path.GetFullPath(row.Trim());
                        if (Directory.Exists(value) && !rows.Exists(x => string.Equals(x, value, StringComparison.OrdinalIgnoreCase)))
                            rows.Add(value);
                    }
                    catch { }
            rows.RemoveAll(x => string.Equals(x, normalized, StringComparison.OrdinalIgnoreCase));
            rows.Insert(0, normalized);
            if (rows.Count > 64) rows.RemoveRange(64, rows.Count - 64);
            File.WriteAllLines(SourceFolderConfigPath, rows.ToArray(), new UTF8Encoding(false));
        }
        catch { }
    }

    static bool IsRememberedSourceFolder(string path)
    {
        try
        {
            string normalized = Path.GetFullPath(path);
            if (!File.Exists(SourceFolderConfigPath)) return false;
            foreach (string row in File.ReadAllLines(SourceFolderConfigPath, Encoding.UTF8))
                try
                {
                    if (string.Equals(Path.GetFullPath(row.Trim()), normalized, StringComparison.OrdinalIgnoreCase))
                        return true;
                }
                catch { }
        }
        catch { }
        return false;
    }

    static string RegisterSourceFolder(string path, bool remember)
    {
        string normalized = NormalizeSaveRoot(path);
        if (string.IsNullOrEmpty(normalized) || !Directory.Exists(normalized))
            throw new DirectoryNotFoundException("source-folder-not-found");
        lock (SourceFolderLock)
        {
            foreach (KeyValuePair<string, string> item in SourceFolders)
                if (string.Equals(item.Value, normalized, StringComparison.OrdinalIgnoreCase))
                {
                    if (remember) RememberSourceFolder(normalized);
                    return item.Key;
                }
            string id = Guid.NewGuid().ToString("N");
            SourceFolders[id] = normalized;
            if (remember) RememberSourceFolder(normalized);
            return id;
        }
    }

    static bool StartSourceFolderPicker()
    {
        lock (SourceFolderPickerLock)
        {
            if (SourceFolderPickerState == "opening") return false;
            SourceFolderPickerState = "opening";
            SourceFolderPickerResult = "";
            SourceFolderPickerId = "";
        }
        Thread dialogThread = new Thread(delegate()
        {
            try
            {
                string selected = RunSourceFolderPickerDialog();
                lock (SourceFolderPickerLock)
                {
                    if (string.IsNullOrEmpty(selected))
                    {
                        SourceFolderPickerState = "cancelled";
                    }
                    else
                    {
                        SourceFolderPickerResult = Path.GetFullPath(selected);
                        SourceFolderPickerId = RegisterSourceFolder(SourceFolderPickerResult, true);
                        SourceFolderPickerState = "saved";
                    }
                }
            }
            catch (Exception ex)
            {
                lock (SourceFolderPickerLock)
                {
                    SourceFolderPickerState = "error";
                    SourceFolderPickerResult = FlattenMessage(ex);
                    SourceFolderPickerId = "";
                }
            }
        });
        dialogThread.SetApartmentState(ApartmentState.STA);
        dialogThread.IsBackground = true;
        dialogThread.Start();
        return true;
    }

    static string SourceFolderPickerStatusJson()
    {
        lock (SourceFolderPickerLock)
        {
            return "{\"state\":" + JsonString(SourceFolderPickerState)
                + ",\"result\":" + JsonString(SourceFolderPickerResult)
                + ",\"id\":" + JsonString(SourceFolderPickerId) + "}";
        }
    }

    static string RestoreSourceFolderJson(byte[] body)
    {
        string path = Encoding.UTF8.GetString(body ?? new byte[0]).Trim();
        if (!IsRememberedSourceFolder(path)) throw new UnauthorizedAccessException("source-folder-not-remembered");
        string id = RegisterSourceFolder(path, false);
        return "{\"id\":" + JsonString(id) + ",\"path\":" + JsonString(Path.GetFullPath(path)) + "}";
    }

    static bool HasLocalActionHeader(Dictionary<string, string> headers)
    {
        string value;
        return headers != null && headers.TryGetValue("X-ClassDock-Action", out value) && value == "1";
    }

    static bool HasImageMemoHeader(Dictionary<string, string> headers)
    {
        string value;
        return headers != null && headers.TryGetValue("X-ClassDock-Image-Memo", out value) && value == "1";
    }

    static bool TokenEquals(string value)
    {
        if (value == null) return false;
        int diff = value.Length ^ LocalAuthToken.Length;
        for (int i = 0; i < LocalAuthToken.Length; i++)
        {
            char c = i < value.Length ? value[i] : '\0';
            diff |= c ^ LocalAuthToken[i];
        }
        return diff == 0;
    }

    static bool HasLocalAuthToken(Dictionary<string, string> headers)
    {
        string value;
        if (headers != null && headers.TryGetValue("X-ClassDock-Token", out value) && TokenEquals(value)) return true;
        return false;
    }

    // loopback에만 바인딩하더라도 DNS rebinding 등으로 다른 Host가 들어오는 요청은 받지 않는다.
    // 이 서버는 IPv4 loopback 전용이므로 Host도 localhost 또는 127.0.0.1만 허용한다.
    static bool HasAllowedLocalHost(Dictionary<string, string> headers)
    {
        string value;
        if (headers == null || !headers.TryGetValue("Host", out value) || string.IsNullOrWhiteSpace(value)) return false;
        string host = value.Trim().ToLowerInvariant();
        int colon = host.LastIndexOf(':');
        if (colon > 0) host = host.Substring(0, colon);
        return host == "127.0.0.1" || host == "localhost";
    }

    // 브라우저가 Origin을 보냈다면 현재 loopback origin과 일치해야 한다.
    // 일부 로컬 도구는 Origin을 생략하므로, 그 경우에는 실행별 토큰 검증을 계속 경계로 삼는다.
    static bool HasAllowedLocalOrigin(Dictionary<string, string> headers)
    {
        string origin, host;
        if (headers == null || !headers.TryGetValue("Origin", out origin) || string.IsNullOrWhiteSpace(origin)) return true;
        if (!headers.TryGetValue("Host", out host) || string.IsNullOrWhiteSpace(host)) return false;
        return string.Equals(origin.Trim(), "http://" + host.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    static bool RequiresLocalAuthToken(string method, string path)
    {
        if (method == "POST")
        {
            if (path.StartsWith("/workspace-save", StringComparison.Ordinal)) return true;
            if (path == "/workspace-clear" || path == "/workspace-remove") return true;
            if (path == "/convert-pptx" || path == "/convert-media" || path == "/install-ffmpeg") return true;
            if (path.StartsWith("/app-state", StringComparison.Ordinal)) return true;
            if (path == "/sqlite-preview" || path == "/sqlite-disk-preview" || path == "/sqlite-exec"
                || path == "/save-file" || path == "/save-file-exists") return true;
            if (path == "/open-save-folder" || path == "/open-file-folder" || path == "/choose-save-folder") return true;
            // 앱 모드: 설정 저장은 다음 실행 동작을 바꾸고, 재열기는 브라우저 프로세스를 띄운다 → 둘 다 토큰 필요.
            if (path.StartsWith("/launcher-config", StringComparison.Ordinal) || path == "/reopen-app-mode") return true;
            if (path == "/choose-source-folder" || path == "/source-folder-restore") return true;
            if (path.StartsWith("/source-folder-file", StringComparison.Ordinal)
                || path.StartsWith("/source-folder-directory", StringComparison.Ordinal)
                || path.StartsWith("/source-folder-remove", StringComparison.Ordinal)) return true;
            if (path == "/image-memo-delete") return true;
            if (path == "/complete" || path == "/definition") return true;
            if (path == "/python-project-sync") return true;
            if (path == "/exam-receive-start" || path == "/exam-receive-stop") return true;
            if (path.StartsWith("/pip-install", StringComparison.Ordinal)) return true;   // /pip-install, -start, -cancel
            if (path.StartsWith("/js-npm-", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/heartbeat", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/python-kernel-", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/python-session-", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/terminal-session-", StringComparison.Ordinal)) return true;
            if (path == "/terminal-complete") return true;
            if (path.StartsWith("/ssh-", StringComparison.Ordinal)) return true;
            if (path == "/run-python" || path == "/run-python-bundle") return true;
            if (path == "/python-rescan") return true;
            if (path == "/tile-cache-clear") return true;
            if (path.StartsWith("/map-search-key", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/map-search-provider", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/exchange-rate-key", StringComparison.Ordinal)) return true;
        }
        if (method == "GET")
        {
            if (path == "/workspace-load") return true;
            if (path.StartsWith("/exam-receive-status", StringComparison.Ordinal)) return true;
            if (path == "/save-root" || path == "/choose-save-folder-status") return true;
            if (path == "/launcher-config") return true;
            if (path == "/source-folder-capability" || path == "/choose-source-folder-status") return true;
            if (path.StartsWith("/source-folder-entry", StringComparison.Ordinal)
                || path.StartsWith("/source-folder-list", StringComparison.Ordinal)
                || path.StartsWith("/source-folder-file", StringComparison.Ordinal)) return true;
            if (path == "/image-memo-list" || path.StartsWith("/image-memo-file?", StringComparison.Ordinal)) return true;
            if (path == "/can-complete") return true;
            if (path == "/python-import-index") return true;
            if (path.StartsWith("/local-file?", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/python-kernel-file?", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/pip-install-poll", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/js-npm-", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/python-session-poll", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/python-session-file", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/terminal-session-poll", StringComparison.Ordinal)) return true;
            if (path == "/ssh-capability" || path == "/ssh-key-pick-status" || path == "/ssh-upload-pick-status"
                || path.StartsWith("/ssh-session-poll", StringComparison.Ordinal)
                || path.StartsWith("/ssh-upload-poll", StringComparison.Ordinal)) return true;
            if (path == "/tile-cache-status" || path == "/can-proxy-tiles") return true;
            if (path == "/map-search-key-status") return true;
            if (path.StartsWith("/geocode?", StringComparison.Ordinal)) return true;
            if (path == "/can-proxy-rates" || path == "/exchange-rate-key-status") return true;
            if (path.StartsWith("/exchange-rate?", StringComparison.Ordinal)) return true;
        }
        if (method == "DELETE" && (path == "/map-search-key" || path == "/exchange-rate-key")) return true;
        return false;
    }

    static bool IsImageMemoExtension(string ext)
    {
        ext = (ext ?? "").ToLowerInvariant();
        return ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp"
            || ext == ".gif" || ext == ".bmp" || ext == ".svg" || ext == ".avif";
    }

    static string ImageMemoContentType(string path)
    {
        string ext = Path.GetExtension(path).ToLowerInvariant();
        if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
        if (ext == ".webp") return "image/webp";
        if (ext == ".gif") return "image/gif";
        if (ext == ".bmp") return "image/bmp";
        if (ext == ".svg") return "image/svg+xml";
        if (ext == ".avif") return "image/avif";
        return "image/png";
    }

    static bool TryResolveImageMemoPath(string relativePath, out string fullPath)
    {
        fullPath = "";
        string safe = SafeRelPath(relativePath);
        if (safe == null || !IsImageMemoExtension(Path.GetExtension(safe))) return false;
        try
        {
            string root = Path.GetFullPath(CurrentSaveRoot());
            string memoRoot = Path.GetFullPath(Path.Combine(root, "이미지메모"));
            string candidate;
            if (!TryResolveSaveRootPath(safe, out candidate) || !IsPathInsideRoot(memoRoot, candidate, false)) return false;
            fullPath = candidate;
            return true;
        }
        catch { return false; }
    }

    static string ImageMemoListJson()
    {
        lock (ImageMemoLock)
        {
            try
            {
                string root = Path.GetFullPath(CurrentSaveRoot());
                string memoRoot = Path.Combine(root, "이미지메모");
                if (!Directory.Exists(memoRoot)) return "{\"items\":[],\"total\":0}";
                List<FileInfo> files = new List<FileInfo>();
                foreach (string path in Directory.GetFiles(memoRoot, "*", SearchOption.AllDirectories))
                {
                    if (!IsImageMemoExtension(Path.GetExtension(path))) continue;
                    try
                    {
                        FileInfo info = new FileInfo(path);
                        if (info.Length <= 0) continue;
                        files.Add(info);
                    }
                    catch { }
                }
                files.Sort(delegate(FileInfo a, FileInfo b) { return b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc); });
                int total = files.Count;
                int limit = Math.Min(total, 50);
                string rootPrefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
                DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                StringBuilder json = new StringBuilder();
                json.Append("{\"items\":[");
                for (int i = 0; i < limit; i++)
                {
                    if (i > 0) json.Append(',');
                    FileInfo info = files[i];
                    string rel = info.FullName.Substring(rootPrefix.Length).Replace('\\', '/');
                    long modified = (long)(info.LastWriteTimeUtc - epoch).TotalMilliseconds;
                    json.Append("{\"path\":").Append(JsonString(rel))
                        .Append(",\"name\":").Append(JsonString(info.Name))
                        .Append(",\"size\":").Append(info.Length)
                        .Append(",\"modified\":").Append(modified)
                        .Append('}');
                }
                json.Append("],\"total\":").Append(total).Append('}');
                return json.ToString();
            }
            catch { return "{\"items\":[],\"total\":0}"; }
        }
    }

    static bool TryReadImageMemo(string relativePath, out byte[] data, out string contentType)
    {
        data = null;
        contentType = "application/octet-stream";
        string full;
        if (!TryResolveImageMemoPath(relativePath, out full)) return false;
        lock (ImageMemoLock)
        {
            if (!File.Exists(full)) return false;
            FileInfo info = new FileInfo(full);
            if (info.Length <= 0 || info.Length > 200L * 1024 * 1024) return false;
            data = File.ReadAllBytes(full);
            contentType = ImageMemoContentType(full);
            return true;
        }
    }

    static bool DeleteImageMemo(string relativePath)
    {
        string full;
        if (!TryResolveImageMemoPath(relativePath, out full)) return false;
        lock (ImageMemoLock)
        {
            if (!File.Exists(full)) return false;
            File.Delete(full);
            string memoRoot = Path.GetFullPath(Path.Combine(CurrentSaveRoot(), "이미지메모"));
            string dir = Path.GetDirectoryName(full);
            while (!string.IsNullOrEmpty(dir) && !string.Equals(dir, memoRoot, StringComparison.OrdinalIgnoreCase))
            {
                if (Directory.GetFileSystemEntries(dir).Length != 0) break;
                Directory.Delete(dir);
                dir = Path.GetDirectoryName(dir);
            }
            return true;
        }
    }

    public static void Run()
    {
        // 안정적인 origin(포트) 확보용 고정 포트 후보 목록.
        // 브라우저 localStorage(테마·자동복원 설정·탭 순서 등)는 origin(127.0.0.1:포트)별로 갈리므로,
        // 매 실행 같은 포트로 떠야 설정이 유지된다. 첫 후보가 외부 앱/좀비 소켓에 막혀도 "랜덤"이 아니라
        // 다음 고정 후보로 결정적으로 떨어져, 같은 PC 는 재실행마다 같은 포트를 재사용한다.
        int[] candidatePorts = new int[] { 17645, 18645, 19645, 27645, 37645, 47645 };
        TcpListener listener = null;
        int port = 0;

        // 1) 직전 인스턴스가 기록해 둔 포트가 아직 우리 서버면 → 새로 띄우지 않고 그 origin 으로 브라우저만 열고 종료(단일 인스턴스).
        //    후보 포트 전체를 HTTP 로 확인하지 않고 "기록된 한 곳"만 확인하므로 기동이 빠르다.
        //    (예전엔 후보마다 /ping 을 시도해, 외부 앱/좀비 소켓이 점유한 포트에서 타임아웃이 쌓여 기동이 느렸다.)
        int remembered = ReadInstancePort();
        if (remembered > 0 && IsOurServerAt(remembered))
        {
            if (Environment.GetEnvironmentVariable("CLASSDOCK_NO_BROWSER") != "1")
            {
                try { OpenAppUrl("http://127.0.0.1:" + remembered + "/", LoadAppMode()); } catch {}
            }
            return;
        }

        // 포트 기록이 생기기 전 거의 동시에 실행된 경우에도 한 프로세스만 서버와 TEMP 청소를 맡는다.
        // 뒤에 온 프로세스는 먼저 온 프로세스가 포트를 기록할 때까지 잠시 기다린 뒤 브라우저만 연다.
        if (!TryAcquireSingleInstanceMutex())
        {
            for (int i = 0; i < 20; i++)
            {
                remembered = ReadInstancePort();
                if (remembered > 0 && IsOurServerAt(remembered))
                {
                    if (Environment.GetEnvironmentVariable("CLASSDOCK_NO_BROWSER") != "1")
                    {
                        try { OpenAppUrl("http://127.0.0.1:" + remembered + "/", LoadAppMode()); } catch { }
                    }
                    return;
                }
                Thread.Sleep(100);
            }
            return;
        }

        // 2) 바인딩 가능한 첫 후보 포트를 사용한다(HTTP 확인 없이 TCP 바인드만 시도 → 점유 포트도 즉시 실패라 빠름).
        //    결정적 순서라 같은 PC 는 재실행마다 같은 포트를 재사용 → origin 이 유지된다.
        foreach (int cand in candidatePorts)
        {
            try
            {
                TcpListener l = new TcpListener(IPAddress.Loopback, cand);
                l.Start();
                listener = l;
                port = cand;
                break;
            }
            catch { /* 이 포트는 점유됨 → 다음 후보 시도 */ }
        }

        // 3) 모든 후보가 막힌 드문 경우에만 최후로 임의 포트를 쓴다(이때만 origin 이 달라질 수 있음).
        if (listener == null)
        {
            listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            port = ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        WriteInstancePort(port);   // 다음 실행이 이 포트로 바로 붙을 수 있게 기록(단일 인스턴스 확인용)
        string url = "http://127.0.0.1:" + port + "/";
        ServerUrl = url;
        HeartbeatRequired = Environment.GetEnvironmentVariable("CLASSDOCK_NO_BROWSER") != "1";
        HeartbeatStartedAt = DateTime.UtcNow;

        // 지난 실행이 %TEMP% 에 남긴 고아 작업폴더 청소. 지울 양이 수백 MB 일 수 있어
        // 별도 스레드에서 처리한다 — 기동과 첫 화면을 붙잡지 않는다.
        Thread tempSweeper = new Thread(delegate() { try { SweepOrphanTempEntries(); } catch { } });
        tempSweeper.IsBackground = true;
        tempSweeper.Start();

        Console.WriteLine("============================================");
        Console.WriteLine("  ClassDock is running");
        Console.WriteLine("============================================");
        Console.WriteLine("  URL: " + url);
        Console.WriteLine("  Close this window to stop.");
        Console.WriteLine("============================================");

        // CLASSDOCK_NO_BROWSER=1 이면 자동 브라우저 실행을 끈다(테스트/자동화용).
        if (HeartbeatRequired)
        {
            Thread browser = new Thread(delegate()
            {
                Thread.Sleep(400);
                try
                {
                    OpenAppUrl(url, LoadAppMode());
                }
                catch (Exception ex)
                {
                    Console.WriteLine("Failed to open browser: " + ex.Message);
                }
            });
            browser.IsBackground = true;
            browser.Start();

            Thread heartbeatWatcher = new Thread(delegate()
            {
                while (true)
                {
                    Thread.Sleep(2000);
                    bool shouldExit = false;
                    lock (HeartbeatLock)
                    {
                        DateTime now = DateTime.UtcNow;
                        List<string> stale = new List<string>();
                        foreach (KeyValuePair<string, DateTime> client in HeartbeatClients)
                            if ((now - client.Value).TotalSeconds > 90) stale.Add(client.Key);
                        foreach (string id in stale) HeartbeatClients.Remove(id);

                        if (now < BrowserHandoffUntil) NoHeartbeatClientsSince = DateTime.MaxValue;
                        else if (HeartbeatClients.Count > 0) NoHeartbeatClientsSince = DateTime.MaxValue;
                        else if (HeartbeatSeen)
                        {
                            if (NoHeartbeatClientsSince == DateTime.MaxValue) NoHeartbeatClientsSince = now;
                            else if ((now - NoHeartbeatClientsSince).TotalSeconds >= 5) shouldExit = true;
                        }
                        else if ((now - HeartbeatStartedAt).TotalSeconds >= 45) shouldExit = true;
                    }
                    if (shouldExit)
                    {
                        CleanupOwnTempEntries();   // 이 실행이 만든 임시 작업폴더를 남기지 않고 종료
                        Environment.Exit(0);
                    }
                }
            });
            heartbeatWatcher.IsBackground = true;
            heartbeatWatcher.Start();
        }

        // 요청 핸들러 중에는 스레드를 오래 붙잡는 것이 많다 — SSH 롱폴(최대 500ms 대기),
        // 타일·지오코딩·환율의 동기 외부 HTTP, 파이썬 등 외부 프로세스 WaitForExit.
        // 스레드풀 기본 최소치는 코어 수뿐이고 그 위로는 초당 1~2개씩만 늘어나므로,
        // 지도를 열거나 파이썬을 돌리는 동안 SSH 키 입력 요청이 큐에서 수백ms~수초 대기하게 된다.
        // 최소치를 넉넉히 올려 둔다(최소치일 뿐 필요할 때만 실제로 생성되므로 평소 비용은 없다).
        try
        {
            int minWorker, minIo;
            ThreadPool.GetMinThreads(out minWorker, out minIo);
            int wantedWorker = Math.Max(64, Environment.ProcessorCount * 8);
            if (minWorker < wantedWorker) ThreadPool.SetMinThreads(wantedWorker, minIo);
        }
        catch { /* 최소치 조정 실패는 기능에 영향이 없다 */ }

        while (true)
        {
            TcpClient client = listener.AcceptTcpClient();
            // 브라우저의 상태 폴링마다 전용 Thread를 만들면 종료된 Thread의 OS 핸들이
            // GC 전까지 누적된다. SSH 폴링처럼 요청이 잦은 기능에서는 수만 개까지
            // 쌓여 askpass 보조 프로세스조차 시작하지 못하므로 재사용되는 스레드풀로 처리한다.
            if (!ThreadPool.QueueUserWorkItem(delegate(object state) { HandleClient((TcpClient)state); }, client))
                client.Close();
        }
    }

    // 한 TCP 연결로 여러 요청을 처리하기 위한 래퍼.
    //  - 읽기: 큰 덩어리로 당겨 와 버퍼에서 꺼내 준다. 헤더를 1바이트씩 recv 하던 비용이 사라지고,
    //          다음 요청의 앞부분을 함께 읽어 와도 버퍼에 남아 있어 잃지 않는다.
    //  - KeepAlive: 이번 응답 뒤에도 연결을 유지할지. WriteResponse 가 이 값으로 Connection 헤더를 정한다.
    //    본문을 끝까지 읽지 않고 빠져나가는 경로는 반드시 false 로 두어야 한다. 남은 본문 바이트를
    //    다음 요청의 헤더로 잘못 읽게 되기 때문이다.
    sealed class HttpConnectionStream : Stream
    {
        readonly Stream inner;
        readonly byte[] buffer = new byte[8192];
        int start, end;
        public bool KeepAlive = true;

        public HttpConnectionStream(Stream stream) { inner = stream; }

        bool Fill()
        {
            if (start < end) return true;
            start = 0;
            end = inner.Read(buffer, 0, buffer.Length);
            if (end <= 0) { end = 0; return false; }
            return true;
        }

        public override int ReadByte()
        {
            if (!Fill()) return -1;
            return buffer[start++];
        }

        public override int Read(byte[] target, int offset, int count)
        {
            if (count <= 0) return 0;
            if (!Fill()) return 0;
            int take = Math.Min(count, end - start);
            Buffer.BlockCopy(buffer, start, target, offset, take);
            start += take;
            return take;
        }

        public override void Write(byte[] source, int offset, int count) { inner.Write(source, offset, count); }
        public override void Flush() { inner.Flush(); }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return true; } }
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long value) { throw new NotSupportedException(); }
    }

    // 응답마다 연결을 끊으면(Connection: close) 먼저 끊은 서버 쪽에 TIME_WAIT 이 120초씩 쌓인다.
    // 요청이 잦은 SSH 폴링에서는 수백 개까지 누적되어, 브라우저가 다음 연결에 고른 포트가
    // 그 조합과 겹치면 SYN 이 무시되고 재전송(약 300ms → 600ms → …)으로 넘어간다.
    // 원격 터미널에서 간헐적으로 타자가 멈추던 원인이 이것이라 연결을 재사용한다.
    const int MaxRequestsPerConnection = 1000;

    static void HandleClient(TcpClient client)
    {
        try
        {
            using (client)
            using (NetworkStream raw = client.GetStream())
            {
                client.ReceiveTimeout = 30000;
                client.SendTimeout = 15000;
                client.NoDelay = true;   // 작은 응답이 Nagle 과 지연 ACK 에 걸려 늦게 나가지 않도록
                HttpConnectionStream stream = new HttpConnectionStream(raw);
                for (int served = 0; served < MaxRequestsPerConnection; served++)
                {
                    stream.KeepAlive = served + 1 < MaxRequestsPerConnection;
                    HandleRequest(stream);
                    if (!stream.KeepAlive) break;
                }
            }
        }
        catch { /* 연결 오류는 무시 */ }
    }

    static void HandleRequest(HttpConnectionStream stream)
    {
        {
            {
                // ---- 요청 헤더를 \r\n\r\n 까지 바이트 단위로 읽는다(바디는 바이너리라 StreamReader 금지) ----
                List<byte> head = new List<byte>(1024);
                bool headerComplete = false;
                int b;
                while ((b = stream.ReadByte()) != -1)
                {
                    head.Add((byte)b);
                    int n = head.Count;
                    if (n >= 4 && head[n - 4] == 13 && head[n - 3] == 10 && head[n - 2] == 13 && head[n - 1] == 10)
                    {
                        headerComplete = true;
                        break;
                    }
                    if (n > MaxHttpHeaderBytes)
                    {
                        stream.KeepAlive = false;   // 본문을 읽지 않고 끝내므로 연결을 재사용할 수 없다
                        WriteResponse(stream, "431 Request Header Fields Too Large", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("request-header-too-large"));
                        return;
                    }
                }
                // 재사용 중인 연결을 상대가 조용히 닫은 경우다. 오류가 아니므로 응답 없이 끝낸다.
                if (head.Count == 0)
                {
                    stream.KeepAlive = false;
                    return;
                }
                if (!headerComplete)
                {
                    stream.KeepAlive = false;
                    WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("incomplete-request-header"));
                    return;
                }
                string headerText = Encoding.ASCII.GetString(head.ToArray());
                string[] lines = headerText.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                string[] rp = (lines.Length > 0 ? lines[0] : "").Split(' ');
                string method = rp.Length > 0 ? rp[0] : "";
                string path = rp.Length > 1 ? rp[1] : "/";

                int contentLength = 0;
                Dictionary<string, string> headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                for (int i = 1; i < lines.Length; i++)
                {
                    int c = lines[i].IndexOf(':');
                    if (c <= 0) continue;
                    string key = lines[i].Substring(0, c).Trim();
                    string val = lines[i].Substring(c + 1).Trim();
                    headers[key] = val;
                    if (key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
                    {
                        if (!int.TryParse(val, out contentLength) || contentLength < 0)
                        {
                            stream.KeepAlive = false;
                            WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("invalid-content-length"));
                            return;
                        }
                    }
                }

                if (rp.Length < 3 || !rp[2].StartsWith("HTTP/", StringComparison.Ordinal) || !path.StartsWith("/", StringComparison.Ordinal))
                {
                    stream.KeepAlive = false;
                    WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("invalid-request-line"));
                    return;
                }
                // 연결 재사용 협상. HTTP/1.1 은 기본 유지, 1.0 은 명시할 때만 유지하고,
                // 어느 쪽이든 상대가 close 를 요구하면 따른다. Transfer-Encoding 은 지원하지 않으므로
                // 본문 길이를 알 수 없는 요청도 재사용 대상에서 뺀다.
                string connectionHeader;
                if (!headers.TryGetValue("Connection", out connectionHeader)) connectionHeader = "";
                if (connectionHeader.IndexOf("close", StringComparison.OrdinalIgnoreCase) >= 0) stream.KeepAlive = false;
                else if (!rp[2].StartsWith("HTTP/1.1", StringComparison.Ordinal)
                    && connectionHeader.IndexOf("keep-alive", StringComparison.OrdinalIgnoreCase) < 0) stream.KeepAlive = false;
                if (headers.ContainsKey("Transfer-Encoding")) stream.KeepAlive = false;
                if (!HasAllowedLocalHost(headers))
                {
                    stream.KeepAlive = false;
                    WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("invalid-local-host"));
                    return;
                }
                // 지도 스냅샷의 sandbox iframe은 Origin: null로 /tile-proxy만 호출한다.
                // 해당 프록시는 별도 목적지 allowlist로 보호하므로 이 경로만 예외로 둔다.
                if (!HasAllowedLocalOrigin(headers) && !path.StartsWith("/tile-proxy", StringComparison.Ordinal))
                {
                    stream.KeepAlive = false;
                    WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("invalid-local-origin"));
                    return;
                }
                if (contentLength > MaxHttpRequestBodyBytes)
                {
                    stream.KeepAlive = false;
                    WriteResponse(stream, "413 Payload Too Large", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("request-body-too-large"));
                    return;
                }
                // 인증 실패 요청은 본문을 읽지 않는다. 큰 무단 요청으로 메모리·I/O를 점유하는 것을 막는다.
                // 본문이 스트림에 남으므로 연결도 재사용하지 않는다.
                if (RequiresLocalAuthToken(method, path) && !HasLocalAuthToken(headers))
                {
                    stream.KeepAlive = false;
                    WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("local-token-required"));
                    return;
                }

                // ---- 바디(있으면) 읽기 ----
                byte[] body = new byte[0];
                if (contentLength > 0)
                {
                    body = new byte[contentLength];
                    int read = 0;
                    while (read < contentLength)
                    {
                        int got = stream.Read(body, read, contentLength - read);
                        if (got <= 0) break;
                        read += got;
                    }
                    // 본문을 다 받지 못했으면 스트림 위치를 신뢰할 수 없다. 연결을 재사용하지 않는다.
                    if (read != contentLength) { body = new byte[0]; stream.KeepAlive = false; }
                }

                // ---- 라우팅 ----
                if (method == "OPTIONS" && path.StartsWith("/tile-proxy", StringComparison.Ordinal))
                {
                    // sandbox(origin null) iframe 의 fetch 는 사설 주소(127.0.0.1)라 CORS/PNA 사전 요청을 보낸다.
                    // 이걸 허용해 줘야 지도 스냅샷의 타일 프록시 fetch 가 통과한다.
                    string preflight =
                        "HTTP/1.1 204 No Content\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Access-Control-Allow-Methods: GET, OPTIONS\r\n" +
                        "Access-Control-Allow-Headers: *\r\n" +
                        "Access-Control-Allow-Private-Network: true\r\n" +
                        "Access-Control-Max-Age: 600\r\n" +
                        "Content-Length: 0\r\n" +
                        (stream.KeepAlive ? "Connection: keep-alive\r\n" : "Connection: close\r\n") +
                        "\r\n";
                    byte[] preflightBytes = Encoding.ASCII.GetBytes(preflight);
                    stream.Write(preflightBytes, 0, preflightBytes.Length);
                }
                else if (method == "POST" && path.StartsWith("/workspace-save", StringComparison.Ordinal))
                {
                    if (!headers.ContainsKey("X-ClassDock-Workspace"))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("workspace-header-required"));
                        return;
                    }
                    try
                    {
                        bool replace = path.IndexOf("replace=1", StringComparison.OrdinalIgnoreCase) >= 0;
                        int count = SaveWorkspace(body, replace);
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(count.ToString()));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("workspace-save-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path == "/workspace-load")
                {
                    byte[] saved = LoadWorkspace();
                    WriteResponse(stream, "200 OK", "application/octet-stream", saved);
                }
                else if (method == "POST" && path == "/workspace-clear")
                {
                    if (!headers.ContainsKey("X-ClassDock-Workspace"))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("workspace-header-required"));
                        return;
                    }
                    ClearWorkspace();
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "POST" && path == "/workspace-remove")
                {
                    if (!headers.ContainsKey("X-ClassDock-Workspace"))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("workspace-header-required"));
                        return;
                    }
                    try
                    {
                        int count = RemoveWorkspaceFiles(body);
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(count.ToString()));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("workspace-remove-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/convert-pptx")
                {
                    if (body.Length == 0)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("empty-body"));
                        return;
                    }
                    try
                    {
                        byte[] pdf;
                        lock (ConvLock) { pdf = ConvertPptxToPdf(body); }
                        WriteResponse(stream, "200 OK", "application/pdf", pdf);
                    }
                    catch (PowerPointMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-powerpoint"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("convert-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path.StartsWith("/app-state", StringComparison.Ordinal))
                {
                    // origin(포트) 무관 설정 복원용. 저장분이 없으면 빈 객체.
                    byte[] json = Encoding.UTF8.GetBytes(LoadAppState());
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", json);
                }
                else if (method == "POST" && path.StartsWith("/app-state", StringComparison.Ordinal))
                {
                    try
                    {
                        SaveAppState(body);
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("state-save-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (path == "/ping")
                {
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "POST" && path.StartsWith("/heartbeat?", StringComparison.Ordinal))
                {
                    if (!headers.ContainsKey("X-ClassDock-Heartbeat"))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("heartbeat-header-required"));
                        return;
                    }
                    TouchHeartbeatClient(QueryValue(path, "id"));
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "POST" && path.StartsWith("/heartbeat-close?", StringComparison.Ordinal))
                {
                    if (!headers.ContainsKey("X-ClassDock-Heartbeat"))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("heartbeat-header-required"));
                        return;
                    }
                    CloseHeartbeatClient(QueryValue(path, "id"));
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (path == "/can-convert")
                {
                    // 변환 백엔드(PowerPoint) 사용 가능 여부를 빠르게 알려준다(앱이 미리 분기 가능)
                    bool ok = Type.GetTypeFromProgID("PowerPoint.Application") != null;
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(ok ? "yes" : "no"));
                }
                else if (path == "/can-convert-media")
                {
                    // ffmpeg 사용 가능 여부(브라우저 미지원 코덱 영상 → MP4 변환). exe 옆 또는 PATH 에서 찾는다.
                    bool ok = FindFfmpeg() != null;
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(ok ? "yes" : "no"));
                }
                else if (method == "POST" && path == "/convert-media")
                {
                    if (body.Length == 0)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("empty-body"));
                        return;
                    }
                    try
                    {
                        byte[] mp4;
                        lock (MediaConvLock) { mp4 = ConvertMediaToMp4(body); }
                        WriteResponse(stream, "200 OK", "video/mp4", mp4);
                    }
                    catch (FfmpegMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-ffmpeg"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("convert-media-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/install-ffmpeg")
                {
                    // ffmpeg 원클릭 설치: 공식 배포 zip 을 내려받아 ffmpeg.exe 만 exe 옆에 놓는다(백그라운드).
                    if (FindFfmpeg() != null)
                    {
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                    }
                    else
                    {
                        lock (FfmpegInstallLock)
                        {
                            if (_ffInstallState != "downloading" && _ffInstallState != "extracting")
                            {
                                _ffInstallState = "downloading"; _ffInstallReceived = 0; _ffInstallTotal = 0; _ffInstallError = "";
                                Thread th = new Thread(InstallFfmpegWorker);
                                th.IsBackground = true;
                                th.Start();
                            }
                        }
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("started"));
                    }
                }
                else if (path == "/ffmpeg-install-status")
                {
                    string json = "{\"state\":" + JsonString(_ffInstallState)
                        + ",\"received\":" + Interlocked.Read(ref _ffInstallReceived)
                        + ",\"total\":" + Interlocked.Read(ref _ffInstallTotal)
                        + ",\"error\":" + JsonString(_ffInstallError) + "}";
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                }
                else if (path == "/can-run-python")
                {
                    // 로컬에 파이썬이 설치돼 있는지 알려준다(앱이 로컬 실행/Pyodide 분기)
                    bool ok = FindPython() != null;
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(ok ? "yes" : "no"));
                }
                else if (path == "/python-diagnostics")
                {
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(PythonDiagnostics()));
                }
                else if (method == "POST" && path == "/python-rescan")
                {
                    // 파이썬을 새로 설치한 사용자가 exe 를 껐다 켜지 않아도 되도록 캐시를 비우고 다시 찾는다.
                    ResetPythonProbe();
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(PythonDiagnostics()));
                }
                else if (path == "/mem")
                {
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(MemoryStatsJson()));
                }
                else if (method == "POST" && path == "/sqlite-preview")
                {
                    try
                    {
                        if (body.Length > 100 * 1024 * 1024)
                        {
                            WriteResponse(stream, "413 Payload Too Large", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("sqlite-too-large"));
                            return;
                        }
                        string json = SqlitePreview(body);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (InvalidDataException)
                    {
                        WriteResponse(stream, "415 Unsupported Media Type", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("not-sqlite3"));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("sqlite-preview-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/sqlite-disk-preview")
                {
                    // 저장 루트의 실제 DB를 읽는다. 최초 편집 활성화 때는 브라우저가 연 파일의 SHA-256과
                    // 디스크 파일이 일치해야 하며, 이후 새로고침은 이미 확인된 같은 상대경로를 다시 읽는다.
                    try
                    {
                        string json = SqliteDiskPreview(headers);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (FileNotFoundException)
                    {
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("db-not-found"));
                    }
                    catch (DbMismatchException)
                    {
                        WriteResponse(stream, "409 Conflict", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("db-changed"));
                    }
                    catch (InvalidDataException)
                    {
                        WriteResponse(stream, "415 Unsupported Media Type", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("not-sqlite3"));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("sqlite-disk-preview-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/sqlite-exec")
                {
                    // 워크스페이스에 저장된 .db 원본에 임의 SQL(SELECT/DDL/DML)을 실행한다.
                    // 경로는 X-Db-Path(퍼센트 인코딩, 저장 루트 기준 상대경로), SQL 은 본문 텍스트.
                    // 실행은 단일 트랜잭션으로 처리하고 수정 계열이면 같은 폴더에 일관된 .bak 백업을 남긴다.
                    try
                    {
                        if (body.Length > 2 * 1024 * 1024)
                        {
                            WriteResponse(stream, "413 Payload Too Large", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("sql-too-large"));
                            return;
                        }
                        string json = SqliteExec(headers, body);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (FileNotFoundException)
                    {
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("db-not-found"));
                    }
                    catch (DbMismatchException)
                    {
                        WriteResponse(stream, "409 Conflict", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("db-changed"));
                    }
                    catch (InvalidDataException)
                    {
                        WriteResponse(stream, "415 Unsupported Media Type", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("not-sqlite3"));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("sqlite-exec-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (path == "/can-save-file")
                {
                    // exe 로컬 서버가 디스크 저장을 지원함을 알린다(앱이 브라우저 권한 팝업 대신 서버 저장 선택)
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("yes"));
                }
                else if (method == "GET" && path == "/launcher-config")
                {
                    // 설정 화면이 '앱 모드' 체크박스의 현재 값과 지원 여부를 읽어간다.
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    string json = "{\"appMode\":" + (LoadAppMode() ? "true" : "false")
                        + ",\"appModeAvailable\":" + (FindChromiumBrowser() != null ? "true" : "false") + "}";
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                }
                else if (method == "POST" && path.StartsWith("/launcher-config", StringComparison.Ordinal))
                {
                    // '앱 모드' 토글 저장. 브라우저는 이미 떠 있으므로 이 값은 다음 실행부터 반영된다.
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    try
                    {
                        SaveAppMode(QueryValue(path, "appMode") == "1");
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("launcher-config-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/reopen-app-mode")
                {
                    // 설정의 '지금 앱 모드로 열기': 지금 실행 중인 서버를 --app 창으로 한 번 더 연다.
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    if (FindChromiumBrowser() == null)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-chromium"));
                        return;
                    }
                    try
                    {
                        lock (HeartbeatLock)
                        {
                            // EXE의 모든 스크립트를 읽은 뒤 heartbeat가 시작되므로 느린 PC에서도 충분히 기다린다.
                            BrowserHandoffUntil = DateTime.UtcNow.AddSeconds(45);
                            NoHeartbeatClientsSince = DateTime.MaxValue;
                        }
                        OpenAppUrl(string.IsNullOrEmpty(ServerUrl) ? "http://127.0.0.1/" : ServerUrl, true);
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("reopen-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path == "/save-root")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(CurrentSaveRoot()));
                }
                else if (method == "POST" && path == "/open-save-folder")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    try
                    {
                        OpenSaveRootFolder();
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(CurrentSaveRoot()));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("open-folder-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/open-file-folder")
                {
                    // 헤더 '저장 폴더' 버튼: 직전에 저장한 파일이 있는 폴더를 연다(X-Save-Path = 저장 루트 기준 상대경로).
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    try
                    {
                        string rel = headers.ContainsKey("X-Save-Path") ? Uri.UnescapeDataString(headers["X-Save-Path"]) : "";
                        string opened = OpenFileFolder(rel);
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(opened ?? CurrentSaveRoot()));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("open-folder-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/choose-save-folder")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    bool started = StartSaveRootPicker();
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(started ? "opened" : "opening"));
                }
                else if (method == "GET" && path == "/choose-save-folder-status")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(SaveRootPickerStatusJson()));
                }
                else if (method == "GET" && path == "/source-folder-capability")
                {
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("yes"));
                }
                else if (method == "POST" && path == "/choose-source-folder")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    bool started = StartSourceFolderPicker();
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(started ? "opened" : "opening"));
                }
                else if (method == "GET" && path == "/choose-source-folder-status")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(SourceFolderPickerStatusJson()));
                }
                else if (method == "POST" && path == "/source-folder-restore")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    try
                    {
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(RestoreSourceFolderJson(body)));
                    }
                    catch (UnauthorizedAccessException ex)
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(FlattenMessage(ex)));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("source-folder-restore-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path.StartsWith("/source-folder-entry?", StringComparison.Ordinal))
                {
                    try
                    {
                        string json = SourceFolderEntryJson(QueryValue(path, "id"), QueryValue(path, "path"));
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (FileNotFoundException ex)
                    {
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(FlattenMessage(ex)));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path.StartsWith("/source-folder-list?", StringComparison.Ordinal))
                {
                    try
                    {
                        string json = SourceFolderListJson(QueryValue(path, "id"), QueryValue(path, "path"));
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (DirectoryNotFoundException ex)
                    {
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(FlattenMessage(ex)));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path.StartsWith("/source-folder-file?", StringComparison.Ordinal))
                {
                    try
                    {
                        byte[] bytes = ReadSourceFolderFile(QueryValue(path, "id"), QueryValue(path, "path"));
                        WriteResponse(stream, "200 OK", "application/octet-stream", bytes);
                    }
                    catch (FileNotFoundException ex)
                    {
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(FlattenMessage(ex)));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path.StartsWith("/source-folder-file?", StringComparison.Ordinal))
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    try
                    {
                        WriteSourceFolderFile(QueryValue(path, "id"), QueryValue(path, "path"), body);
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("source-file-write-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path.StartsWith("/source-folder-directory?", StringComparison.Ordinal))
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    try
                    {
                        CreateSourceFolderDirectory(QueryValue(path, "id"), QueryValue(path, "path"));
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("source-directory-create-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path.StartsWith("/source-folder-remove?", StringComparison.Ordinal))
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    try
                    {
                        RemoveSourceFolderEntry(
                            QueryValue(path, "id"),
                            QueryValue(path, "path"),
                            QueryValue(path, "recursive") == "1");
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                    }
                    catch (FileNotFoundException ex)
                    {
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(FlattenMessage(ex)));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("source-entry-remove-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path == "/image-memo-list")
                {
                    if (!HasImageMemoHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("image-memo-header-required"));
                        return;
                    }
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(ImageMemoListJson()));
                }
                else if (method == "GET" && path.StartsWith("/image-memo-file?", StringComparison.Ordinal))
                {
                    if (!HasImageMemoHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("image-memo-header-required"));
                        return;
                    }
                    byte[] imageData;
                    string imageType;
                    if (TryReadImageMemo(QueryValue(path, "path"), out imageData, out imageType))
                        WriteResponse(stream, "200 OK", imageType, imageData);
                    else
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("image-memo-not-found"));
                }
                else if (method == "POST" && path == "/image-memo-delete")
                {
                    if (!HasImageMemoHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("image-memo-header-required"));
                        return;
                    }
                    try
                    {
                        string rel = headers.ContainsKey("X-Image-Memo-Path") ? Uri.UnescapeDataString(headers["X-Image-Memo-Path"]) : "";
                        if (!DeleteImageMemo(rel))
                        {
                            WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("image-memo-not-found"));
                            return;
                        }
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("deleted"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("image-memo-delete-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/save-file-exists")
                {
                    // 새 문서의 첫 저장 전에 SaveRoot의 기존 파일과 충돌하는지 확인한다.
                    try
                    {
                        string rel = headers.ContainsKey("X-Save-Path") ? Uri.UnescapeDataString(headers["X-Save-Path"]) : "";
                        string safe = SafeRelPath(rel);
                        string full;
                        if (safe == null || !TryResolveSaveRootPath(safe, out full))
                        {
                            WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("invalid-save-path"));
                            return;
                        }
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8",
                            Encoding.UTF8.GetBytes(File.Exists(full) ? "yes" : "no"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8",
                            Encoding.UTF8.GetBytes("save-exists-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/save-file")
                {
                    // 편집한 파일을 SaveRoot 아래에 바로 쓴다. 경로는 X-Save-Path(퍼센트 인코딩), 내용은 본문.
                    try
                    {
                        string rel = headers.ContainsKey("X-Save-Path") ? Uri.UnescapeDataString(headers["X-Save-Path"]) : "";
                        string safe = SafeRelPath(rel);
                        if (safe == null) safe = "practice.py";
                        string full;
                        if (!TryResolveSaveRootPath(safe, out full))
                        {
                            WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("invalid-save-path"));
                            return;
                        }
                        string dir = Path.GetDirectoryName(full);
                        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                        File.WriteAllBytes(full, body);
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(full));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("save-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (path == "/can-complete")
                {
                    // 로컬 파이썬 + Jedi 사용 가능 여부(없으면 1회 설치 시도). 프런트가 에디터 시작 시 백그라운드로 호출.
                    bool ok = false;
                    try { ok = EnsureJedi(); } catch { ok = false; }
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(ok ? "yes" : "no"));
                }
                else if (method == "GET" && path == "/python-import-index")
                {
                    // 설치된 패키지의 메타데이터와 Python 소스만 읽어 만든 자동 import 색인.
                    // 실제 패키지 import/실행은 하지 않으며, 생성 작업은 백그라운드에서 한 번만 한다.
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(PythonImportIndexJson()));
                }
                else if (method == "POST" && path == "/exam-receive-start")
                {
                    // 선생님이 [제출 받기]를 켠다. 본문 JSON = {examId, title} — examId 가 있으면 그 시험만 받는다.
                    string bodyText = "";
                    try { bodyText = Encoding.UTF8.GetString(body); } catch { }
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8",
                        Encoding.UTF8.GetBytes(ExamReceiveStart(ExamJsonString(bodyText, "examId"), ExamJsonString(bodyText, "title"))));
                }
                else if (method == "POST" && path == "/exam-receive-stop")
                {
                    ExamReceiveStop();
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"open\":false}"));
                }
                else if (method == "GET" && path.StartsWith("/exam-receive-status", StringComparison.Ordinal))
                {
                    int since = 0;
                    int qm = path.IndexOf('?');
                    if (qm >= 0)
                    {
                        foreach (string part in path.Substring(qm + 1).Split('&'))
                        {
                            if (part.StartsWith("since=", StringComparison.Ordinal)) int.TryParse(part.Substring(6), out since);
                        }
                    }
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(ExamReceiveStatusJson(since)));
                }
                else if (method == "POST" && path == "/python-project-sync")
                {
                    // 작업공간의 .py 를 임시 폴더에 미러링 → 다음 자동완성부터 Jedi 가 프로젝트 모듈을 안다.
                    try
                    {
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(SyncPythonProjectMirror(body)));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("project-sync-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/complete")
                {
                    // Jedi 문맥 자동완성. 본문 JSON = {source, line(1-based), column(0-based)}. 결과 JSON = {ok, items:[{name,type}]}
                    try
                    {
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(JediComplete(body)));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("complete-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/definition")
                {
                    // Jedi 정의 위치. 본문 JSON = {source, line(1-based), column(0-based)}.
                    try
                    {
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(JediDefinition(body)));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("definition-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (path.StartsWith("/local-file?", StringComparison.Ordinal))
                {
                    try
                    {
                        byte[] fileData;
                        string fileName;
                        if (TryReadLocalFile(QueryValue(path, "path"), out fileData, out fileName))
                            WriteResponse(stream, "200 OK", "application/octet-stream", fileData);
                        else
                            // 자동 복원·정의 이동은 없어졌거나 지원하지 않는 로컬 파일을 정상적인 폴백으로 취급한다.
                            // 404는 브라우저 개발자 도구에 불필요한 빨간 오류를 남기므로 빈 성공 응답으로 알린다.
                            WriteResponse(stream, "204 No Content", "application/octet-stream", new byte[0]);
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("file-read-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (path.StartsWith("/pyodide/", StringComparison.Ordinal))
                {
                    // 번들된 Pyodide 코어를 로컬에서 서빙(오프라인 실행용). 없으면 404 → 앱이 CDN 으로 폴백.
                    try
                    {
                        byte[] pyData;
                        string pyType;
                        if (TryReadPyodideFile(path, out pyData, out pyType))
                            WriteResponse(stream, "200 OK", pyType, pyData);
                        else
                            WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("pyodide-not-bundled"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("pyodide-read-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path == "/js-npm-status")
                {
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(JsNpmStatus()));
                }
                else if (method == "GET" && path == "/js-npm-list")
                {
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(ListJsNpmPackages()));
                }
                else if (method == "GET" && path.StartsWith("/js-npm-bundle?", StringComparison.Ordinal))
                {
                    byte[] bundle;
                    if (TryReadJsNpmBundle(QueryValue(path, "id"), out bundle))
                        WriteResponse(stream, "200 OK", "text/javascript; charset=utf-8", bundle);
                    else
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("npm-package-not-found"));
                }
                else if (method == "POST" && path == "/js-npm-install-start")
                {
                    string confirmed;
                    if (!headers.TryGetValue("x-classdock-npm-confirm", out confirmed) || confirmed != "1")
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("npm-confirmation-required"));
                        return;
                    }
                    try
                    {
                        string json = StartJsNpmInstall(body);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("npm-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path.StartsWith("/js-npm-install-poll", StringComparison.Ordinal))
                {
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8",
                        Encoding.UTF8.GetBytes(PollJsNpmInstall(QueryValue(path, "id"), QueryValue(path, "from"))));
                }
                else if (method == "POST" && path.StartsWith("/js-npm-install-cancel", StringComparison.Ordinal))
                {
                    CancelJsNpmInstall(QueryValue(path, "id"));
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "POST" && path.StartsWith("/js-npm-delete", StringComparison.Ordinal))
                {
                    bool deleted = DeleteJsNpmPackage(QueryValue(path, "id"));
                    WriteResponse(stream, deleted ? "200 OK" : "404 Not Found", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes(deleted ? "ok" : "npm-package-not-found"));
                }
                else if (method == "POST" && path == "/pip-install")
                {
                    string pipConfirmed;
                    if (!headers.TryGetValue("x-classdock-pip-confirm", out pipConfirmed) || pipConfirmed != "1")
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("pip-confirmation-required"));
                        return;
                    }
                    // 설치된 파이썬에 패키지 설치(pip). 본문 = 공백/줄바꿈으로 구분한 패키지 이름들.
                    try
                    {
                        string json = PipInstall(body);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("pip-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/pip-install-start")
                {
                    string pipConfirmed;
                    if (!headers.TryGetValue("x-classdock-pip-confirm", out pipConfirmed) || pipConfirmed != "1")
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("pip-confirmation-required"));
                        return;
                    }
                    // 설치를 시작만 하고 즉시 id 를 돌려준다 — 로그는 /pip-install-poll 로 흘려 보낸다.
                    try
                    {
                        string json = StartPipInstall(body);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("pip-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path.StartsWith("/pip-install-poll", StringComparison.Ordinal))
                {
                    string json = PollPipInstall(QueryValue(path, "id"), QueryValue(path, "from"));
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                }
                else if (method == "POST" && path.StartsWith("/pip-install-cancel", StringComparison.Ordinal))
                {
                    CancelPipInstall(QueryValue(path, "id"));
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "POST" && path == "/python-kernel-start-bundle")
                {
                    try
                    {
                        string id = StartPythonKernel(body);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"id\":" + JsonString(id) + "}"));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("kernel-start-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path.StartsWith("/python-kernel-exec?", StringComparison.Ordinal))
                {
                    try
                    {
                        string json = ExecutePythonKernel(QueryValue(path, "id"), body);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("kernel-exec-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path.StartsWith("/python-kernel-stop?", StringComparison.Ordinal))
                {
                    StopPythonKernel(QueryValue(path, "id"));
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "GET" && path.StartsWith("/python-kernel-file?", StringComparison.Ordinal))
                {
                    byte[] fileData; string fileName;
                    if (TryGetKernelFile(QueryValue(path, "id"), QueryValue(path, "name"), out fileData, out fileName))
                        WriteResponse(stream, "200 OK", "application/octet-stream", fileData);
                    else
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("file-not-found"));
                }
                else if (method == "POST" && path.StartsWith("/python-session-start-bundle", StringComparison.Ordinal))
                {
                    try
                    {
                        string id = StartPythonSession(body, true);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"id\":" + JsonString(id) + "}"));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("session-start-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path.StartsWith("/python-session-start", StringComparison.Ordinal))
                {
                    try
                    {
                        string id = StartPythonSession(body, false);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"id\":" + JsonString(id) + "}"));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("session-start-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path.StartsWith("/python-session-poll", StringComparison.Ordinal))
                {
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(PollPythonSession(QueryValue(path, "id"), QueryValue(path, "so"), QueryValue(path, "se"))));
                }
                else if (method == "POST" && path.StartsWith("/python-session-input", StringComparison.Ordinal))
                {
                    SendPythonSessionInput(QueryValue(path, "id"), Encoding.UTF8.GetString(body));
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "POST" && path.StartsWith("/python-session-stop", StringComparison.Ordinal))
                {
                    StopPythonSession(QueryValue(path, "id"));
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "POST" && path == "/terminal-session-open")
                {
                    try
                    {
                        string json = OpenTerminalSession(body);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("terminal-start-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path.StartsWith("/terminal-session-run", StringComparison.Ordinal))
                {
                    try
                    {
                        RunTerminalCommand(QueryValue(path, "id"), body);
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "409 Conflict", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("terminal-run-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path.StartsWith("/terminal-session-poll", StringComparison.Ordinal))
                {
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(PollTerminalSession(QueryValue(path, "id"))));
                }
                else if (method == "POST" && path.StartsWith("/terminal-session-stop", StringComparison.Ordinal))
                {
                    StopTerminalSession(QueryValue(path, "id"));
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "POST" && path == "/terminal-complete")
                {
                    try
                    {
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(TerminalCompletionJson(body)));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("terminal-complete-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path == "/ssh-capability")
                {
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(ClassDockSshTerminal.CapabilityJson()));
                }
                else if (method == "POST" && path == "/ssh-key-pick")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    bool started = ClassDockSshTerminal.StartPrivateKeyPicker();
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(started ? "opened" : "opening"));
                }
                else if (method == "GET" && path == "/ssh-key-pick-status")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8",
                        Encoding.UTF8.GetBytes(ClassDockSshTerminal.PrivateKeyPickerStatusJson()));
                }
                else if (method == "POST" && path == "/ssh-upload-pick")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    bool started = ClassDockSshTerminal.StartUploadPicker();
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(started ? "opened" : "opening"));
                }
                else if (method == "GET" && path == "/ssh-upload-pick-status")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8",
                        Encoding.UTF8.GetBytes(ClassDockSshTerminal.UploadPickerStatusJson()));
                }
                else if (method == "POST" && path == "/ssh-host-key-scan")
                {
                    try
                    {
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(ClassDockSshTerminal.ScanHostKey(body)));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "502 Bad Gateway", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ssh-host-key-scan-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/ssh-host-key-trust")
                {
                    try
                    {
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(ClassDockSshTerminal.TrustHostKey(body)));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "409 Conflict", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ssh-host-key-trust-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/ssh-session-open")
                {
                    try
                    {
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(ClassDockSshTerminal.Open(body)));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "502 Bad Gateway", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ssh-session-open-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path.StartsWith("/ssh-session-input", StringComparison.Ordinal))
                {
                    try
                    {
                        ClassDockSshTerminal.Input(QueryValue(path, "id"), body);
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "409 Conflict", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ssh-input-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path.StartsWith("/ssh-session-poll", StringComparison.Ordinal))
                {
                    try
                    {
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8",
                            Encoding.UTF8.GetBytes(ClassDockSshTerminal.Poll(QueryValue(path, "id"), QueryValue(path, "offset"))));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ssh-poll-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path.StartsWith("/ssh-session-resize", StringComparison.Ordinal))
                {
                    try
                    {
                        ClassDockSshTerminal.Resize(QueryValue(path, "id"), body);
                        WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "409 Conflict", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ssh-resize-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path.StartsWith("/ssh-session-stop", StringComparison.Ordinal))
                {
                    ClassDockSshTerminal.Stop(QueryValue(path, "id"));
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "POST" && path == "/ssh-upload-start")
                {
                    try
                    {
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8",
                            Encoding.UTF8.GetBytes(ClassDockSshTerminal.StartUpload(body)));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "409 Conflict", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ssh-upload-start-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && path.StartsWith("/ssh-upload-poll", StringComparison.Ordinal))
                {
                    try
                    {
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8",
                            Encoding.UTF8.GetBytes(ClassDockSshTerminal.PollUpload(QueryValue(path, "id"), QueryValue(path, "offset"))));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ssh-upload-poll-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path.StartsWith("/ssh-upload-cancel", StringComparison.Ordinal))
                {
                    ClassDockSshTerminal.CancelUpload(QueryValue(path, "id"));
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "GET" && path.StartsWith("/tile-proxy?", StringComparison.Ordinal))
                {
                    // 노트북 PDF 지도 스냅샷용 — sandbox iframe 의 fetch 가 차단되는 타일을 서버가 대신 받아온다
                    byte[] tileData; string tileMime;
                    if (TryProxyMapTile(QueryValue(path, "u"), out tileData, out tileMime))
                        WriteCorsResponse(stream, "200 OK", tileMime, tileData);
                    else
                        WriteCorsResponse(stream, "502 Bad Gateway", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("tile-proxy-failed"));
                }
                else if (method == "GET" && path == "/can-proxy-tiles")
                {
                    // 지도 문서가 "이 런처가 타일을 대신 받아 디스크에 남겨 주는가"를 묻는 자리.
                    // 파일 저장 가능 여부(/can-save-file)와는 다른 능력이라 따로 둔다 — Go 폴백 런처는
                    // 파일 저장은 못 해도 타일 프록시는 한다.
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("yes"));
                }
                else if (method == "GET" && path.StartsWith("/geocode?", StringComparison.Ordinal))
                {
                    byte[] found; string error;
                    if (TryGeocodePlace(QueryValue(path, "q"), QueryValue(path, "provider"), ReadGeocodeSpot(path), out found, out error))
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", found);
                    else
                        WriteResponse(stream, error == "kakao-key-required" ? "428 Precondition Required" : "502 Bad Gateway",
                            "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(error));
                }
                else if (method == "GET" && path == "/can-proxy-rates")
                {
                    // 환율 창이 "이 런처가 환율을 대신 받아 주는가" 를 묻는 자리. 타일 프록시와 다른 능력이라
                    // 프로브를 따로 둔다 — 지도 없이 환율만 쓰는 자리도 있고, 능력마다 따로 물어야 한다.
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("yes"));
                }
                else if (method == "GET" && path.StartsWith("/exchange-rate?", StringComparison.Ordinal))
                {
                    string queryError;
                    RateQuery rateQuery = ReadRateQuery(path, out queryError);
                    if (rateQuery == null)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(queryError));
                        return;
                    }
                    byte[] rateData; bool rateCached; string rateError;
                    if (TryExchangeRate(rateQuery, out rateData, out rateCached, out rateError))
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", rateData,
                            rateCached ? "X-ClassDock-Rate-Cached: 1\r\n" : null);
                    else
                        WriteResponse(stream, rateError == "rate-key-required" ? "428 Precondition Required" : "502 Bad Gateway",
                            "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(rateError));
                }
                else if (method == "GET" && path == "/exchange-rate-key-status")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(ExchangeRateKeyStatusJson()));
                }
                else if (method == "POST" && path.StartsWith("/exchange-rate-key", StringComparison.Ordinal))
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    string error;
                    bool saved = TrySetExchangeRateKey(Encoding.UTF8.GetString(body ?? new byte[0]), QueryValue(path, "remember") == "1", out error);
                    WriteResponse(stream, saved ? "200 OK" : "400 Bad Request", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes(saved ? "ok" : error));
                }
                else if (method == "DELETE" && path == "/exchange-rate-key")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    bool cleared = ClearExchangeRateKey();
                    WriteResponse(stream, cleared ? "200 OK" : "500 Internal Server Error", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes(cleared ? "ok" : "exchange-rate-key-clear-failed"));
                }
                else if (method == "GET" && path == "/map-search-key-status")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(KakaoMapKeyStatusJson()));
                }
                else if (method == "POST" && path.StartsWith("/map-search-key", StringComparison.Ordinal))
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    string error;
                    bool saved = TrySetKakaoMapKey(Encoding.UTF8.GetString(body ?? new byte[0]), QueryValue(path, "remember") == "1", out error);
                    WriteResponse(stream, saved ? "200 OK" : "400 Bad Request", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes(saved ? "ok" : error));
                }
                else if (method == "DELETE" && path == "/map-search-key")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    bool cleared = ClearKakaoMapKey();
                    WriteResponse(stream, cleared ? "200 OK" : "500 Internal Server Error", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes(cleared ? "ok" : "map-search-key-clear-failed"));
                }
                else if (method == "POST" && path.StartsWith("/map-search-provider", StringComparison.Ordinal))
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    string provider = QueryValue(path, "value") == "kakao" ? "kakao" : "osm";
                    bool saved = SaveMapSearchProvider(provider);
                    WriteResponse(stream, saved ? "200 OK" : "500 Internal Server Error", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes(saved ? "ok" : "map-search-provider-save-failed"));
                }
                else if (method == "GET" && path == "/tile-cache-status")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(TileCacheStatusJson()));
                }
                else if (method == "POST" && path == "/tile-cache-clear")
                {
                    if (!HasLocalActionHeader(headers))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("action-header-required"));
                        return;
                    }
                    bool cleared = ClearTileCache();
                    WriteResponse(stream, cleared ? "200 OK" : "500 Internal Server Error",
                        "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(cleared ? "ok" : "tile-cache-clear-failed"));
                }
                else if (method == "GET" && path.StartsWith("/python-session-file", StringComparison.Ordinal))
                {
                    // 실행이 만든 출력 파일 1개 내려주기(작업폴더 안으로 제한). 파일명은 프런트의 <a download> 가 지정.
                    byte[] fileData; string fileName;
                    if (TryGetSessionFile(QueryValue(path, "id"), QueryValue(path, "name"), out fileData, out fileName))
                        WriteResponse(stream, "200 OK", "application/octet-stream", fileData);
                    else
                        WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("file-not-found"));
                }
                else if (method == "POST" && path == "/run-python")
                {
                    if (body.Length == 0)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("empty-body"));
                        return;
                    }
                    try
                    {
                        string json = RunPython(body);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("run-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "POST" && path == "/run-python-bundle")
                {
                    if (body.Length == 0)
                    {
                        WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("empty-body"));
                        return;
                    }
                    try
                    {
                        string json = RunPythonBundle(body);
                        WriteResponse(stream, "200 OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    }
                    catch (PythonMissingException)
                    {
                        WriteResponse(stream, "501 Not Implemented", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("no-python"));
                    }
                    catch (Exception ex)
                    {
                        WriteResponse(stream, "500 Internal Server Error", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("run-failed: " + FlattenMessage(ex)));
                    }
                }
                else if (method == "GET" && (path == "/" || path.StartsWith("/?", StringComparison.Ordinal)))
                {
                    WriteResponse(stream, "200 OK", "text/html; charset=utf-8", Page);
                }
                else
                {
                    WriteResponse(stream, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found"));
                }
            }
        }
    }

    static bool ValidHeartbeatId(string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 100) return false;
        for (int i = 0; i < id.Length; i++)
        {
            char c = id[i];
            if (!(char.IsLetterOrDigit(c) || c == '-' || c == '_')) return false;
        }
        return true;
    }

    static void TouchHeartbeatClient(string id)
    {
        if (!ValidHeartbeatId(id)) return;
        lock (HeartbeatLock)
        {
            HeartbeatClients[id] = DateTime.UtcNow;
            HeartbeatSeen = true;
            NoHeartbeatClientsSince = DateTime.MaxValue;
        }
    }

    static void CloseHeartbeatClient(string id)
    {
        if (!ValidHeartbeatId(id)) return;
        lock (HeartbeatLock)
        {
            HeartbeatClients.Remove(id);
            if (HeartbeatSeen && HeartbeatClients.Count == 0) NoHeartbeatClientsSince = DateTime.UtcNow;
        }
    }

    // origin(포트) 무관 설정 저장소 읽기. 파일이 없거나 오류면 빈 JSON 객체를 돌려준다.
    static string LoadAppState()
    {
        lock (AppStateLock)
        {
            try
            {
                if (File.Exists(AppStatePath))
                {
                    string s = File.ReadAllText(AppStatePath, Encoding.UTF8);
                    if (!string.IsNullOrEmpty(s)) return s;
                }
            }
            catch { }
            return "{}";
        }
    }

    // localStorage 스냅샷 JSON 을 그대로 저장한다(임시파일에 쓰고 교체해 부분 기록을 방지).
    static void SaveAppState(byte[] body)
    {
        if (body == null || body.Length == 0) return;
        if (body.Length > AppStateMaxBytes) throw new Exception("state-too-large");
        lock (AppStateLock)
        {
            string dir = Path.GetDirectoryName(AppStatePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
            string tmp = AppStatePath + ".tmp";
            File.WriteAllBytes(tmp, body);
            if (File.Exists(AppStatePath)) File.Delete(AppStatePath);
            File.Move(tmp, AppStatePath);
        }
    }

    // 직전 인스턴스가 기록한 포트를 읽는다(없거나 이상하면 0).
    static int ReadInstancePort()
    {
        try
        {
            if (File.Exists(InstancePortPath))
            {
                int p;
                if (int.TryParse((File.ReadAllText(InstancePortPath) ?? "").Trim(), out p) && p > 0 && p <= 65535) return p;
            }
        }
        catch { }
        return 0;
    }

    // 현재 인스턴스가 실제로 바인딩한 포트를 기록한다.
    static void WriteInstancePort(int port)
    {
        try
        {
            string dir = Path.GetDirectoryName(InstancePortPath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(InstancePortPath, port.ToString());
        }
        catch { }
    }

    // 앱 모드 설정을 읽는다. 파일이 없거나 읽지 못하면 지금까지의 동작(기본 브라우저)을 유지한다.
    static bool LoadAppMode()
    {
        try
        {
            if (File.Exists(AppModeConfigPath)) return (File.ReadAllText(AppModeConfigPath) ?? "").Trim() == "1";
        }
        catch { }
        return false;
    }

    static void SaveAppMode(bool on)
    {
        string dir = Path.GetDirectoryName(AppModeConfigPath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.WriteAllText(AppModeConfigPath, on ? "1" : "0", new UTF8Encoding(false));
    }

    // 기본 브라우저의 ProgId. 크롬을 쓰는데 엣지 창이 뜨는 일이 없도록 앱 모드 브라우저 선택에 참고한다.
    static string DefaultBrowserProgId()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice"))
            {
                if (key != null) return ((key.GetValue("ProgId") as string) ?? "").ToLowerInvariant();
            }
        }
        catch { }
        return "";
    }

    // --app= 창을 띄울 수 있는 크로미움 브라우저 경로. 없으면 null(= 앱 모드 불가).
    // 기본 브라우저가 크롬이면 크롬을, 그 밖에는 윈도우에 항상 있는 엣지를 먼저 찾는다.
    static string FindChromiumBrowser()
    {
        bool chromeFirst = DefaultBrowserProgId().Contains("chrome");
        string[] relatives = chromeFirst
            ? new string[] { @"Google\Chrome\Application\chrome.exe", @"Microsoft\Edge\Application\msedge.exe" }
            : new string[] { @"Microsoft\Edge\Application\msedge.exe", @"Google\Chrome\Application\chrome.exe" };
        string[] roots = new string[] {
            Environment.GetEnvironmentVariable("ProgramFiles"),
            Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
            Environment.GetEnvironmentVariable("LocalAppData")   // 크롬 사용자 단독 설치
        };
        foreach (string relative in relatives)
        {
            foreach (string root in roots)
            {
                if (string.IsNullOrEmpty(root)) continue;
                try
                {
                    string exe = Path.Combine(root, relative);
                    if (File.Exists(exe)) return exe;
                }
                catch { }
            }
        }
        return null;
    }

    // 앱 화면을 브라우저로 연다. appMode 면 탭·주소창이 없는 --app 창으로,
    // 앱 모드가 꺼져 있거나 크로미움을 찾지 못하면 지금까지처럼 기본 브라우저로 연다.
    static bool OpenAppUrl(string url, bool appMode)
    {
        if (appMode)
        {
            string exe = FindChromiumBrowser();
            if (exe != null)
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = exe;
                    psi.Arguments = "--app=" + url + " --window-size=1440,900";
                    psi.UseShellExecute = false;
                    Process.Start(psi);
                    return true;
                }
                catch { }   // 앱 모드로 못 띄우면 기본 브라우저로 폴백해 최소한 화면은 뜨게 한다
            }
        }
        Process.Start(url);
        return false;
    }

    // 포트 파일만으로는 두 프로세스가 동시에 시작하는 순간을 막을 수 없으므로 OS 뮤텍스로 보완한다.
    // 뮤텍스 생성 자체가 실패하는 제한된 환경에서는 기존 포트 기반 동작을 유지한다.
    static bool TryAcquireSingleInstanceMutex()
    {
        try
        {
            bool createdNew;
            SingleInstanceMutex = new Mutex(true, SingleInstanceMutexName, out createdNew);
            if (createdNew) return true;
            try { return SingleInstanceMutex.WaitOne(0); }
            catch (AbandonedMutexException) { return true; }
        }
        catch { return true; }
    }

    // 지정 포트에 이미 '우리' 서버가 떠 있는지 확인(/ping 응답의 X-App 헤더로 식별). 외부 앱이면 false.
    // 이제 "기록된 포트" 한 곳만 확인하므로, 우리 서버면 즉시 응답(수십 ms)·죽은 포트면 즉시 거부된다.
    // 드물게 외부 앱이 그 포트를 물고 응답만 안 하는 경우를 대비해 타임아웃은 짧게 둔다.
    static bool IsOurServerAt(int port)
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/ping");
            req.Method = "GET";
            req.Timeout = 700;
            req.ReadWriteTimeout = 700;
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            {
                return resp.Headers["X-App"] == "classdock";
            }
        }
        catch { return false; }
    }

    static void WriteResponse(Stream stream, string status, string contentType, byte[] body)
    {
        WriteResponse(stream, status, contentType, body, null);
    }

    // extraHeader 는 이미 "이름: 값\r\n" 꼴로 끝난 ASCII 한 줄이어야 한다(환율 저장본 표시 등).
    static void WriteResponse(Stream stream, string status, string contentType, byte[] body, string extraHeader)
    {
        string header =
            "HTTP/1.1 " + status + "\r\n" +
            "Content-Type: " + contentType + "\r\n" +
            "Content-Length: " + body.Length + "\r\n" +
            (extraHeader ?? "") +
            "Cache-Control: no-store\r\n" +
            "X-Content-Type-Options: nosniff\r\n" +
            "Referrer-Policy: no-referrer\r\n" +
            "X-App: classdock\r\n" +      // 우리 서버 식별용(중복 실행 시 단일 인스턴스 판별)
            ConnectionHeader(stream) +
            "\r\n";
        WriteHeaderAndBody(stream, Encoding.ASCII.GetBytes(header), body);
    }

    static string ConnectionHeader(Stream stream)
    {
        HttpConnectionStream connection = stream as HttpConnectionStream;
        return (connection != null && connection.KeepAlive) ? "Connection: keep-alive\r\nKeep-Alive: timeout=30\r\n" : "Connection: close\r\n";
    }

    // 헤더와 본문을 한 번에 보낸다. 두 번 나눠 쓰면 Nagle 과 상대의 지연 ACK 가 겹쳐 늦어질 수 있다.
    // 큰 본문(앱 HTML 33MB 등)까지 복사하면 메모리를 두 배로 쓰므로 작은 응답에만 합친다.
    static void WriteHeaderAndBody(Stream stream, byte[] headerBytes, byte[] body)
    {
        if (body.Length > 0 && body.Length <= 64 * 1024)
        {
            byte[] packet = new byte[headerBytes.Length + body.Length];
            Buffer.BlockCopy(headerBytes, 0, packet, 0, headerBytes.Length);
            Buffer.BlockCopy(body, 0, packet, headerBytes.Length, body.Length);
            stream.Write(packet, 0, packet.Length);
            return;
        }
        stream.Write(headerBytes, 0, headerBytes.Length);
        if (body.Length > 0) stream.Write(body, 0, body.Length);
    }

    // sandbox(origin null) iframe 의 fetch 가 읽을 수 있도록 CORS 를 허용한 응답 — 지도 타일 프록시 전용
    static void WriteCorsResponse(Stream stream, string status, string contentType, byte[] body)
    {
        string header =
            "HTTP/1.1 " + status + "\r\n" +
            "Content-Type: " + contentType + "\r\n" +
            "Content-Length: " + body.Length + "\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Cache-Control: max-age=600\r\n" +
            "X-Content-Type-Options: nosniff\r\n" +
            "Referrer-Policy: no-referrer\r\n" +
            "X-App: classdock\r\n" +
            ConnectionHeader(stream) +
            "\r\n";
        WriteHeaderAndBody(stream, Encoding.ASCII.GetBytes(header), body);
    }

    /* ===== 지도 타일 프록시 =====
       두 곳이 쓴다. (1) 노트북 PDF 의 지도 스냅샷 — 캡처 라이브러리가 타일을 fetch 로 다시 받아
       인라인하는데 sandbox iframe 의 fetch 는 Origin: null 로 나가 OSM 정책에 차단된다(화면의 <img>
       요청은 통과). (2) 지도 문서(.map) 의 배경 타일 — 이쪽은 화면 표시부터 프록시를 거친다.
       SSRF 방지를 위해 https + 알려진 타일 호스트만 허용한다.

       캐시는 두 층이다. 메모리는 같은 화면을 다시 그릴 때, 디스크는 "인터넷 없는 교실"을 위한 것이다.
       디스크가 있어야 하는 이유: 런처는 실행할 때마다 다른 포트를 잡으므로 브라우저 origin 이 매번
       바뀐다 → IndexedDB·Cache API 는 다음 실행에서 남의 저장소가 되어 못 읽는다. 한 번 본 지역을
       다음 수업에서도 열려면 서버가 파일로 들고 있어야 한다. */
    static readonly string[] TileProxyHosts = {
        "tile.openstreetmap.org", "basemaps.cartocdn.com", "tile.opentopomap.org",
        "server.arcgisonline.com", "tiles.stadiamaps.com", "tile.thunderforest.com"
    };
    sealed class TileMemoryEntry
    {
        public byte[] Data;
        public string Mime;
        public DateTime CachedAtUtc;
        public TileMemoryEntry(byte[] data, string mime, DateTime cachedAtUtc)
        { Data = data; Mime = mime; CachedAtUtc = cachedAtUtc; }
    }
    static readonly object TileCacheLock = new object();
    static readonly Dictionary<string, TileMemoryEntry> TileCache = new Dictionary<string, TileMemoryEntry>();
    static bool TileTlsReady;
    static readonly string TileCacheDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClassDock", "tile-cache");
    const long TileCacheMaxBytes = 400L * 1024 * 1024;
    static readonly TimeSpan TileCacheMaxAge = TimeSpan.FromDays(7);
    static readonly object TileDiskLock = new object();
    static long TileDiskBytes = -1;
    static readonly string[] TileCacheExtensions = { ".png", ".jpg", ".webp" };

    static string TileCacheKey(string url)
    {
        using (var sha = System.Security.Cryptography.SHA256.Create())
        {
            byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(url));
            var text = new StringBuilder(hash.Length * 2);
            foreach (byte b in hash) text.Append(b.ToString("x2"));
            return text.ToString();
        }
    }
    static string TileCacheExtensionFor(string mime)
    {
        string value = (mime ?? "").ToLowerInvariant();
        if (value.Contains("jpeg") || value.Contains("jpg")) return ".jpg";
        if (value.Contains("webp")) return ".webp";
        return ".png";
    }
    // 파일이 한 폴더에 수만 개 쌓이면 탐색기도 열거도 느려진다 — 해시 앞 두 글자로 256칸에 나눈다.
    static string TileCacheFile(string key, string ext)
    {
        return Path.Combine(TileCacheDir, key.Substring(0, 2), key + ext);
    }
    static bool TryReadCachedTile(string url, out byte[] data, out string mime, out DateTime cachedAtUtc)
    {
        data = null; mime = "image/png"; cachedAtUtc = DateTime.MinValue;
        try
        {
            string key = TileCacheKey(url);
            foreach (string ext in TileCacheExtensions)
            {
                string file = TileCacheFile(key, ext);
                if (!File.Exists(file)) continue;
                cachedAtUtc = File.GetLastWriteTimeUtc(file);
                data = File.ReadAllBytes(file);
                mime = ext == ".jpg" ? "image/jpeg" : (ext == ".webp" ? "image/webp" : "image/png");
                return data.Length > 0;
            }
        }
        catch { data = null; }
        return false;
    }
    static bool IsTileCacheFresh(DateTime cachedAtUtc)
    {
        return cachedAtUtc != DateTime.MinValue && DateTime.UtcNow - cachedAtUtc <= TileCacheMaxAge;
    }
    static void WriteCachedTile(string url, byte[] data, string mime)
    {
        if (data == null || data.Length == 0) return;
        try
        {
            string key = TileCacheKey(url);
            string file = TileCacheFile(key, TileCacheExtensionFor(mime));
            lock (TileDiskLock)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(file));
                if (TileDiskBytes < 0) TileDiskBytes = TileCacheFiles().Sum(f => f.Length);
                long replacedBytes = 0;
                foreach (string ext in TileCacheExtensions)
                {
                    string previous = TileCacheFile(key, ext);
                    if (!File.Exists(previous)) continue;
                    long previousBytes = 0;
                    try { previousBytes = new FileInfo(previous).Length; } catch { }
                    if (string.Equals(previous, file, StringComparison.OrdinalIgnoreCase)) replacedBytes += previousBytes;
                    else
                    {
                        try { File.Delete(previous); replacedBytes += previousBytes; } catch { }
                    }
                }
                // 같은 타일을 동시에 두 번 받아도 반쯤 쓰인 파일이 남지 않게 임시 이름으로 쓰고 옮긴다.
                string temp = file + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp";
                File.WriteAllBytes(temp, data);
                if (File.Exists(file)) File.Delete(file);
                File.Move(temp, file);
                TileDiskBytes = Math.Max(0, TileDiskBytes - replacedBytes) + data.LongLength;
                if (TileDiskBytes > TileCacheMaxBytes) SweepTileCache();
            }
        }
        catch { }
    }
    // 상한을 넘으면 오래 전에 받은 것부터 80% 아래로 내려갈 때까지 지운다.
    static FileInfo[] TileCacheFiles()
    {
        if (!Directory.Exists(TileCacheDir)) return new FileInfo[0];
        return new DirectoryInfo(TileCacheDir).GetFiles("*", SearchOption.AllDirectories)
            .Where(file => TileCacheExtensions.Contains(file.Extension.ToLowerInvariant())).ToArray();
    }
    static void SweepTileCache()
    {
        try
        {
            var files = TileCacheFiles();
            long total = 0;
            foreach (var file in files) total += file.Length;
            if (total > TileCacheMaxBytes)
            {
                Array.Sort(files, (a, b) => a.LastWriteTimeUtc.CompareTo(b.LastWriteTimeUtc));
                long target = (long)(TileCacheMaxBytes * 0.8);
                foreach (var file in files)
                {
                    if (total <= target) break;
                    long size = file.Length;
                    try { file.Delete(); total -= size; } catch { }
                }
            }
            TileDiskBytes = total;
        }
        catch { TileDiskBytes = -1; }
    }
    static string TileCacheStatusJson()
    {
        long bytes = 0; int count = 0;
        try
        {
            lock (TileDiskLock)
            {
                foreach (var file in TileCacheFiles()) { bytes += file.Length; count++; }
                TileDiskBytes = bytes;
            }
        }
        catch { }
        return "{\"files\":" + count + ",\"bytes\":" + bytes + ",\"maxBytes\":" + TileCacheMaxBytes + "}";
    }
    static bool ClearTileCache()
    {
        try
        {
            lock (TileDiskLock)
            {
                if (Directory.Exists(TileCacheDir)) Directory.Delete(TileCacheDir, true);
                TileDiskBytes = 0;
            }
            lock (TileCacheLock) TileCache.Clear();
            return true;
        }
        catch { return false; }
    }
    /* ===== 장소 이름 검색(지오코딩) =====
       브라우저에서 API 를 직접 부르지 않고 런처를 거친다. OSM 은 식별 User-Agent·호출 간격을 한 곳에서
       지키고, 카카오 REST API 키는 HTML·localStorage·작업공간에 노출하지 않는다. Windows 에서 '기억'
       을 켜면 DPAPI(CurrentUser)로 암호화해 같은 Windows 사용자만 복호화할 수 있게 저장한다. */
    const string DefaultGeocodeEndpoint = "https://nominatim.openstreetmap.org/search";
    const string GeocodeEndpointEnvironment = "CLASSDOCK_GEOCODER_URL";
    const string KakaoAddressEndpoint = "https://dapi.kakao.com/v2/local/search/address.json";
    const string KakaoKeywordEndpoint = "https://dapi.kakao.com/v2/local/search/keyword.json";
    /* 같은 REST 키로 쓰는 나머지 Local API. 신청이 따로 필요 없고 도메인 등록도 없다.
       category  = 반경 안의 학교·병원 같은 갈래별 장소
       coord2address / coord2regioncode = 찍은 자리의 주소·행정구역 */
    const string KakaoCategoryEndpoint = "https://dapi.kakao.com/v2/local/search/category.json";
    const string KakaoCoordAddressEndpoint = "https://dapi.kakao.com/v2/local/geo/coord2address.json";
    const string KakaoCoordRegionEndpoint = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json";
    /* 자동차 길찾기만 Local API 가 아닌 카카오모빌리티 쪽이다(호스트도 다르다). 그래도 키는 Local
       API 에 쓰던 그 REST 키 하나뿐이고, 콘솔에서 따로 켤 제품 설정은 없다(2026-08-25 실제 키로
       확인). 다만 하루 무료 몫이 이 API 에 따로 매겨지므로 부르는 자리를 한 곳(표시 잇는 길찾기)
       으로 좁히고, 같은 표시 배치로는 두 번 묻지 않게 화면에서 답을 담아 둔다. */
    const string KakaoDirectionsEndpoint = "https://apis-navi.kakaomobility.com/v1/directions";
    /* 장소 이름 검색으로 돌려줄 후보 수. 화면 목록(map-viewer.js MAP_SEARCH_RESULT_MAX)·Go 폴백
       런처(main.go geocodeResultLimit)와 같은 값이어야 한다 — 한쪽만 올리면 다른 쪽에서 잘린다. */
    const string GeocodeResultLimit = "8";      // 주소 뒤에 그대로 붙이는 값이라 문자열로 둔다
    const int GeocodeMinIntervalMs = 1100;      // 정책상 초당 1건 — 여유를 조금 둔다
    const int GeocodeMaxBytes = 512 * 1024;
    /* 길찾기는 roads[].vertexes 전체를 돌려주므로 장소 검색보다 정상 응답이 훨씬 크다. 카카오가
       허용하는 장거리·경유지 경로도 받을 수 있게 전용 상한을 두되, 무제한으로 읽지는 않는다. */
    const int DirectionsMaxBytes = 8 * 1024 * 1024;
    static readonly object GeocodeLock = new object();
    static DateTime GeocodeLastCall = DateTime.MinValue;
    static readonly Dictionary<string, byte[]> GeocodeCache = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
    static readonly object KakaoMapKeyLock = new object();
    static readonly byte[] KakaoMapKeyEntropy = Encoding.UTF8.GetBytes("ClassDock.KakaoMapKey.v1");
    static readonly string KakaoMapKeyFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClassDock", "kakao-map-key.bin");
    static readonly string MapSearchProviderFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClassDock", "map-search-provider.txt");
    static bool KakaoMapKeyLoaded;
    static string KakaoMapKey = "";
    static Uri GeocodeEndpoint()
    {
        string configured = (Environment.GetEnvironmentVariable(GeocodeEndpointEnvironment) ?? "").Trim();
        Uri endpoint;
        if (!Uri.TryCreate(configured.Length > 0 ? configured : DefaultGeocodeEndpoint, UriKind.Absolute, out endpoint)
            || endpoint.Scheme != "https")
            Uri.TryCreate(DefaultGeocodeEndpoint, UriKind.Absolute, out endpoint);
        return endpoint;
    }
    static bool ValidKakaoMapKey(string value)
    {
        string key = (value ?? "").Trim();
        if (key.Length < 16 || key.Length > 128) return false;
        foreach (char ch in key)
            if (!(char.IsLetterOrDigit(ch) || ch == '-' || ch == '_')) return false;
        return true;
    }
    static string CurrentKakaoMapKey()
    {
        lock (KakaoMapKeyLock)
        {
            if (!KakaoMapKeyLoaded)
            {
                KakaoMapKeyLoaded = true;
                try
                {
                    if (File.Exists(KakaoMapKeyFile))
                    {
                        byte[] encrypted = File.ReadAllBytes(KakaoMapKeyFile);
                        byte[] plain = ProtectedData.Unprotect(encrypted, KakaoMapKeyEntropy, DataProtectionScope.CurrentUser);
                        string key = Encoding.UTF8.GetString(plain).Trim();
                        if (ValidKakaoMapKey(key)) KakaoMapKey = key;
                    }
                }
                catch { KakaoMapKey = ""; }
            }
            return KakaoMapKey;
        }
    }
    static bool KakaoMapKeyRemembered()
    {
        try { return File.Exists(KakaoMapKeyFile) && CurrentKakaoMapKey().Length > 0; }
        catch { return false; }
    }
    static string CurrentMapSearchProvider()
    {
        try
        {
            if (File.Exists(MapSearchProviderFile))
            {
                string saved = File.ReadAllText(MapSearchProviderFile, Encoding.UTF8).Trim().ToLowerInvariant();
                if (saved == "kakao" || saved == "osm") return saved;
            }
        }
        catch { }
        // 이 기능을 넣기 전에 이미 키를 저장한 사용자는 앱 모드에서 바로 카카오를 이어 쓴다.
        return CurrentKakaoMapKey().Length > 0 ? "kakao" : "osm";
    }
    static bool SaveMapSearchProvider(string value)
    {
        string provider = value == "kakao" ? "kakao" : "osm";
        try
        {
            string dir = Path.GetDirectoryName(MapSearchProviderFile);
            Directory.CreateDirectory(dir);
            File.WriteAllText(MapSearchProviderFile, provider, new UTF8Encoding(false));
            return true;
        }
        catch { return false; }
    }
    static string KakaoMapKeyStatusJson()
    {
        return "{\"hasKey\":" + (CurrentKakaoMapKey().Length > 0 ? "true" : "false")
            + ",\"remembered\":" + (KakaoMapKeyRemembered() ? "true" : "false")
            + ",\"persistentSupported\":true,\"provider\":" + JsonString(CurrentMapSearchProvider()) + "}";
    }
    static bool SaveProtectedKakaoMapKey(string key)
    {
        try
        {
            string dir = Path.GetDirectoryName(KakaoMapKeyFile);
            Directory.CreateDirectory(dir);
            byte[] encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(key), KakaoMapKeyEntropy, DataProtectionScope.CurrentUser);
            string temp = KakaoMapKeyFile + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp";
            File.WriteAllBytes(temp, encrypted);
            if (File.Exists(KakaoMapKeyFile)) File.Delete(KakaoMapKeyFile);
            File.Move(temp, KakaoMapKeyFile);
            return true;
        }
        catch { return false; }
    }
    static bool ClearKakaoMapKey()
    {
        lock (KakaoMapKeyLock)
        {
            KakaoMapKeyLoaded = true;
            KakaoMapKey = "";
            try { if (File.Exists(KakaoMapKeyFile)) File.Delete(KakaoMapKeyFile); }
            catch { return false; }
        }
        lock (GeocodeLock) GeocodeCache.Clear();
        SaveMapSearchProvider("osm");
        return true;
    }
    static bool TrySetKakaoMapKey(string value, bool remember, out string error)
    {
        string key = (value ?? "").Trim();
        error = "kakao-key-invalid";
        if (!ValidKakaoMapKey(key)) return false;
        byte[] probe;
        if (!TryFetchGeocode("서울특별시 중구 세종대로 110", "kakao-address", key, null, out probe, out error)) return false;
        string previous = CurrentKakaoMapKey();
        lock (KakaoMapKeyLock)
        {
            if (remember)
            {
                if (!SaveProtectedKakaoMapKey(key)) { KakaoMapKey = previous; error = "kakao-key-save-failed"; return false; }
            }
            else
            {
                try { if (File.Exists(KakaoMapKeyFile)) File.Delete(KakaoMapKeyFile); }
                catch { KakaoMapKey = previous; error = "kakao-key-save-failed"; return false; }
            }
            KakaoMapKeyLoaded = true;
            KakaoMapKey = key;
        }
        lock (GeocodeLock) GeocodeCache.Clear();
        SaveMapSearchProvider("kakao");
        error = "";
        return true;
    }
    /* 검색어 말고 좌표로 부르는 요청(반경 시설·좌표→주소)의 딸린 값.
       브라우저가 보낸 문자열을 그대로 URL 에 붙이지 않고 여기서 숫자·코드 꼴만 통과시킨다. */
    class GeocodeSpot
    {
        public string X = "";
        public string Y = "";
        public string Radius = "";
        public string Category = "";
        public string Page = "";
        // 길찾기만 점이 둘 이상이다 — 도착점(X2·Y2)과 사이에 들르는 곳(Via, "x,y|x,y" 꼴).
        public string X2 = "";
        public string Y2 = "";
        public string Via = "";
        public bool HasPoint { get { return X.Length > 0 && Y.Length > 0; } }
        public bool HasEnd { get { return X2.Length > 0 && Y2.Length > 0; } }
        public string CacheKey
        {
            get { return X + "|" + Y + "|" + Radius + "|" + Category + "|" + Page + "|" + X2 + "|" + Y2 + "|" + Via; }
        }
    }
    static string GeocodeNumber(string value, double min, double max)
    {
        double parsed;
        if (!double.TryParse((value ?? "").Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)) return "";
        if (double.IsNaN(parsed) || double.IsInfinity(parsed) || parsed < min || parsed > max) return "";
        return parsed.ToString("0.######", CultureInfo.InvariantCulture);
    }
    /* 들르는 곳 목록("x,y|x,y")도 좌표와 같은 규칙으로 다시 짠다 — 브라우저가 보낸 글자를
       그대로 붙이지 않고 숫자로 읽힌 것만 카카오가 받는 꼴로 되돌려 준다. 카카오 상한이 5 개다. */
    const int GeocodeViaMax = 5;
    static string GeocodeVia(string raw)
    {
        List<string> points = new List<string>();
        foreach (string piece in (raw ?? "").Split('|'))
        {
            if (points.Count >= GeocodeViaMax) break;
            string[] parts = piece.Split(',');
            if (parts.Length != 2) continue;
            string x = GeocodeNumber(parts[0], -180, 180);
            string y = GeocodeNumber(parts[1], -85, 85);
            if (x.Length == 0 || y.Length == 0) continue;
            points.Add(x + "," + y);
        }
        return string.Join("|", points.ToArray());
    }
    static GeocodeSpot ReadGeocodeSpot(string path)
    {
        GeocodeSpot spot = new GeocodeSpot();
        spot.X = GeocodeNumber(QueryValue(path, "x"), -180, 180);
        spot.Y = GeocodeNumber(QueryValue(path, "y"), -85, 85);
        spot.X2 = GeocodeNumber(QueryValue(path, "x2"), -180, 180);
        spot.Y2 = GeocodeNumber(QueryValue(path, "y2"), -85, 85);
        spot.Via = GeocodeVia(QueryValue(path, "via"));
        spot.Radius = GeocodeNumber(QueryValue(path, "radius"), 1, 20000);      // 카카오 반경 상한
        spot.Page = GeocodeNumber(QueryValue(path, "page"), 1, 3);
        // 카카오 카테고리 코드는 언제나 영문 두 글자 + 숫자 한 글자다(SC4·CS2 …).
        string category = (QueryValue(path, "category") ?? "").Trim().ToUpperInvariant();
        if (category.Length == 3 && category[0] >= 'A' && category[0] <= 'Z'
            && category[1] >= 'A' && category[1] <= 'Z' && category[2] >= '0' && category[2] <= '9')
            spot.Category = category;
        return spot;
    }
    static bool TryFetchGeocode(string q, string provider, string kakaoKey, GeocodeSpot spot, out byte[] data, out string error)
    {
        data = null; error = "geocode-failed";
        bool kakao = provider.StartsWith("kakao-", StringComparison.Ordinal);
        if (spot == null) spot = new GeocodeSpot();
        try
        {
            if (!kakao)
            {
                lock (GeocodeLock)
                {
                    double waited = (DateTime.UtcNow - GeocodeLastCall).TotalMilliseconds;
                    if (waited < GeocodeMinIntervalMs) Thread.Sleep((int)(GeocodeMinIntervalMs - waited));
                    GeocodeLastCall = DateTime.UtcNow;
                }
            }
            if (!TileTlsReady)
            {
                try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { }
                TileTlsReady = true;
            }
            string url;
            if (provider == "kakao-coord2address" || provider == "kakao-coord2region")
            {
                string endpoint = provider == "kakao-coord2region" ? KakaoCoordRegionEndpoint : KakaoCoordAddressEndpoint;
                url = endpoint + "?x=" + spot.X + "&y=" + spot.Y;
            }
            else if (provider == "kakao-directions")
            {
                /* 대안 경로·상세 도로는 끈다 — 화면에 그리는 것은 길 하나뿐이라 나머지는 응답만
                   키운다(읽는 양을 512KB 로 자르는 아래 규칙에 그대로 걸린다). */
                url = KakaoDirectionsEndpoint + "?origin=" + spot.X + "," + spot.Y
                    + "&destination=" + spot.X2 + "," + spot.Y2
                    + (spot.Via.Length > 0 ? "&waypoints=" + Uri.EscapeDataString(spot.Via) : "")
                    + "&priority=RECOMMEND&car_fuel=GASOLINE&car_hipass=false&alternatives=false&road_details=false";
            }
            else if (provider == "kakao-category")
            {
                url = KakaoCategoryEndpoint + "?category_group_code=" + spot.Category
                    + "&x=" + spot.X + "&y=" + spot.Y
                    + "&radius=" + (spot.Radius.Length > 0 ? spot.Radius : "1000")
                    + "&size=15&sort=distance&page=" + (spot.Page.Length > 0 ? spot.Page : "1");
            }
            else if (kakao)
            {
                string endpoint = provider == "kakao-keyword" ? KakaoKeywordEndpoint : KakaoAddressEndpoint;
                // 키워드 검색에 기준점이 오면 그 둘레만 본다 — 갈래에 없는 말로 주변 시설을 찾는
                // 길이라(로또·빵집 …) 갈래 검색과 같은 쪽수(15개·페이지)로 받는다.
                bool around = provider == "kakao-keyword" && spot.HasPoint;
                url = endpoint + "?size=" + (around ? "15" : GeocodeResultLimit) + "&query=" + Uri.EscapeDataString(q);
                if (around)
                    url += "&x=" + spot.X + "&y=" + spot.Y + "&sort=distance"
                        + "&page=" + (spot.Page.Length > 0 ? spot.Page : "1")
                        + (spot.Radius.Length > 0 ? "&radius=" + spot.Radius : "");
            }
            else if (provider == "osm-reverse")
            {
                // Nominatim 의 역지오코딩은 같은 서버의 이웃 경로다(/search → /reverse).
                string basePath = GeocodeEndpoint().GetLeftPart(UriPartial.Path);
                if (basePath.EndsWith("/search", StringComparison.Ordinal))
                    basePath = basePath.Substring(0, basePath.Length - "/search".Length) + "/reverse";
                url = basePath + "?format=jsonv2&zoom=18&accept-language=ko&lat=" + spot.Y + "&lon=" + spot.X;
            }
            else
            {
                Uri endpoint = GeocodeEndpoint();
                url = endpoint.GetLeftPart(UriPartial.Path) + "?format=jsonv2&limit=" + GeocodeResultLimit + "&accept-language=ko&q=" + Uri.EscapeDataString(q);
            }
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.UserAgent = "ClassDock/1.0 (local classroom app; https://github.com/songhwaseong/ClassDock)";
            request.Accept = "application/json";
            if (kakao) request.Headers[HttpRequestHeader.Authorization] = "KakaoAK " + kakaoKey;
            request.Timeout = 12000;
            request.ReadWriteTimeout = 12000;
            using (WebResponse response = request.GetResponse())
            using (Stream body = response.GetResponseStream())
            using (MemoryStream buffer = new MemoryStream())
            {
                byte[] chunk = new byte[8192];
                int read; long total = 0;
                int maxBytes = provider == "kakao-directions" ? DirectionsMaxBytes : GeocodeMaxBytes;
                while ((read = body.Read(chunk, 0, chunk.Length)) > 0)
                {
                    total += read;
                    if (total > maxBytes) { error = "geocode-too-large"; return false; }
                    buffer.Write(chunk, 0, read);
                }
                data = buffer.ToArray();
            }
            return true;
        }
        catch (WebException ex)
        {
            HttpWebResponse response = ex.Response as HttpWebResponse;
            error = kakao && response != null && (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden)
                ? "kakao-key-invalid" : "geocode-failed";
            data = null; return false;
        }
        catch { error = "geocode-failed"; data = null; return false; }
    }
    static readonly string[] GeocodeProviders = {
        "osm", "osm-reverse", "kakao-address", "kakao-keyword",
        "kakao-category", "kakao-coord2address", "kakao-coord2region", "kakao-directions"
    };
    static bool TryGeocodePlace(string query, string requestedProvider, GeocodeSpot spot, out byte[] data, out string error)
    {
        data = null; error = "geocode-failed";
        if (spot == null) spot = new GeocodeSpot();
        string q = (query ?? "").Trim();
        string provider = Array.IndexOf(GeocodeProviders, requestedProvider ?? "") >= 0 ? requestedProvider : "osm";
        // 좌표로 부르는 갈래는 검색어 대신 기준점이 있어야 한다.
        bool needsPoint = provider == "kakao-category" || provider == "kakao-coord2address"
            || provider == "kakao-coord2region" || provider == "osm-reverse" || provider == "kakao-directions";
        if (needsPoint)
        {
            if (!spot.HasPoint) { error = "geocode-bad-point"; return false; }
            if (provider == "kakao-category" && spot.Category.Length == 0) { error = "geocode-bad-category"; return false; }
            // 길찾기는 출발점만으로는 뜻이 없다 — 도착점이 빠지면 카카오에 묻지 않고 여기서 끊는다.
            if (provider == "kakao-directions" && !spot.HasEnd) { error = "geocode-bad-point"; return false; }
        }
        else if (q.Length == 0 || q.Length > 200) { error = "geocode-bad-query"; return false; }
        string kakaoKey = "";
        if (provider.StartsWith("kakao-", StringComparison.Ordinal))
        {
            kakaoKey = CurrentKakaoMapKey();
            if (kakaoKey.Length == 0) { error = "kakao-key-required"; return false; }
        }
        string cacheKey = provider + "\n" + q + "\n" + spot.CacheKey;
        /* 길찾기에는 현재 교통 속도·통제 상황이 반영된다. 화면 안의 짧은 중복은 JS가 막으므로,
           런처의 무기한 장소 검색 캐시에는 넣지 않아 저장 지도를 다시 열면 새 답을 받게 한다. */
        bool cacheable = provider != "kakao-directions";
        if (cacheable)
            lock (GeocodeLock) if (GeocodeCache.TryGetValue(cacheKey, out data)) return true;
        if (!TryFetchGeocode(q, provider, kakaoKey, spot, out data, out error)) return false;
        if (cacheable) lock (GeocodeLock)
        {
            if (GeocodeCache.Count > 200) GeocodeCache.Clear();
            GeocodeCache[cacheKey] = data;
        }
        return true;
    }

    /* ===== 환율 =====
       지도 타일과 같은 이유로 런처가 대신 받아 온다 — 실행마다 포트(=origin)가 바뀌어 브라우저
       저장소는 다음 수업까지 남지 않고, 수출입은행은 CORS 를 열어 주지 않아 브라우저에서 직접
       부를 수도 없다. 인증키도 HTML·작업공간에 두지 않고 여기서만 헤더처럼 붙인다(카카오 키와 같은 규칙).

       런처는 받아 온 JSON 을 **그대로** 돌려준다. 뜻풀이는 src/js/exchange-rate.js 한 곳에만 둔다 —
       런처가 둘(이 파일·main.go)이라 파싱을 옮겨 오면 같은 규칙을 두 언어로 두 번 틀리게 된다. */
    const string KoreaEximRateEndpoint = "https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON";
    const string EcbRateEndpoint = "https://api.frankfurter.dev/v1/";
    const long RateMaxBytes = 512 * 1024;
    const long RateCacheMaxBytes = 20L * 1024 * 1024;
    // 지난 날짜의 환율은 다시 바뀌지 않는다. 오늘 값만 잠깐 뒤에 다시 받아 본다(고시는 오전 11시 무렵).
    static readonly TimeSpan RateTodayCacheMaxAge = TimeSpan.FromMinutes(20);
    static readonly object RateCacheLock = new object();
    static readonly string RateCacheDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClassDock", "rate-cache");
    static readonly object ExchangeRateKeyLock = new object();
    static readonly byte[] ExchangeRateKeyEntropy = Encoding.UTF8.GetBytes("ClassDock.ExchangeRateKey.v1");
    static readonly string ExchangeRateKeyFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ClassDock", "exchange-rate-key.bin");
    static bool ExchangeRateKeyLoaded;
    static string ExchangeRateKey = "";

    static bool ValidExchangeRateKey(string value)
    {
        string key = (value ?? "").Trim();
        if (key.Length < 12 || key.Length > 128) return false;
        foreach (char ch in key)
            if (!(char.IsLetterOrDigit(ch) || ch == '-' || ch == '_')) return false;
        return true;
    }
    static string CurrentExchangeRateKey()
    {
        lock (ExchangeRateKeyLock)
        {
            if (!ExchangeRateKeyLoaded)
            {
                ExchangeRateKeyLoaded = true;
                try
                {
                    if (File.Exists(ExchangeRateKeyFile))
                    {
                        byte[] encrypted = File.ReadAllBytes(ExchangeRateKeyFile);
                        byte[] plain = ProtectedData.Unprotect(encrypted, ExchangeRateKeyEntropy, DataProtectionScope.CurrentUser);
                        string key = Encoding.UTF8.GetString(plain).Trim();
                        if (ValidExchangeRateKey(key)) ExchangeRateKey = key;
                    }
                }
                catch { ExchangeRateKey = ""; }
            }
            return ExchangeRateKey;
        }
    }
    static bool ExchangeRateKeyRemembered()
    {
        try { return File.Exists(ExchangeRateKeyFile) && CurrentExchangeRateKey().Length > 0; }
        catch { return false; }
    }
    static string ExchangeRateKeyStatusJson()
    {
        return "{\"hasKey\":" + (CurrentExchangeRateKey().Length > 0 ? "true" : "false")
            + ",\"remembered\":" + (ExchangeRateKeyRemembered() ? "true" : "false")
            + ",\"persistentSupported\":true}";
    }
    static bool SaveProtectedExchangeRateKey(string key)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(ExchangeRateKeyFile));
            byte[] encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(key), ExchangeRateKeyEntropy, DataProtectionScope.CurrentUser);
            string temp = ExchangeRateKeyFile + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp";
            File.WriteAllBytes(temp, encrypted);
            if (File.Exists(ExchangeRateKeyFile)) File.Delete(ExchangeRateKeyFile);
            File.Move(temp, ExchangeRateKeyFile);
            return true;
        }
        catch { return false; }
    }
    static bool ClearExchangeRateKey()
    {
        lock (ExchangeRateKeyLock)
        {
            ExchangeRateKeyLoaded = true;
            ExchangeRateKey = "";
            try { if (File.Exists(ExchangeRateKeyFile)) File.Delete(ExchangeRateKeyFile); }
            catch { return false; }
        }
        return true;
    }
    static bool TrySetExchangeRateKey(string value, bool remember, out string error)
    {
        string key = (value ?? "").Trim();
        error = "rate-key-invalid";
        if (!ValidExchangeRateKey(key)) return false;
        /* 시험 조회는 '가장 가까운 지난 영업일' 로 건다. 오늘로 걸면 주말이나 오전 고시 전에는
           키가 멀쩡해도 빈 배열이 와서 "키가 틀렸다" 고 잘못 알린다. */
        RateQuery probe = new RateQuery();
        probe.Source = "koreaexim";
        probe.Date = LastWeekdayCompact();
        byte[] body; string fetchError;
        if (!TryFetchExchangeRate(probe, key, out body, out fetchError)) { error = fetchError; return false; }
        string text = Encoding.UTF8.GetString(body);
        if (text.Contains("\"result\":3")) { error = "rate-key-invalid"; return false; }
        if (text.Contains("\"result\":4")) { error = "rate-limit-reached"; return false; }
        string previous = CurrentExchangeRateKey();
        lock (ExchangeRateKeyLock)
        {
            if (remember)
            {
                if (!SaveProtectedExchangeRateKey(key)) { ExchangeRateKey = previous; error = "rate-key-save-failed"; return false; }
            }
            else
            {
                try { if (File.Exists(ExchangeRateKeyFile)) File.Delete(ExchangeRateKeyFile); }
                catch { ExchangeRateKey = previous; error = "rate-key-save-failed"; return false; }
            }
            ExchangeRateKeyLoaded = true;
            ExchangeRateKey = key;
        }
        error = "";
        return true;
    }
    // 키 시험용 — 오늘부터 거슬러 올라가 처음 만나는 평일(YYYYMMDD). 공휴일까지는 보지 않는다.
    static string LastWeekdayCompact()
    {
        DateTime day = DateTime.Now.Date.AddDays(-1);
        for (int i = 0; i < 7; i++)
        {
            if (day.DayOfWeek != DayOfWeek.Saturday && day.DayOfWeek != DayOfWeek.Sunday) break;
            day = day.AddDays(-1);
        }
        return day.ToString("yyyyMMdd", CultureInfo.InvariantCulture);
    }

    /* 브라우저가 보낸 문자열을 URL 에 그대로 붙이지 않고 여기서 꼴부터 맞춰 본다(지오코딩의 GeocodeSpot 과 같은 규칙). */
    class RateQuery
    {
        public string Source = "";
        public string Date = "";        // koreaexim: YYYYMMDD · ecb: YYYY-MM-DD
        public string Start = "";
        public string End = "";
        public string Symbols = "";
        public string CacheKey
        {
            get { return Source + "|" + Date + "|" + Start + "|" + End + "|" + Symbols; }
        }
        // 캐시를 영구로 둘지 가르는 기준일 — 조회 구간에서 가장 나중 날짜.
        public string NewestDay
        {
            get { return End.Length > 0 ? End : Date; }
        }
    }
    static string RateDate(string value, bool compact)
    {
        string text = (value ?? "").Trim();
        DateTime parsed;
        if (!DateTime.TryParseExact(text, compact ? "yyyyMMdd" : "yyyy-MM-dd",
            CultureInfo.InvariantCulture, DateTimeStyles.None, out parsed)) return "";
        return text;
    }
    static string RateSymbols(string value)
    {
        string text = (value ?? "").Trim().ToUpperInvariant();
        if (text.Length == 0 || text.Length > 60) return "";
        foreach (string part in text.Split(','))
        {
            if (part.Length < 3 || part.Length > 4) return "";
            foreach (char ch in part) if (ch < 'A' || ch > 'Z') return "";
        }
        return text;
    }
    static readonly string[] RateSources = { "koreaexim", "ecb", "ecb-series" };
    static RateQuery ReadRateQuery(string path, out string error)
    {
        error = "rate-bad-request";
        RateQuery query = new RateQuery();
        string source = (QueryValue(path, "source") ?? "").Trim();
        if (Array.IndexOf(RateSources, source) < 0) return null;
        query.Source = source;
        if (source == "ecb-series")
        {
            query.Start = RateDate(QueryValue(path, "start"), false);
            query.End = RateDate(QueryValue(path, "end"), false);
            query.Symbols = RateSymbols(QueryValue(path, "symbols"));
            if (query.Start.Length == 0 || query.End.Length == 0 || query.Symbols.Length == 0) return null;
            if (String.CompareOrdinal(query.Start, query.End) > 0) return null;
        }
        else
        {
            query.Date = RateDate(QueryValue(path, "date"), source == "koreaexim");
            if (query.Date.Length == 0) return null;
        }
        error = "";
        return query;
    }

    static string RateCacheFile(string cacheKey)
    {
        return Path.Combine(RateCacheDir, TileCacheKey(cacheKey) + ".json");
    }
    /* 지난 날짜의 값은 다시 바뀌지 않으므로 그대로 믿고, 오늘 값만 20분이 지나면 새로 받는다.
       '오늘' 은 이 PC 의 달력 날짜다 — 수출입은행 고시가 한국 시간 기준이고 교실 PC 도 같은 시간대다. */
    static bool RateCacheFresh(RateQuery query, DateTime writtenUtc)
    {
        string newest = (query.NewestDay ?? "").Replace("-", "");
        string today = DateTime.Now.ToString("yyyyMMdd", CultureInfo.InvariantCulture);
        if (newest.Length == 8 && String.CompareOrdinal(newest, today) < 0) return true;
        return DateTime.UtcNow - writtenUtc <= RateTodayCacheMaxAge;
    }
    static bool TryReadCachedRate(RateQuery query, out byte[] data, out bool fresh)
    {
        data = null; fresh = false;
        try
        {
            lock (RateCacheLock)
            {
                string file = RateCacheFile(query.CacheKey);
                if (!File.Exists(file)) return false;
                data = File.ReadAllBytes(file);
                fresh = RateCacheFresh(query, File.GetLastWriteTimeUtc(file));
            }
            return data != null && data.Length > 0;
        }
        catch { data = null; fresh = false; return false; }
    }
    /* 잘못을 담은 응답은 캐시하지 않는다 — 인증 오류(result 3)나 아직 고시 전인 빈 배열을
       디스크에 남기면 키를 고치거나 11시가 지난 뒤에도 같은 잘못이 계속 되살아난다. */
    static bool RateBodyCacheable(byte[] data)
    {
        if (data == null || data.Length < 8) return false;
        string text = Encoding.UTF8.GetString(data);
        if (text.Trim() == "[]") return false;
        return !text.Contains("\"result\":2") && !text.Contains("\"result\":3") && !text.Contains("\"result\":4");
    }
    static void WriteCachedRate(RateQuery query, byte[] data)
    {
        if (!RateBodyCacheable(data)) return;
        try
        {
            lock (RateCacheLock)
            {
                Directory.CreateDirectory(RateCacheDir);
                string file = RateCacheFile(query.CacheKey);
                string temp = file + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp";
                File.WriteAllBytes(temp, data);
                if (File.Exists(file)) File.Delete(file);
                File.Move(temp, file);
                SweepRateCache();
            }
        }
        catch { }
    }
    // 하루치 JSON 이 10KB 남짓이라 좀처럼 차지 않지만, 기간 조회를 반복하면 늘어난다 — 오래된 것부터 지운다.
    static void SweepRateCache()
    {
        try
        {
            if (!Directory.Exists(RateCacheDir)) return;
            var files = new DirectoryInfo(RateCacheDir).GetFiles("*.json");
            long total = files.Sum(f => f.Length);
            if (total <= RateCacheMaxBytes) return;
            long target = (long)(RateCacheMaxBytes * 0.8);
            foreach (var file in files.OrderBy(f => f.LastWriteTimeUtc))
            {
                if (total <= target) break;
                long size = file.Length;
                try { file.Delete(); total -= size; } catch { }
            }
        }
        catch { }
    }

    static bool TryFetchExchangeRate(RateQuery query, string key, out byte[] data, out string error)
    {
        data = null; error = "rate-failed";
        try
        {
            if (!TileTlsReady)
            {
                try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { }
                TileTlsReady = true;
            }
            string url;
            if (query.Source == "koreaexim")
                url = KoreaEximRateEndpoint + "?authkey=" + Uri.EscapeDataString(key)
                    + "&searchdate=" + query.Date + "&data=AP01";
            else if (query.Source == "ecb-series")
                url = EcbRateEndpoint + query.Start + ".." + query.End + "?symbols=" + query.Symbols;
            else
                url = EcbRateEndpoint + query.Date;
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.UserAgent = "ClassDock/1.0 (local classroom app; https://github.com/songhwaseong/ClassDock)";
            request.Accept = "application/json";
            request.Timeout = 12000;
            request.ReadWriteTimeout = 12000;
            using (WebResponse response = request.GetResponse())
            using (Stream body = response.GetResponseStream())
            using (MemoryStream buffer = new MemoryStream())
            {
                byte[] chunk = new byte[8192];
                int read; long total = 0;
                while ((read = body.Read(chunk, 0, chunk.Length)) > 0)
                {
                    total += read;
                    if (total > RateMaxBytes) { error = "rate-too-large"; return false; }
                    buffer.Write(chunk, 0, read);
                }
                data = buffer.ToArray();
            }
            error = "";
            return true;
        }
        catch (WebException ex)
        {
            /* Frankfurter 는 자료가 없는 날짜에 404 로 답한다 — 연결이 끊긴 것과 구분해 알려야
               "인터넷을 확인하세요" 라는 엉뚱한 안내가 뜨지 않는다. */
            HttpWebResponse response = ex.Response as HttpWebResponse;
            if (response != null && response.StatusCode == HttpStatusCode.NotFound) error = "rate-no-data";
            data = null; return false;
        }
        catch { data = null; return false; }
    }

    /* 캐시 → 없거나 낡았으면 새로 받기 → 받기에 실패하면 낡은 캐시라도 돌려주기(타일 프록시와 같은 순서).
       cached=true 는 "받아오지 못해 저장해 둔 값을 대신 내준다" 는 뜻이고, 화면은 이걸 보고
       '○○일 기준 저장본' 이라고 밝힌다. */
    static bool TryExchangeRate(RateQuery query, out byte[] data, out bool cached, out string error)
    {
        data = null; cached = false; error = "rate-failed";
        string key = "";
        if (query.Source == "koreaexim")
        {
            key = CurrentExchangeRateKey();
            if (key.Length == 0) { error = "rate-key-required"; return false; }
        }
        byte[] stored; bool fresh;
        bool hasStored = TryReadCachedRate(query, out stored, out fresh);
        if (hasStored && fresh) { data = stored; error = ""; return true; }
        byte[] fetched; string fetchError;
        if (TryFetchExchangeRate(query, key, out fetched, out fetchError))
        {
            WriteCachedRate(query, fetched);
            data = fetched; error = "";
            return true;
        }
        if (hasStored) { data = stored; cached = true; error = ""; return true; }
        error = fetchError;
        return false;
    }

    static bool TryProxyMapTile(string url, out byte[] data, out string mime)
    {
        data = null; mime = "image/png";
        byte[] staleData = null;
        string staleMime = "image/png";
        try
        {
            Uri uri;
            if (!Uri.TryCreate(url ?? "", UriKind.Absolute, out uri)) return false;
            if (uri.Scheme != "https") return false;
            string host = uri.Host.ToLowerInvariant();
            bool allowed = false;
            foreach (string candidate in TileProxyHosts)
                if (host == candidate || host.EndsWith("." + candidate, StringComparison.Ordinal)) { allowed = true; break; }
            if (!allowed) return false;
            lock (TileCacheLock)
            {
                TileMemoryEntry cached;
                if (TileCache.TryGetValue(url, out cached))
                {
                    if (IsTileCacheFresh(cached.CachedAtUtc))
                    {
                        data = cached.Data; mime = cached.Mime;
                        return data != null && data.Length > 0;
                    }
                    staleData = cached.Data; staleMime = cached.Mime;
                }
            }
            // 7일 안에 받은 타일은 그대로 쓴다. 만료된 타일은 새로 받되, 오프라인이면 catch 에서
            // stale 복사본을 반환해 인터넷 없는 교실에서도 전에 본 지역은 계속 열리게 한다.
            DateTime cachedAtUtc;
            if (staleData == null && TryReadCachedTile(url, out data, out mime, out cachedAtUtc))
            {
                if (IsTileCacheFresh(cachedAtUtc))
                {
                    lock (TileCacheLock) TileCache[url] = new TileMemoryEntry(data, mime, cachedAtUtc);
                    return true;
                }
                staleData = data; staleMime = mime;
            }
            if (!TileTlsReady)
            {
                try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { }
                TileTlsReady = true;
            }
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(uri);
            request.UserAgent = "ClassDock/1.0 (local classroom app; PDF export)";
            request.Accept = "image/*";
            request.Timeout = 10000;
            request.ReadWriteTimeout = 10000;
            using (WebResponse response = request.GetResponse())
            using (Stream body = response.GetResponseStream())
            using (MemoryStream buffer = new MemoryStream())
            {
                byte[] chunk = new byte[16384];
                int read; long total = 0;
                while ((read = body.Read(chunk, 0, chunk.Length)) > 0)
                {
                    total += read;
                    if (total > 2 * 1024 * 1024)
                    {
                        if (staleData != null) { data = staleData; mime = staleMime; return true; }
                        return false;   // 타일치고 비정상적으로 크면 중단
                    }
                    buffer.Write(chunk, 0, read);
                }
                if (!string.IsNullOrEmpty(response.ContentType)) mime = response.ContentType;
                data = buffer.ToArray();
            }
            lock (TileCacheLock)
            {
                if (TileCache.Count > 500) TileCache.Clear();   // 단순 상한 — 지도 몇 장 분량이면 충분
                TileCache[url] = new TileMemoryEntry(data, mime, DateTime.UtcNow);
            }
            WriteCachedTile(url, data, mime);
            return true;
        }
        catch
        {
            // 갱신에 실패해도 디스크에 남은 만료 타일은 오프라인 fallback으로 계속 쓴다.
            if (staleData != null) { data = staleData; mime = staleMime; return true; }
            DateTime cachedAtUtc;
            if (TryReadCachedTile(url, out data, out mime, out cachedAtUtc)) return true;
            data = null; return false;
        }
    }

    // 번들된 Pyodide 코어 파일(vendor/pyodide/<파일명>)을 안전하게 읽어 적절한 MIME 과 돌려준다.
    // path 는 "/pyodide/<파일명>[?v=..]" 형태 — 파일명만 허용하고 하위경로·상위탈출(..)은 막는다.
    static bool TryReadPyodideFile(string path, out byte[] data, out string contentType)
    {
        data = null; contentType = "application/octet-stream";
        int q = path.IndexOf('?');
        string rel = (q >= 0 ? path.Substring(0, q) : path).Substring("/pyodide/".Length);
        rel = Uri.UnescapeDataString(rel);
        if (rel.Length == 0 || rel.IndexOf('/') >= 0 || rel.IndexOf('\\') >= 0 || rel.Contains("..")) return false;
        string full = Path.Combine(PyodideDir, rel);
        if (!File.Exists(full)) return false;
        data = File.ReadAllBytes(full);
        string ext = Path.GetExtension(rel).ToLowerInvariant();
        if (ext == ".wasm") contentType = "application/wasm";
        else if (ext == ".js") contentType = "text/javascript; charset=utf-8";
        else if (ext == ".json") contentType = "application/json; charset=utf-8";
        return true;
    }

    // ===== 최근 작업공간 — 사용자가 고른 원본 파일과 상대경로를 앱 전용 저장소에 보관 =====
    static List<WorkspaceFile> ParseWorkspace(byte[] body)
    {
        if (body == null || body.Length == 0) return new List<WorkspaceFile>();
        if (body.Length > WorkspaceMaxBytes) throw new Exception("workspace-too-large");
        int pos = 0;
        int count = ReadBundleInt(body, ref pos);
        if (count < 0 || count > 10000) throw new Exception("bad-workspace");
        List<WorkspaceFile> files = new List<WorkspaceFile>(count);
        for (int i = 0; i < count; i++)
        {
            string rel = ReadBundleString(body, ref pos);
            int len = ReadBundleInt(body, ref pos);
            if (len < 0 || pos + len > body.Length) throw new Exception("bad-workspace");
            string safe = SafeRelPath(rel);
            if (safe == null) throw new Exception("bad-workspace-path");
            byte[] data = new byte[len];
            Buffer.BlockCopy(body, pos, data, 0, len);
            pos += len;
            files.Add(new WorkspaceFile { Path = safe.Replace('\\', '/'), Data = data });
        }
        if (pos != body.Length) throw new Exception("bad-workspace");
        return files;
    }

    static byte[] SerializeWorkspace(IEnumerable<WorkspaceFile> files)
    {
        List<WorkspaceFile> list = new List<WorkspaceFile>(files);
        using (MemoryStream ms = new MemoryStream())
        using (BinaryWriter bw = new BinaryWriter(ms, new UTF8Encoding(false)))
        {
            bw.Write(list.Count);
            foreach (WorkspaceFile file in list)
            {
                byte[] path = Encoding.UTF8.GetBytes(file.Path);
                bw.Write(path.Length); bw.Write(path);
                bw.Write(file.Data.Length); bw.Write(file.Data);
                if (ms.Length > WorkspaceMaxBytes) throw new Exception("workspace-too-large");
            }
            bw.Flush();
            return ms.ToArray();
        }
    }

    // 교체 저장은 브라우저가 보낸 작업공간 바이너리 자체가 최종 저장 형식과 같다.
    // 경로·길이·중복을 검증한 뒤 그대로 기록하면 파일 데이터를 항목별로 복사하고
    // 다시 하나의 큰 배열로 직렬화하는 과정을 생략할 수 있다.
    static bool CanSaveWorkspaceDirectly(byte[] body, out int count)
    {
        count = 0;
        if (body == null || body.Length < 4) return false;
        if (body.Length > WorkspaceMaxBytes) throw new Exception("workspace-too-large");
        int pos = 0;
        count = ReadBundleInt(body, ref pos);
        if (count < 0 || count > 10000) throw new Exception("bad-workspace");
        bool direct = true;
        HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < count; i++)
        {
            string rel = ReadBundleString(body, ref pos);
            int len = ReadBundleInt(body, ref pos);
            if (len < 0 || pos + len > body.Length) throw new Exception("bad-workspace");
            string safe = SafeRelPath(rel);
            if (safe == null) throw new Exception("bad-workspace-path");
            string normalized = safe.Replace('\\', '/');
            if (!string.Equals(rel.Replace('\\', '/'), normalized, StringComparison.Ordinal) || !seen.Add(normalized))
                direct = false;
            pos += len;
        }
        if (pos != body.Length) throw new Exception("bad-workspace");
        return direct;
    }

    static void WriteWorkspaceAtomically(byte[] saved)
    {
        string dir = Path.GetDirectoryName(WorkspacePath);
        Directory.CreateDirectory(dir);
        string temp = WorkspacePath + ".tmp";
        File.WriteAllBytes(temp, saved);
        if (File.Exists(WorkspacePath)) File.Delete(WorkspacePath);
        File.Move(temp, WorkspacePath);
    }

    static int SaveWorkspace(byte[] body, bool replace)
    {
        int directCount = 0;
        bool direct = replace && CanSaveWorkspaceDirectly(body, out directCount);
        List<WorkspaceFile> incoming = direct ? null : ParseWorkspace(body);
        lock (WorkspaceLock)
        {
            if (direct)
            {
                WriteWorkspaceAtomically(body);
                return directCount;
            }
            Dictionary<string, WorkspaceFile> merged = new Dictionary<string, WorkspaceFile>(StringComparer.OrdinalIgnoreCase);
            if (!replace && File.Exists(WorkspacePath))
            {
                foreach (WorkspaceFile file in ParseWorkspace(File.ReadAllBytes(WorkspacePath))) merged[file.Path] = file;
            }
            foreach (WorkspaceFile file in incoming) merged[file.Path] = file;
            byte[] saved = SerializeWorkspace(merged.Values);
            WriteWorkspaceAtomically(saved);
            return merged.Count;
        }
    }

    static byte[] LoadWorkspace()
    {
        lock (WorkspaceLock)
        {
            try { return File.Exists(WorkspacePath) ? File.ReadAllBytes(WorkspacePath) : new byte[0]; }
            catch { return new byte[0]; }
        }
    }

    static void ClearWorkspace()
    {
        lock (WorkspaceLock)
        {
            try { if (File.Exists(WorkspacePath)) File.Delete(WorkspacePath); } catch { }
        }
    }

    static int RemoveWorkspaceFiles(byte[] body)
    {
        int pos = 0;
        int count = ReadBundleInt(body, ref pos);
        if (count < 0 || count > 10000) throw new Exception("bad-workspace-remove");
        HashSet<string> remove = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < count; i++)
        {
            string safe = SafeRelPath(ReadBundleString(body, ref pos));
            if (safe != null) remove.Add(safe.Replace('\\', '/'));
        }
        if (pos != body.Length) throw new Exception("bad-workspace-remove");

        lock (WorkspaceLock)
        {
            if (!File.Exists(WorkspacePath)) return 0;
            List<WorkspaceFile> kept = ParseWorkspace(File.ReadAllBytes(WorkspacePath));
            kept.RemoveAll(delegate(WorkspaceFile file) { return remove.Contains(file.Path); });
            if (kept.Count == 0)
            {
                try { File.Delete(WorkspacePath); } catch { }
                return 0;
            }
            byte[] saved = SerializeWorkspace(kept);
            string temp = WorkspacePath + ".tmp";
            File.WriteAllBytes(temp, saved);
            File.Delete(WorkspacePath);
            File.Move(temp, WorkspacePath);
            return kept.Count;
        }
    }

    // ===== PPTX → PDF 변환 (설치된 PowerPoint 를 late-bound COM 으로 구동) =====
    // STA 스레드에서 실행하고, 윈도우 없이(WithWindow=false) 열어 PDF 로 저장한다.
    static byte[] ConvertPptxToPdf(byte[] pptx)
    {
        string tmpDir = Path.Combine(Path.GetTempPath(), "moida_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmpDir);
        string inPath = Path.Combine(tmpDir, "in.pptx");
        string outPath = Path.Combine(tmpDir, "out.pdf");
        File.WriteAllBytes(inPath, pptx);

        byte[] result = null;
        Exception err = null;
        Thread t = new Thread(delegate()
        {
            try { result = RunPowerPointExport(inPath, outPath); }
            catch (Exception ex) { err = ex; }
        });
        t.IsBackground = true;
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        bool finished = t.Join(180000);   // 최대 3분(대형 덱 + PowerPoint 기동 여유)

        try { if (Directory.Exists(tmpDir)) Directory.Delete(tmpDir, true); } catch { }

        if (!finished) throw new Exception("timeout");
        if (err != null) throw err;
        if (result == null || result.Length == 0) throw new Exception("empty-pdf");
        return result;
    }

    static byte[] RunPowerPointExport(string inPath, string outPath)
    {
        Exception hiddenError = null;
        try
        {
            // 먼저 창을 만들지 않고 변환해 PowerPoint가 화면이나 작업 표시줄에 나타나는 일을 줄인다.
            return RunPowerPointExportAttempt(inPath, outPath, false);
        }
        catch (Exception ex)
        {
            hiddenError = ex;
        }

        try
        {
            // 숨김 Open이 불안정한 일부 Office 빌드에서만 최소화된 창으로 다시 시도한다.
            return RunPowerPointExportAttempt(inPath, outPath, true);
        }
        catch (Exception ex)
        {
            throw new Exception("hidden-open failed: " + FlattenMessage(hiddenError) + "; windowed-open failed: " + FlattenMessage(ex), ex);
        }
    }

    static byte[] RunPowerPointExportAttempt(string inPath, string outPath, bool withWindow)
    {
        Type pptType = Type.GetTypeFromProgID("PowerPoint.Application");
        if (pptType == null) throw new PowerPointMissingException();

        object app = null, presentations = null, pres = null;
        try
        {
            app = Activator.CreateInstance(pptType);
            TrySet(app, "DisplayAlerts", 1);        // ppAlertsNone — 대화상자 억제
            TrySet(app, "AutomationSecurity", 3);   // msoAutomationSecurityForceDisable — 매크로 차단
            if (withWindow)
            {
                TrySet(app, "Visible", -1);          // msoTrue. Some Office builds crash on hidden Open.
                TrySet(app, "WindowState", 2);       // ppWindowMinimized
            }
            presentations = Get(app, "Presentations");
            // Open(FileName, ReadOnly=msoTrue(-1), Untitled=msoFalse(0), WithWindow=msoFalse(0))
            pres = InvokeRetry(presentations, "Open", new object[] { inPath, -1, 0, withWindow ? -1 : 0 });
            // SaveAs(FileName, ppSaveAsPDF=32, EmbedTrueTypeFonts=msoFalse(0))
            try { if (File.Exists(outPath)) File.Delete(outPath); } catch { }
            InvokeRetry(pres, "SaveAs", new object[] { outPath, 32, 0 });
            InvokeRetry(pres, "Close", null);
        }
        finally
        {
            if (pres != null) { try { Marshal.ReleaseComObject(pres); } catch { } }
            if (presentations != null) { try { Marshal.ReleaseComObject(presentations); } catch { } }
            if (app != null)
            {
                try { Invoke(app, "Quit", null); } catch { }
                try { Marshal.ReleaseComObject(app); } catch { }
            }
            GC.Collect();
            GC.WaitForPendingFinalizers();
        }

        if (!File.Exists(outPath)) throw new Exception("no-output");
        return File.ReadAllBytes(outPath);
    }

    // ===== 대화형 파이썬 세션 — input() 프롬프트마다 브라우저에서 한 줄씩 전달 =====
    static string QueryValue(string path, string key)
    {
        int q = path.IndexOf('?');
        if (q < 0) return "";
        string[] pairs = path.Substring(q + 1).Split('&');
        foreach (string pair in pairs)
        {
            int eq = pair.IndexOf('=');
            string name = eq >= 0 ? pair.Substring(0, eq) : pair;
            if (name == key) return Uri.UnescapeDataString(eq >= 0 ? pair.Substring(eq + 1) : "");
        }
        return "";
    }

    // 드라이브 루트(예: D:\)를 루트로 써도 검증이 깨지지 않게 정규화.
    // "D:\" 를 TrimEnd 하면 "D:" 가 되는데, Path.GetFullPath("D:") 는 그 드라이브의
    // '현재 폴더'(예: D:\my)로 풀리므로 이후 재검증이 전부 실패한다 → 드라이브 루트는 구분자를 유지.
    static string NormalizeRootForCheck(string root)
    {
        string normalized = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (normalized.Length == 2 && normalized[1] == ':') normalized += Path.DirectorySeparatorChar;
        return normalized;
    }

    static bool IsPathInsideRoot(string root, string candidate, bool allowRoot=true)
    {
        if (string.IsNullOrEmpty(root) || string.IsNullOrEmpty(candidate)) return false;
        string normalizedRoot = NormalizeRootForCheck(root);
        string normalizedCandidate = Path.GetFullPath(candidate);
        if (allowRoot && string.Equals(
            normalizedCandidate.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            normalizedRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar),
            StringComparison.OrdinalIgnoreCase)) return true;
        string prefix = normalizedRoot.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
            ? normalizedRoot : normalizedRoot + Path.DirectorySeparatorChar;
        return normalizedCandidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    // 저장 루트 아래에서 이미 존재하는 재분석 지점(심볼릭 링크·junction)을 거치지 않게 한다.
    // 상대경로 검증만으로는 저장 루트 안의 링크가 외부 파일을 가리키는 경우를 막을 수 없기 때문이다.
    static bool HasReparsePointBelowRoot(string root, string full)
    {
        try
        {
            string normalizedRoot = NormalizeRootForCheck(root);
            string normalizedFull = Path.GetFullPath(full);
            if (!IsPathInsideRoot(normalizedRoot, normalizedFull, true)) return true;
            string relative = normalizedFull.Substring(normalizedRoot.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string current = normalizedRoot;
            foreach (string part in relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries))
            {
                current = Path.Combine(current, part);
                if (!File.Exists(current) && !Directory.Exists(current)) continue;
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return true;
            }
            return false;
        }
        catch { return true; }
    }

    static bool TryResolveSaveRootPath(string relativePath, out string full)
    {
        full = "";
        string safe = SafeRelPath(relativePath);
        if (safe == null) return false;
        try
        {
            string root = Path.GetFullPath(CurrentSaveRoot());
            string candidate = Path.GetFullPath(Path.Combine(root, safe));
            if (!IsPathInsideRoot(root, candidate, false) || HasReparsePointBelowRoot(root, candidate)) return false;
            full = candidate;
            return true;
        }
        catch { return false; }
    }

    static bool TryResolveSourceFolderPath(string id, string relativePath, bool allowRoot, out string root, out string full)
    {
        root = "";
        full = "";
        if (string.IsNullOrWhiteSpace(id)) return false;
        lock (SourceFolderLock)
        {
            if (!SourceFolders.TryGetValue(id, out root)) return false;
        }
        try
        {
            root = Path.GetFullPath(root);
            string rel = (relativePath ?? "").Trim();
            if (rel.Length == 0)
            {
                if (!allowRoot) return false;
                full = root;
                return Directory.Exists(full);
            }
            string safe = SafeRelPath(rel);
            if (safe == null) return false;
            string candidate = Path.GetFullPath(Path.Combine(root, safe));
            if (!IsPathInsideRoot(root, candidate, false) || HasReparsePointBelowRoot(root, candidate)) return false;
            full = candidate;
            return true;
        }
        catch { return false; }
    }

    static long UnixMilliseconds(DateTime value)
    {
        DateTime utc = value.Kind == DateTimeKind.Utc ? value : value.ToUniversalTime();
        return (long)(utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
    }

    static string SourceFolderEntryJson(string id, string relativePath)
    {
        string root, full;
        if (!TryResolveSourceFolderPath(id, relativePath, true, out root, out full))
            throw new UnauthorizedAccessException("bad-source-folder-path");
        if (Directory.Exists(full))
        {
            DirectoryInfo info = new DirectoryInfo(full);
            return "{\"kind\":\"directory\",\"name\":" + JsonString(info.Name)
                + ",\"size\":0,\"lastModified\":" + UnixMilliseconds(info.LastWriteTimeUtc) + "}";
        }
        if (File.Exists(full))
        {
            FileInfo info = new FileInfo(full);
            return "{\"kind\":\"file\",\"name\":" + JsonString(info.Name)
                + ",\"size\":" + info.Length
                + ",\"lastModified\":" + UnixMilliseconds(info.LastWriteTimeUtc) + "}";
        }
        throw new FileNotFoundException("source-entry-not-found");
    }

    static string SourceFolderListJson(string id, string relativePath)
    {
        string root, full;
        if (!TryResolveSourceFolderPath(id, relativePath, true, out root, out full) || !Directory.Exists(full))
            throw new DirectoryNotFoundException("source-directory-not-found");
        List<FileSystemInfo> entries = new List<FileSystemInfo>();
        foreach (FileSystemInfo entry in new DirectoryInfo(full).GetFileSystemInfos())
        {
            // 숨김 폴더(.git 등)는 순회하지 않되 .env 같은 점 파일은 기존 폴더 열기와 동일하게 전달한다.
            if (entry is DirectoryInfo && entry.Name.StartsWith(".", StringComparison.Ordinal)) continue;
            try { if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) continue; }
            catch { continue; }
            entries.Add(entry);
        }
        entries.Sort(delegate(FileSystemInfo a, FileSystemInfo b)
        {
            bool ad = a is DirectoryInfo, bd = b is DirectoryInfo;
            if (ad != bd) return ad ? -1 : 1;
            return string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase);
        });
        StringBuilder json = new StringBuilder("{\"items\":[");
        for (int i = 0; i < entries.Count; i++)
        {
            if (i > 0) json.Append(',');
            FileSystemInfo entry = entries[i];
            FileInfo file = entry as FileInfo;
            json.Append("{\"kind\":").Append(JsonString(file == null ? "directory" : "file"))
                .Append(",\"name\":").Append(JsonString(entry.Name))
                .Append(",\"size\":").Append(file == null ? 0 : file.Length)
                .Append(",\"lastModified\":").Append(UnixMilliseconds(entry.LastWriteTimeUtc))
                .Append('}');
        }
        return json.Append("]}").ToString();
    }

    // File.ReadAllBytes 는 FileShare.Read 로 열어, 다른 프로세스가 쓰기로 잡고 있는 파일(실행 중인
    // 파이썬의 로그 등)을 공유 위반으로 거부한다. 폴더 동기화는 그런 파일도 읽어야 하므로 쓰기·삭제
    // 공유를 허용해서 연다. 쓰는 중인 파일은 중간 상태를 읽을 수 있지만, 못 읽어 동기화 전체가
    // 실패하는 것보다 낫다.
    static byte[] ReadAllBytesShared(string path)
    {
        using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read,
                                              FileShare.ReadWrite | FileShare.Delete))
        {
            using (MemoryStream buffer = new MemoryStream())
            {
                byte[] chunk = new byte[1024 * 1024];
                int read;
                while ((read = fs.Read(chunk, 0, chunk.Length)) > 0) buffer.Write(chunk, 0, read);
                return buffer.ToArray();
            }
        }
    }

    static byte[] ReadSourceFolderFile(string id, string relativePath)
    {
        string root, full;
        if (!TryResolveSourceFolderPath(id, relativePath, false, out root, out full))
            throw new UnauthorizedAccessException("bad-source-folder-path");
        if (!File.Exists(full)) throw new FileNotFoundException("source-file-not-found");
        return ReadAllBytesShared(full);
    }

    static void WriteSourceFolderFile(string id, string relativePath, byte[] body)
    {
        string root, full;
        if (!TryResolveSourceFolderPath(id, relativePath, false, out root, out full))
            throw new UnauthorizedAccessException("bad-source-folder-path");
        string parent = Path.GetDirectoryName(full);
        if (string.IsNullOrEmpty(parent) || !Directory.Exists(parent))
            throw new DirectoryNotFoundException("source-parent-not-found");
        if (Directory.Exists(full)) throw new IOException("source-entry-is-directory");
        File.WriteAllBytes(full, body ?? new byte[0]);
    }

    static void CreateSourceFolderDirectory(string id, string relativePath)
    {
        string root, full;
        if (!TryResolveSourceFolderPath(id, relativePath, false, out root, out full))
            throw new UnauthorizedAccessException("bad-source-folder-path");
        if (File.Exists(full)) throw new IOException("source-entry-is-file");
        Directory.CreateDirectory(full);
    }

    static void RemoveSourceFolderEntry(string id, string relativePath, bool recursive)
    {
        string root, full;
        if (!TryResolveSourceFolderPath(id, relativePath, false, out root, out full))
            throw new UnauthorizedAccessException("bad-source-folder-path");
        if (File.Exists(full)) { File.Delete(full); return; }
        if (Directory.Exists(full)) { Directory.Delete(full, recursive); return; }
        throw new FileNotFoundException("source-entry-not-found");
    }

    static bool TryReadLocalFile(string path, out byte[] data, out string fileName)
    {
        data = null;
        fileName = "";
        if (string.IsNullOrWhiteSpace(path)) return false;
        string full;
        try
        {
            if (Path.IsPathRooted(path))
            {
                full = Path.GetFullPath(path);
            }
            else
            {
                if (!TryResolveSaveRootPath(path, out full)) return false;
            }
        }
        catch { return false; }
        if (!File.Exists(full)) return false;
        string ext = Path.GetExtension(full).ToLowerInvariant();
        if (ext != ".py" && ext != ".pyw" && ext != ".pyi" && ext != ".txt"
            && ext != ".db" && ext != ".sqlite" && ext != ".sqlite3") return false;
        FileInfo info;
        try { info = new FileInfo(full); }
        catch { return false; }
        if (info.Length > 5 * 1024 * 1024) return false;
        data = File.ReadAllBytes(full);
        fileName = Path.GetFileName(full);
        return true;
    }

    static string StartPythonKernel(byte[] body)
    {
        string interp = FindPython();
        if (interp == null) throw new PythonMissingException();
        if (body == null || body.Length == 0 || body.Length > 60 * 1024 * 1024)
            throw new Exception("bad-kernel-bundle");

        SweepPythonKernels();
        string id = Guid.NewGuid().ToString("N");
        string tempRoot = Path.Combine(Path.GetTempPath(), "moidapy_kernel_" + id);
        string runnerPath = Path.Combine(Path.GetTempPath(), "moidapy_kernel_runner_" + id + ".py");
        Directory.CreateDirectory(tempRoot);
        try
        {
            int pos = 0;
            string target = ReadBundleString(body, ref pos);
            if (SafeRelPath(target) == null) throw new Exception("bad-target");
            int count = ReadBundleInt(body, ref pos);
            if (count < 0 || count > 100000) throw new Exception("bad-bundle");
            for (int i = 0; i < count; i++)
            {
                string rel = ReadBundleString(body, ref pos);
                int len = ReadBundleInt(body, ref pos);
                if (len < 0 || pos + len > body.Length) throw new Exception("bad-bundle");
                string safe = SafeRelPath(rel);
                if (safe != null)
                {
                    string full = Path.Combine(tempRoot, safe);
                    string dir = Path.GetDirectoryName(full);
                    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                    File.WriteAllBytes(full, SubBytes(body, pos, len));
                }
                pos += len;
            }
            if (pos < body.Length) ReadBundleString(body, ref pos); // 초기 stdin(커널에서는 셀별 전달)
            string requestedCwd = "";
            if (pos < body.Length) requestedCwd = ReadBundleString(body, ref pos);
            if (pos < body.Length)
            {
                int dirCount = ReadBundleInt(body, ref pos);
                if (dirCount < 0 || dirCount > 100000) throw new Exception("bad-bundle");
                for (int i = 0; i < dirCount; i++)
                {
                    string safeDir = SafeRelPath(ReadBundleString(body, ref pos));
                    if (!string.IsNullOrEmpty(safeDir)) Directory.CreateDirectory(Path.Combine(tempRoot, safeDir));
                }
            }
            if (pos != body.Length) throw new Exception("bad-bundle");

            string workDir = ResolveBundleWorkDir(tempRoot, requestedCwd, tempRoot);
            File.WriteAllBytes(runnerPath, PythonKernelRunner);

            string args = (interp == "py" ? "-3 " : "") + "-u -X utf8 \"" + runnerPath + "\"";
            ProcessStartInfo psi = new ProcessStartInfo(interp, args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.RedirectStandardInput = true;
            psi.StandardOutputEncoding = new UTF8Encoding(false);
            psi.StandardErrorEncoding = new UTF8Encoding(false);
            psi.WorkingDirectory = workDir;
            psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            psi.EnvironmentVariables["PYTHONUNBUFFERED"] = "1";
            psi.EnvironmentVariables["MPLBACKEND"] = "Agg";
            psi.EnvironmentVariables["CLASSDOCK_KERNEL_ROOT"] = tempRoot;

            PythonKernel kernel = new PythonKernel();
            kernel.Id = id;
            kernel.TempRoot = tempRoot;
            kernel.RunnerPath = runnerPath;
            kernel.Process = new Process();
            kernel.Process.StartInfo = psi;
            kernel.Process.Start();
            StartLimitedReader(kernel.Process.StandardError, kernel.Stderr);
            lock (PyKernelsLock) PyKernels[id] = kernel;
            return id;
        }
        catch
        {
            try { if (File.Exists(runnerPath)) File.Delete(runnerPath); } catch { }
            try { if (Directory.Exists(tempRoot)) Directory.Delete(tempRoot, true); } catch { }
            throw;
        }
    }

    static string ExecutePythonKernel(string id, byte[] body)
    {
        PythonKernel kernel;
        lock (PyKernelsLock) if (!PyKernels.TryGetValue(id ?? "", out kernel))
            throw new Exception("kernel-not-found");
        if (body == null || body.Length == 0 || body.Length > 20 * 1024 * 1024)
            throw new Exception("bad-kernel-request");

        int pos = 0;
        int sourceLen = ReadBundleInt(body, ref pos);
        if (sourceLen < 0 || pos + sourceLen > body.Length) throw new Exception("bad-kernel-request");
        string source = Encoding.UTF8.GetString(body, pos, sourceLen);
        pos += sourceLen;
        int stdinLen = ReadBundleInt(body, ref pos);
        if (stdinLen < 0 || pos + stdinLen != body.Length) throw new Exception("bad-kernel-request");
        string stdin = Encoding.UTF8.GetString(body, pos, stdinLen);

        lock (kernel.ExecLock)
        {
            if (kernel.Process == null || kernel.Process.HasExited)
                throw new Exception("kernel-stopped: " + kernel.Stderr.GetText());
            kernel.LastUsed = DateTime.UtcNow;
            string request = "{\"action\":\"exec\",\"source\":" + JsonString(source) + ",\"stdin\":" + JsonString(stdin) + "}";
            string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(request));
            kernel.Process.StandardInput.WriteLine(encoded);
            kernel.Process.StandardInput.Flush();

            string responseLine = null;
            Exception readError = null;
            Thread reader = new Thread(delegate()
            {
                try { responseLine = kernel.Process.StandardOutput.ReadLine(); }
                catch (Exception ex) { readError = ex; }
            });
            reader.IsBackground = true;
            reader.Start();
            bool timedOut = false;
            bool memoryLimit = false;
            Stopwatch watch = Stopwatch.StartNew();
            while (!reader.Join(250))
            {
                if (watch.ElapsedMilliseconds >= PythonKernelExecutionTimeoutMs) { timedOut = true; break; }
                if (ProcessTreeWorkingSetBytes(kernel.Process.Id) > PythonProcessMemoryLimitBytes) { memoryLimit = true; break; }
            }
            if (timedOut || memoryLimit)
            {
                KillProcessTree(kernel.Process);
                try { reader.Join(2000); } catch { }
                kernel.Stderr.AppendLine(memoryLimit
                    ? "[메모리 제한: 노트북 커널 실행이 4GB를 넘어 종료했습니다.]"
                    : "[시간 초과: 노트북 셀 실행이 10분을 넘어 종료했습니다.]");
                throw new Exception(memoryLimit ? "kernel-memory-limit" : "kernel-timeout");
            }
            if (readError != null) throw readError;
            if (string.IsNullOrEmpty(responseLine))
                throw new Exception("kernel-stopped: " + kernel.Stderr.GetText());
            byte[] decoded;
            try { decoded = Convert.FromBase64String(responseLine.Trim()); }
            catch { throw new Exception("bad-kernel-response: " + responseLine); }
            string json = Encoding.UTF8.GetString(decoded);
            if (!json.TrimStart().StartsWith("{", StringComparison.Ordinal))
                throw new Exception("bad-kernel-response");
            kernel.LastUsed = DateTime.UtcNow;
            return json;
        }
    }

    static void StopPythonKernel(string id)
    {
        PythonKernel kernel = null;
        lock (PyKernelsLock)
        {
            if (PyKernels.TryGetValue(id ?? "", out kernel)) PyKernels.Remove(id ?? "");
        }
        if (kernel == null) return;
        KillProcessTree(kernel.Process);
        try { if (File.Exists(kernel.RunnerPath)) File.Delete(kernel.RunnerPath); } catch { }
        try { if (Directory.Exists(kernel.TempRoot)) Directory.Delete(kernel.TempRoot, true); } catch { }
    }

    static bool TryGetKernelFile(string id, string name, out byte[] data, out string fileName)
    {
        data = null; fileName = null;
        PythonKernel kernel;
        lock (PyKernelsLock) if (!PyKernels.TryGetValue(id ?? "", out kernel)) return false;
        string safe = SafeRelPath(name);
        if (safe == null) return false;
        string full = Path.Combine(kernel.TempRoot, safe);
        if (!File.Exists(full)) return false;
        try
        {
            FileInfo info = new FileInfo(full);
            if (info.Length > 40 * 1024 * 1024) return false;
            data = File.ReadAllBytes(full);
        }
        catch { return false; }
        fileName = Path.GetFileName(full);
        return true;
    }

    static void SweepPythonKernels()
    {
        List<PythonKernel> stale = new List<PythonKernel>();
        lock (PyKernelsLock)
        {
            List<PythonKernel> all = new List<PythonKernel>(PyKernels.Values);
            all.Sort(delegate(PythonKernel a, PythonKernel b) { return a.LastUsed.CompareTo(b.LastUsed); });
            DateTime now = DateTime.UtcNow;
            foreach (PythonKernel kernel in all)
                if ((now - kernel.LastUsed).TotalHours > 2) stale.Add(kernel);
            for (int i = 0; i < all.Count - 8; i++)
                if (!stale.Contains(all[i])) stale.Add(all[i]);
        }
        foreach (PythonKernel kernel in stale) StopPythonKernel(kernel.Id);
    }

    static List<int> ProcessTreeIds(int rootPid)
    {
        var parent = new Dictionary<int, int>();
        IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap != IntPtr.Zero && snap.ToInt64() != -1)
        {
            try
            {
                PROCESSENTRY32 pe = new PROCESSENTRY32();
                pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (Process32First(snap, ref pe))
                {
                    do { parent[(int)pe.th32ProcessID] = (int)pe.th32ParentProcessID; }
                    while (Process32Next(snap, ref pe));
                }
            }
            finally { CloseHandle(snap); }
        }
        var tree = new HashSet<int>();
        tree.Add(rootPid);
        bool changed = true;
        while (changed)
        {
            changed = false;
            foreach (var pair in parent)
                if (tree.Contains(pair.Value) && tree.Add(pair.Key)) changed = true;
        }
        return new List<int>(tree);
    }

    static void KillProcessTree(Process process)
    {
        if (process == null) return;
        int rootPid;
        try { rootPid = process.Id; } catch { return; }
        // taskkill 결과만 믿지 않는다. 부모가 먼저 끝났거나 새 자식이 생긴 경우에도
        // 스냅샷에서 찾은 후손 PID를 직접 종료하고 짧게 재확인한다.
        List<int> initialTree = ProcessTreeIds(rootPid);
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("taskkill", "/PID " + rootPid + " /T /F");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process killer = Process.Start(psi);
            if (killer != null) killer.WaitForExit(5000);
        }
        catch { }
        for (int attempt = 0; attempt < 3; attempt++)
        {
            List<int> tree = attempt == 0 ? initialTree : ProcessTreeIds(rootPid);
            foreach (int pid in tree)
            {
                if (pid == rootPid) continue;
                try { using (Process child = Process.GetProcessById(pid)) child.Kill(); } catch { }
            }
            try { using (Process root = Process.GetProcessById(rootPid)) root.Kill(); } catch { }
            if (attempt < 2) Thread.Sleep(100);
        }
    }

    static void EnableJobKillOnClose(IntPtr job)
    {
        if (job == IntPtr.Zero) return;
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, buffer, false);
            SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size);
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    static long ProcessTreeWorkingSetBytes(int rootPid)
    {
        var parent = new Dictionary<int, int>();
        IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap == IntPtr.Zero || snap.ToInt64() == -1) return 0;
        try
        {
            PROCESSENTRY32 pe = new PROCESSENTRY32();
            pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
            if (Process32First(snap, ref pe))
            {
                do { parent[(int)pe.th32ProcessID] = (int)pe.th32ParentProcessID; }
                while (Process32Next(snap, ref pe));
            }
        }
        finally { CloseHandle(snap); }

        var tree = new HashSet<int>();
        tree.Add(rootPid);
        bool changed = true;
        while (changed)
        {
            changed = false;
            foreach (var pair in parent)
                if (tree.Contains(pair.Value) && tree.Add(pair.Key)) changed = true;
        }
        long total = 0;
        foreach (int pid in tree)
        {
            try { using (Process child = Process.GetProcessById(pid)) total += child.WorkingSet64; }
            catch { }
        }
        return total;
    }

    static string ResolveTerminalWorkingDirectory(string requested, out bool fallbackUsed)
    {
        fallbackUsed = false;
        string fallback = CurrentSaveRoot();
        if (string.IsNullOrWhiteSpace(fallback) || !Directory.Exists(fallback))
            fallback = AppDomain.CurrentDomain.BaseDirectory;
        if (string.IsNullOrWhiteSpace(requested)) return Path.GetFullPath(fallback);

        string candidate = requested.Trim();
        if (!Path.IsPathRooted(candidate)) candidate = Path.Combine(fallback, candidate);
        candidate = Path.GetFullPath(candidate);
        if (File.Exists(candidate)) candidate = Path.GetDirectoryName(candidate);
        if (!string.IsNullOrWhiteSpace(candidate) && Directory.Exists(candidate)) return candidate;

        // 브라우저 폴더 드래그·복원 문서는 논리 경로만 알고 원본 절대경로에 접근하지 못할 수 있다.
        // 그 경로가 디스크에 없다고 명령 자체를 막지 말고, 가장 가까운 실제 상위 폴더에서 시작한다.
        fallbackUsed = true;
        string parent = candidate;
        while (!string.IsNullOrWhiteSpace(parent))
        {
            try
            {
                parent = Path.GetDirectoryName(parent.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                if (!string.IsNullOrWhiteSpace(parent) && Directory.Exists(parent)) return parent;
            }
            catch { break; }
        }
        return Path.GetFullPath(fallback);
    }

    static string PowerShellLiteral(string value)
    {
        return "'" + (value ?? "").Replace("'", "''") + "'";
    }

    static string TerminalCompletionJson(byte[] body)
    {
        if (body == null || body.Length == 0 || body.Length > 64 * 1024)
            throw new Exception("bad-terminal-completion");
        int pos = 0;
        string requestedCwd = ReadBundleString(body, ref pos);
        string fragment = ReadBundleString(body, ref pos);
        string directoryFlag = ReadBundleString(body, ref pos);
        if (pos != body.Length || fragment.IndexOf('\0') >= 0)
            throw new Exception("bad-terminal-completion");

        bool ignoredFallback;
        string cwd = ResolveTerminalWorkingDirectory(requestedCwd, out ignoredFallback);
        string typed = fragment ?? "";
        int separatorAt = Math.Max(typed.LastIndexOf('\\'), typed.LastIndexOf('/'));
        string typedDir = separatorAt >= 0 ? typed.Substring(0, separatorAt + 1) : "";
        string leaf = separatorAt >= 0 ? typed.Substring(separatorAt + 1) : typed;
        string lookupDir;
        if (typedDir.StartsWith("~\\", StringComparison.Ordinal) || typedDir.StartsWith("~/", StringComparison.Ordinal))
        {
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            lookupDir = Path.Combine(profile, typedDir.Substring(2).Replace('/', Path.DirectorySeparatorChar));
        }
        else if (Path.IsPathRooted(typedDir))
        {
            lookupDir = Path.GetFullPath(typedDir);
        }
        else
        {
            lookupDir = Path.GetFullPath(Path.Combine(cwd, typedDir.Replace('/', Path.DirectorySeparatorChar)));
        }
        if (!Directory.Exists(lookupDir)) return "{\"items\":[]}";

        bool directoriesOnly = directoryFlag == "1";
        List<FileSystemInfo> matches = new List<FileSystemInfo>();
        try
        {
            DirectoryInfo directory = new DirectoryInfo(lookupDir);
            foreach (DirectoryInfo item in directory.GetDirectories())
                if (item.Name.StartsWith(leaf, StringComparison.OrdinalIgnoreCase)) matches.Add(item);
            if (!directoriesOnly)
                foreach (FileInfo item in directory.GetFiles())
                    if (item.Name.StartsWith(leaf, StringComparison.OrdinalIgnoreCase)) matches.Add(item);
        }
        catch { return "{\"items\":[]}"; }
        matches.Sort(delegate(FileSystemInfo a, FileSystemInfo b)
        {
            bool ad = a is DirectoryInfo;
            bool bd = b is DirectoryInfo;
            if (ad != bd) return ad ? -1 : 1;
            return string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase);
        });

        char separator = typedDir.IndexOf('/') >= 0 && typedDir.IndexOf('\\') < 0 ? '/' : '\\';
        StringBuilder json = new StringBuilder("{\"items\":[");
        int limit = Math.Min(matches.Count, 120);
        for (int i = 0; i < limit; i++)
        {
            if (i > 0) json.Append(',');
            FileSystemInfo item = matches[i];
            bool isDirectory = item is DirectoryInfo;
            string value = typedDir + item.Name + (isDirectory ? separator.ToString() : "");
            json.Append("{\"value\":").Append(JsonString(value))
                .Append(",\"directory\":").Append(isDirectory ? "true" : "false").Append('}');
        }
        return json.Append("]}").ToString();
    }

    static string OpenTerminalSession(byte[] body)
    {
        if (body == null || body.Length == 0 || body.Length > 64 * 1024)
            throw new Exception("bad-terminal-request");
        int pos = 0;
        string requestedCwd = ReadBundleString(body, ref pos);
        if (pos != body.Length || requestedCwd.IndexOf('\0') >= 0)
            throw new Exception("bad-terminal-request");

        SweepTerminalSessions();
        TerminalSession session = new TerminalSession();
        session.Id = Guid.NewGuid().ToString("N");
        bool cwdFallback;
        session.Cwd = ResolveTerminalWorkingDirectory(requestedCwd, out cwdFallback);
        session.CwdFallback = cwdFallback;
        session.Marker = "__CLASSDOCK_TERMINAL_DONE_" + session.Id + "__";
        session.ScriptPath = Path.Combine(Path.GetTempPath(), "classdock_terminal_" + session.Id + ".ps1");

        // 명령은 UTF-8 Base64 한 줄로 전달한다. 스크립트블록을 현재 범위에 dot-source하여
        // cd, 환경변수와 PowerShell 변수가 다음 명령에도 그대로 유지되게 한다.
        string script =
            "$ErrorActionPreference = 'Continue'\r\n" +
            "$mnUtf8 = New-Object System.Text.UTF8Encoding $false\r\n" +
            "[Console]::InputEncoding = $mnUtf8\r\n" +
            "[Console]::OutputEncoding = $mnUtf8\r\n" +
            "$OutputEncoding = $mnUtf8\r\n" +
            "Set-Location -LiteralPath " + PowerShellLiteral(session.Cwd) + "\r\n" +
            "$mnMarker = " + PowerShellLiteral(session.Marker) + "\r\n" +
            "while (($mnLine = [Console]::In.ReadLine()) -ne $null) {\r\n" +
            "  $mnSep = $mnLine.IndexOf('|')\r\n" +
            "  if ($mnSep -lt 1) { continue }\r\n" +
            "  $mnSeq = $mnLine.Substring(0, $mnSep)\r\n" +
            "  $mnExitCode = 0\r\n" +
            "  try {\r\n" +
            "    $mnCommand = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($mnLine.Substring($mnSep + 1)))\r\n" +
            "    $global:LASTEXITCODE = $null\r\n" +
            "    $mnErrorCount = $Error.Count\r\n" +
            // 지속형 while 안에서 객체를 그대로 내보내면 Get-ChildItem(ls)도 속성 목록으로 풀린다.
            // 실제 콘솔 호스트처럼 Out-Default를 거치게 해 기본 Table/List 뷰와 열 정렬을 적용한다.
            "    . ([ScriptBlock]::Create($mnCommand)) | Out-Default\r\n" +
            "    $mnPipelineSucceeded = $?\r\n" +
            "    $mnSucceeded = $mnPipelineSucceeded -and ($Error.Count -eq $mnErrorCount)\r\n" +
            "    if ($null -ne $LASTEXITCODE) { $mnExitCode = [int]$LASTEXITCODE }\r\n" +
            "    elseif (-not $mnSucceeded) { $mnExitCode = 1 }\r\n" +
            "  } catch {\r\n" +
            "    [Console]::Error.WriteLine($_.Exception.Message)\r\n" +
            "    $mnExitCode = 1\r\n" +
            "  } finally {\r\n" +
            "    $mnCwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))\r\n" +
            "    [Console]::Out.WriteLine($mnMarker + '|' + $mnSeq + '|' + $mnExitCode + '|' + $mnCwd)\r\n" +
            "  }\r\n" +
            "}\r\n";
        File.WriteAllText(session.ScriptPath, script, new UTF8Encoding(true));

        string systemDir = Environment.GetFolderPath(Environment.SpecialFolder.System);
        string powershell = Path.Combine(systemDir, "WindowsPowerShell", "v1.0", "powershell.exe");
        if (!File.Exists(powershell)) powershell = "powershell.exe";
        ProcessStartInfo psi = new ProcessStartInfo(
            powershell,
            "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + session.ScriptPath + "\"");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = new UTF8Encoding(false);
        psi.StandardErrorEncoding = new UTF8Encoding(false);
        psi.WorkingDirectory = session.Cwd;

        session.Process = new Process();
        session.Process.StartInfo = psi;
        try
        {
            session.Process.Start();
            session.Input = new StreamWriter(session.Process.StandardInput.BaseStream, new UTF8Encoding(false));
            session.Input.AutoFlush = true;
            session.JobHandle = CreateJobObject(IntPtr.Zero, null);
            if (session.JobHandle != IntPtr.Zero)
            {
                EnableJobKillOnClose(session.JobHandle);
                if (!AssignProcessToJobObject(session.JobHandle, session.Process.Handle))
                {
                    CloseHandle(session.JobHandle);
                    session.JobHandle = IntPtr.Zero;
                }
            }
            lock (TerminalSessionsLock) TerminalSessions[session.Id] = session;
        }
        catch
        {
            if (session.JobHandle != IntPtr.Zero)
            {
                try { CloseHandle(session.JobHandle); } catch { }
                session.JobHandle = IntPtr.Zero;
            }
            try { if (session.Process != null) KillProcessTree(session.Process); } catch { }
            try { if (File.Exists(session.ScriptPath)) File.Delete(session.ScriptPath); } catch { }
            throw;
        }

        Thread outReader = StartTerminalOutputReader(session);
        Thread errReader = StartTerminalErrorReader(session);
        Thread watcher = new Thread(delegate()
        {
            bool exited = false;
            while (!exited)
            {
                try { exited = session.Process.WaitForExit(250); } catch { break; }
                if (exited) break;
                bool running;
                lock (session.Sync) { running = session.CommandRunning; }
                if (!running) continue;
                bool memoryLimit = ProcessTreeWorkingSetBytes(session.Process.Id) > PythonProcessMemoryLimitBytes;
                if (memoryLimit)
                {
                    lock (session.Sync)
                    {
                        session.Stderr.AppendLine("\n[메모리 제한: 터미널 명령이 4GB를 넘어 종료했습니다.]");
                    }
                    StopTerminalSession(session.Id);
                    break;
                }
            }
            try { session.Process.WaitForExit(2000); } catch { }
            try { outReader.Join(2000); errReader.Join(2000); } catch { }
            int processCode;
            try { processCode = session.Process.ExitCode; } catch { processCode = -1; }
            IntPtr completedJob = IntPtr.Zero;
            lock (session.Sync)
            {
                session.ShellExited = true;
                if (session.CommandRunning)
                {
                    session.CommandRunning = false;
                    session.CommandComplete = true;
                    session.ExitCode = session.StopRequested ? 130 : processCode;
                }
                session.DoneAt = DateTime.UtcNow;
                completedJob = session.JobHandle;
                session.JobHandle = IntPtr.Zero;
            }
            if (completedJob != IntPtr.Zero) try { CloseHandle(completedJob); } catch { }
            try { if (File.Exists(session.ScriptPath)) File.Delete(session.ScriptPath); } catch { }
            SweepTerminalSessions();
        });
        watcher.IsBackground = true;
        watcher.Start();
        bool reportFallback = session.CwdFallback;
        session.CwdFallback = false;
        return "{\"id\":" + JsonString(session.Id)
            + ",\"cwd\":" + JsonString(session.Cwd)
            + ",\"cwdFallback\":" + (reportFallback ? "true" : "false") + "}";
    }

    static Thread StartTerminalOutputReader(TerminalSession session)
    {
        Thread thread = new Thread(delegate()
        {
            try
            {
                string prefix = session.Marker + "|";
                ReadTerminalLines(session.Process.StandardOutput.BaseStream, delegate(string line)
                {
                    if (line.StartsWith(prefix, StringComparison.Ordinal))
                    {
                        string[] parts = line.Split(new char[] { '|' }, 4);
                        int sequence;
                        int code;
                        if (parts.Length == 4 && int.TryParse(parts[1], out sequence) && int.TryParse(parts[2], out code))
                        {
                            string nextCwd = "";
                            try { nextCwd = Encoding.UTF8.GetString(Convert.FromBase64String(parts[3])); } catch { }
                            lock (session.Sync)
                            {
                                if (sequence == session.Sequence)
                                {
                                    if (!string.IsNullOrWhiteSpace(nextCwd) && Directory.Exists(nextCwd)) session.Cwd = nextCwd;
                                    session.ExitCode = code;
                                    session.CommandRunning = false;
                                    session.CommandComplete = true;
                                    session.LastUsed = DateTime.UtcNow;
                                }
                            }
                            return;
                        }
                    }
                    lock (session.Sync) session.Stdout.AppendLine(line);
                });
            }
            catch { }
        });
        thread.IsBackground = true;
        thread.Start();
        return thread;
    }

    static Thread StartTerminalErrorReader(TerminalSession session)
    {
        Thread thread = new Thread(delegate()
        {
            try
            {
                ReadTerminalLines(session.Process.StandardError.BaseStream, delegate(string line)
                {
                    lock (session.Sync) session.Stderr.AppendLine(line);
                });
            }
            catch { }
        });
        thread.IsBackground = true;
        thread.Start();
        return thread;
    }

    static readonly Encoding StrictTerminalUtf8 = new UTF8Encoding(false, true);
    static readonly Encoding TerminalOemEncoding = CreateTerminalOemEncoding();

    static Encoding CreateTerminalOemEncoding()
    {
        try { return Encoding.GetEncoding((int)GetOEMCP()); }
        catch { return Encoding.Default; }
    }

    // PowerShell itself writes UTF-8, but legacy Windows commands such as tree.com write
    // the active OEM code page directly to the redirected pipe. Decode each complete line
    // as strict UTF-8 first and fall back to the Windows OEM encoding only when necessary.
    static string DecodeTerminalLine(byte[] bytes, int count)
    {
        try { return StrictTerminalUtf8.GetString(bytes, 0, count); }
        catch (DecoderFallbackException) { return TerminalOemEncoding.GetString(bytes, 0, count); }
    }

    static void ReadTerminalLines(Stream stream, Action<string> onLine)
    {
        byte[] buffer = new byte[4096];
        List<byte> pending = new List<byte>();
        int read;
        while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
        {
            for (int i = 0; i < read; i++)
            {
                byte value = buffer[i];
                if (value != (byte)'\n')
                {
                    pending.Add(value);
                    continue;
                }
                int count = pending.Count;
                if (count > 0 && pending[count - 1] == (byte)'\r') count--;
                byte[] line = pending.ToArray();
                pending.Clear();
                onLine(DecodeTerminalLine(line, count));
            }
        }
        if (pending.Count > 0)
        {
            int count = pending.Count;
            if (pending[count - 1] == (byte)'\r') count--;
            onLine(DecodeTerminalLine(pending.ToArray(), count));
        }
    }

    static void RunTerminalCommand(string id, byte[] body)
    {
        if (body == null || body.Length == 0 || body.Length > 1024 * 1024)
            throw new Exception("bad-terminal-command");
        int pos = 0;
        string command = ReadBundleString(body, ref pos);
        if (pos != body.Length || string.IsNullOrWhiteSpace(command) || command.IndexOf('\0') >= 0)
            throw new Exception("bad-terminal-command");
        TerminalSession session;
        lock (TerminalSessionsLock) if (!TerminalSessions.TryGetValue(id ?? "", out session))
            throw new Exception("terminal-session-not-found");
        lock (session.Sync)
        {
            if (session.ShellExited) throw new Exception("terminal-session-stopped");
            if (session.CommandRunning) throw new Exception("terminal-command-busy");
            try { if (session.Process.HasExited) throw new Exception("terminal-session-stopped"); }
            catch (InvalidOperationException) { throw new Exception("terminal-session-stopped"); }
            session.Stdout = new LimitedTextBuffer();
            session.Stderr = new LimitedTextBuffer();
            session.ExitCode = -1;
            session.StopRequested = false;
            session.CommandComplete = false;
            session.CommandRunning = true;
            session.CommandStartedAt = DateTime.UtcNow;
            session.LastUsed = DateTime.UtcNow;
            session.Sequence++;
            string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(command));
            try { session.Input.WriteLine(session.Sequence.ToString() + "|" + encoded); }
            catch
            {
                session.CommandRunning = false;
                session.CommandComplete = true;
                throw new Exception("terminal-session-stopped");
            }
        }
    }

    static string PollTerminalSession(string id)
    {
        TerminalSession session;
        lock (TerminalSessionsLock) if (!TerminalSessions.TryGetValue(id ?? "", out session))
            return "{\"complete\":true,\"alive\":false,\"code\":-1,\"stdout\":\"\",\"stderr\":\"터미널 세션을 찾지 못했습니다.\",\"cwd\":\"\"}";
        lock (session.Sync)
        {
            return "{\"complete\":" + (session.CommandComplete ? "true" : "false")
                + ",\"alive\":" + (session.ShellExited ? "false" : "true")
                + ",\"stopped\":" + (session.StopRequested ? "true" : "false")
                + ",\"code\":" + session.ExitCode
                + ",\"stdout\":" + JsonString(session.Stdout.GetText())
                + ",\"stderr\":" + JsonString(session.Stderr.GetText())
                + ",\"cwd\":" + JsonString(session.Cwd)
                + ",\"cwdFallback\":" + (session.CwdFallback ? "true" : "false") + "}";
        }
    }

    static void StopTerminalSession(string id)
    {
        TerminalSession session = null;
        lock (TerminalSessionsLock) TerminalSessions.TryGetValue(id ?? "", out session);
        if (session == null) return;
        IntPtr job;
        lock (session.Sync)
        {
            session.StopRequested = true;
            if (session.CommandRunning) session.Stderr.AppendLine("[명령 실행을 중지했습니다.]");
            job = session.JobHandle;
        }
        if (job != IntPtr.Zero) try { TerminateJobObject(job, 130); } catch { }
        KillProcessTree(session.Process);
    }

    static void SweepTerminalSessions()
    {
        List<TerminalSession> remove = new List<TerminalSession>();
        lock (TerminalSessionsLock)
        {
            List<TerminalSession> done = new List<TerminalSession>();
            foreach (TerminalSession session in TerminalSessions.Values)
                if (session.ShellExited) done.Add(session);
            done.Sort(delegate(TerminalSession a, TerminalSession b) { return a.DoneAt.CompareTo(b.DoneAt); });
            DateTime now = DateTime.UtcNow;
            foreach (TerminalSession session in done)
                if ((now - session.DoneAt).TotalMinutes > 15) remove.Add(session);
            for (int i = 0; i < done.Count - 24; i++)
                if (!remove.Contains(done[i])) remove.Add(done[i]);
            foreach (TerminalSession session in remove) TerminalSessions.Remove(session.Id);
        }
        foreach (TerminalSession session in remove)
            try { if (File.Exists(session.ScriptPath)) File.Delete(session.ScriptPath); } catch { }
    }

    static string StartPythonSession(byte[] body, bool bundle)
    {
        string interp = FindPython();
        if (interp == null) throw new PythonMissingException();

        SweepRetainedSessions();   // 새 실행 시작 시 오래된 보존 세션의 작업폴더 정리

        string tempRoot = Path.Combine(Path.GetTempPath(), "moidapy_session_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempRoot);
        string scriptPath;
        string workDir;
        try
        {
            if (!bundle)
            {
                byte[] src = body;
                try
                {
                    int pos = 0;
                    int sourceLen = ReadBundleInt(body, ref pos);
                    if (sourceLen >= 0 && pos + sourceLen + 4 <= body.Length)
                    {
                        byte[] parsed = new byte[sourceLen];
                        Buffer.BlockCopy(body, pos, parsed, 0, sourceLen);
                        pos += sourceLen;
                        int stdinLen = ReadBundleInt(body, ref pos);
                        if (stdinLen >= 0 && pos + stdinLen == body.Length) src = parsed;
                    }
                }
                catch { }
                scriptPath = Path.Combine(tempRoot, "script.py");
                File.WriteAllBytes(scriptPath, src);
                workDir = tempRoot;
            }
            else
            {
                int pos = 0;
                string target = ReadBundleString(body, ref pos);
                int count = ReadBundleInt(body, ref pos);
                if (count < 0 || count > 100000) throw new Exception("bad-bundle");
                string targetSafe = SafeRelPath(target);
                if (targetSafe == null) throw new Exception("bad-target");
                for (int i = 0; i < count; i++)
                {
                    string rel = ReadBundleString(body, ref pos);
                    int len = ReadBundleInt(body, ref pos);
                    if (len < 0 || pos + len > body.Length) throw new Exception("bad-bundle");
                    string safe = SafeRelPath(rel);
                    if (safe != null)
                    {
                        string full = Path.Combine(tempRoot, safe);
                        string dir = Path.GetDirectoryName(full);
                        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                        File.WriteAllBytes(full, SubBytes(body, pos, len));
                    }
                    pos += len;
                }
                if (pos < body.Length) ReadBundleString(body, ref pos); // 표준 입력은 대화형 세션에서 별도 전달
                string requestedCwd = "";
                if (pos < body.Length) requestedCwd = ReadBundleString(body, ref pos);
                if (pos < body.Length)
                {
                    int dirCount = ReadBundleInt(body, ref pos);
                    if (dirCount < 0 || dirCount > 100000) throw new Exception("bad-bundle");
                    for (int i = 0; i < dirCount; i++)
                    {
                        string safeDir = SafeRelPath(ReadBundleString(body, ref pos));
                        if (!string.IsNullOrEmpty(safeDir)) Directory.CreateDirectory(Path.Combine(tempRoot, safeDir));
                    }
                }
                if (pos != body.Length) throw new Exception("bad-bundle");
                scriptPath = Path.Combine(tempRoot, targetSafe);
                if (!File.Exists(scriptPath)) throw new Exception("target-not-found");
                workDir = ResolveBundleWorkDir(tempRoot, requestedCwd, Path.GetDirectoryName(scriptPath));
            }
            return StartPythonSessionProcess(interp, scriptPath, workDir, tempRoot);
        }
        catch
        {
            try { Directory.Delete(tempRoot, true); } catch { }
            throw;
        }
    }

    static byte[] SubBytes(byte[] source, int offset, int count)
    {
        byte[] result = new byte[count];
        Buffer.BlockCopy(source, offset, result, 0, count);
        return result;
    }

    static string StartPythonSessionProcess(string interp, string scriptPath, string workDir, string tempRoot)
    {
        PythonSession session = new PythonSession();
        session.Id = Guid.NewGuid().ToString("N");
        session.TempRoot = tempRoot;
        session.RunnerPath = Path.Combine(Path.GetTempPath(), "moidapy_runner_" + session.Id + ".py");
        session.PlotDir = Path.Combine(Path.GetTempPath(), "moidapy_plots_" + session.Id);
        Directory.CreateDirectory(session.PlotDir);
        SnapshotInputs(session);   // 실행 전 작업폴더 파일 목록 기록(나중에 생성/변경된 출력 파일을 구분)
        File.WriteAllText(session.RunnerPath,
            "import os, runpy, sys\n" +
            "sys.argv[0] = os.environ['CLASSDOCK_SCRIPT']\n" +
            "_ps_script_dir = os.path.dirname(os.environ['CLASSDOCK_SCRIPT'])\n" +
            "_ps_project_root = os.environ.get('CLASSDOCK_PROJECT_ROOT', '')\n" +
            "_ps_paths = []\n" +
            "_ps_cur = _ps_script_dir\n" +
            "while _ps_cur:\n" +
            "    _ps_paths.append(_ps_cur)\n" +
            "    if _ps_project_root and os.path.normcase(os.path.abspath(_ps_cur)) == os.path.normcase(os.path.abspath(_ps_project_root)):\n" +
            "        break\n" +
            "    _ps_next = os.path.dirname(_ps_cur)\n" +
            "    if _ps_next == _ps_cur:\n" +
            "        break\n" +
            "    _ps_cur = _ps_next\n" +
            "for _ps_path in reversed(_ps_paths):\n" +
            "    if _ps_path and _ps_path not in sys.path:\n" +
            "        sys.path.insert(0, _ps_path)\n" +
            "try:\n" +
            "    _ps_vars = runpy.run_path(os.environ['CLASSDOCK_SCRIPT'], run_name='__main__')\n" +
            "finally:\n" +
            "    try:\n" +
            "        import matplotlib.pyplot as _ps_plt\n" +
            "        for _ps_i, _ps_n in enumerate(_ps_plt.get_fignums()[:8]):\n" +
            "            _ps_plt.figure(_ps_n).savefig(os.path.join(os.environ['CLASSDOCK_PLOT_DIR'], 'plot_%02d.png' % _ps_i), bbox_inches='tight')\n" +
            "        _ps_plt.close('all')\n" +
            "    except Exception:\n" +
            "        pass\n" +
            "    try:\n" +
            "        import json as _ps_json, types as _ps_types\n" +
            "        _ps_items = []\n" +
            "        for _ps_name in sorted(_ps_vars):\n" +
            "            if not _ps_name or _ps_name.startswith('_'):\n" +
            "                continue\n" +
            "            _ps_value = _ps_vars[_ps_name]\n" +
            "            if isinstance(_ps_value, (_ps_types.ModuleType, _ps_types.FunctionType, _ps_types.BuiltinFunctionType, type)) or callable(_ps_value):\n" +
            "                continue\n" +
            "            try:\n" +
            "                _ps_text = repr(_ps_value)\n" +
            "            except Exception:\n" +
            "                _ps_text = '<값을 표시할 수 없음>'\n" +
            "            if len(_ps_text) > 600:\n" +
            "                _ps_text = _ps_text[:599] + '…'\n" +
            "            _ps_items.append({'name': _ps_name[:120], 'type': type(_ps_value).__name__[:120], 'value': _ps_text})\n" +
            "            if len(_ps_items) >= 80:\n" +
            "                break\n" +
            "        with open(os.path.join(os.environ['CLASSDOCK_PLOT_DIR'], 'variables.json'), 'w', encoding='utf-8') as _ps_file:\n" +
            "            _ps_json.dump(_ps_items, _ps_file, ensure_ascii=False)\n" +
            "    except Exception:\n" +
            "        pass\n", new UTF8Encoding(false));

        string args = (interp == "py" ? "-3 " : "") + "-u -X utf8 \"" + session.RunnerPath + "\"";
        ProcessStartInfo psi = new ProcessStartInfo(interp, args);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.RedirectStandardInput = true;
        psi.StandardOutputEncoding = new UTF8Encoding(false);
        psi.StandardErrorEncoding = new UTF8Encoding(false);
        psi.WorkingDirectory = workDir;
        psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        psi.EnvironmentVariables["PYTHONUNBUFFERED"] = "1";
        psi.EnvironmentVariables["MPLBACKEND"] = "Agg";
        // 작업폴더의 다른 .py 를 import 하면 파이썬이 __pycache__/*.pyc 를 자동으로 만든다. 학생이 만든 적 없는
        // 파일이 "실행이 만든 파일"에 섞이고 다음 실행 작업폴더로도 이어지므로 자동 생성을 끈다.
        // (py_compile 처럼 코드가 직접 만드는 .pyc 는 생길 수 있지만 결과 목록에서는 아래 안전망으로 제외한다)
        psi.EnvironmentVariables["PYTHONDONTWRITEBYTECODE"] = "1";
        psi.EnvironmentVariables["CLASSDOCK_SCRIPT"] = scriptPath;
        psi.EnvironmentVariables["CLASSDOCK_PROJECT_ROOT"] = tempRoot;
        psi.EnvironmentVariables["CLASSDOCK_PLOT_DIR"] = session.PlotDir;

        session.Process = new Process();
        session.Process.StartInfo = psi;
        session.Process.Start();
        lock (PySessionsLock) PySessions[session.Id] = session;

        Thread outReader = StartLimitedReader(session.Process.StandardOutput, session.Stdout);
        Thread errReader = StartLimitedReader(session.Process.StandardError, session.Stderr);
        Thread watcher = new Thread(delegate()
        {
            bool exited = false;
            bool memoryLimit = false;
            Stopwatch watch = Stopwatch.StartNew();
            while (!exited && watch.ElapsedMilliseconds < 30 * 60 * 1000)
            {
                try { exited = session.Process.WaitForExit(500); } catch { break; }
                if (!exited && ProcessTreeWorkingSetBytes(session.Process.Id) > PythonProcessMemoryLimitBytes)
                {
                    memoryLimit = true;
                    break;
                }
            }
            if (!exited)
            {
                session.Stderr.AppendLine(memoryLimit
                    ? "\n[메모리 제한: 대화형 실행이 4GB를 넘어 종료했습니다.]"
                    : "\n[시간 초과: 대화형 실행을 30분 후 종료했습니다.]");
                KillProcessTree(session.Process);
                try { session.Process.WaitForExit(2000); } catch { }
            }
            try { outReader.Join(2000); errReader.Join(2000); } catch { }
            try { session.ExitCode = session.Process.ExitCode; } catch { session.ExitCode = -1; }
            string outputsJson = ScanOutputs(session);
            session.ImagesJson = ReadPlotImagesJson(session.PlotDir);
            session.VariablesJson = ReadPythonVariablesJson(session.PlotDir);
            lock (session.Sync) { session.OutputsJson = outputsJson; session.DoneAt = DateTime.UtcNow; session.Complete = true; }
            CleanupRunnerAndPlots(session);   // 러너·그림만 정리하고 작업폴더(TempRoot)는 출력 다운로드용으로 보존
            SweepRetainedSessions();
        });
        watcher.IsBackground = true;
        watcher.Start();
        return session.Id;
    }

    static Thread StartLimitedReader(StreamReader reader, LimitedTextBuffer target)
    {
        Thread thread = new Thread(delegate()
        {
            char[] buffer = new char[256];
            try
            {
                int read;
                while ((read = reader.Read(buffer, 0, buffer.Length)) > 0)
                    target.Append(buffer, 0, read);
            }
            catch { }
        });
        thread.IsBackground = true;
        thread.Start();
        return thread;
    }

    static string PollPythonSession(string id, string knownOut, string knownErr)
    {
        PythonSession session;
        lock (PySessionsLock) if (!PySessions.TryGetValue(id ?? "", out session))
            return "{\"complete\":true,\"code\":-1,\"stdout\":\"\",\"stderr\":\"세션을 찾지 못했습니다.\",\"images\":[]}";
        lock (session.Sync)
        {
            // 증분 폴링: 클라이언트가 이미 받은 출력 길이(so/se)를 보내면, 그대로면 본문 없이 짧게,
            // 자랐으면 그 이후 "새 내용만" 보낸다. 누적 출력(최대 1MB+)을 매 폴마다 만들고 브라우저가
            // 파싱하면 출력이 커질수록 폴 한 사이클이 느려져 정지 반응까지 함께 밀린다.
            // 버퍼는 덧붙이기 전용이라 길이 오프셋이 그대로 이어붙이기 지점이 된다.
            int so = 0, se = 0;
            bool known = int.TryParse(knownOut ?? "", out so) && int.TryParse(knownErr ?? "", out se)
                && so >= 0 && se >= 0
                && so <= session.Stdout.TextLength && se <= session.Stderr.TextLength;
            if (known && !session.Complete
                && so == session.Stdout.TextLength && se == session.Stderr.TextLength)
                return "{\"complete\":false,\"unchanged\":true}";
            if (known)
                return "{\"complete\":" + (session.Complete ? "true" : "false")
                     + ",\"code\":" + session.ExitCode
                     + ",\"stdoutDelta\":" + JsonString(session.Stdout.GetTextFrom(so))
                     + ",\"stderrDelta\":" + JsonString(session.Stderr.GetTextFrom(se))
                     + ",\"echoes\":" + BuildEchoesJson(session.Echoes)
                     + ",\"images\":" + session.ImagesJson
                     + ",\"variables\":" + session.VariablesJson
                     + ",\"outputs\":" + session.OutputsJson + "}";
            return "{\"complete\":" + (session.Complete ? "true" : "false")
                 + ",\"code\":" + session.ExitCode
                 + ",\"stdout\":" + JsonString(session.Stdout.GetText())
                 + ",\"stderr\":" + JsonString(session.Stderr.GetText())
                 + ",\"echoes\":" + BuildEchoesJson(session.Echoes)
                 + ",\"images\":" + session.ImagesJson
                 + ",\"variables\":" + session.VariablesJson
                 + ",\"outputs\":" + session.OutputsJson + "}";
        }
    }

    // 입력 에코 구간 목록 → JSON [[시작,길이],...] (세션 Sync 잠금 안에서 호출)
    static string BuildEchoesJson(List<int[]> echoes)
    {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < echoes.Count; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append('[').Append(echoes[i][0]).Append(',').Append(echoes[i][1]).Append(']');
        }
        return sb.Append(']').ToString();
    }

    static void SendPythonSessionInput(string id, string input)
    {
        PythonSession session;
        lock (PySessionsLock) if (!PySessions.TryGetValue(id ?? "", out session)) throw new Exception("session-not-found");
        lock (session.Sync)
        {
            if (session.Complete) throw new Exception("session-complete");
            byte[] bytes = Encoding.UTF8.GetBytes((input ?? "") + "\n");
            // 파이프 stdin은 에코되지 않으므로 터미널처럼 표시한다. 반드시 stdin 에 쓰기 "전에" 에코를 버퍼에 넣는다.
            // 먼저 쓰면(flush) 파이썬이 즉시 다음 input() 프롬프트를 출력해, 리더 스레드가 그 프롬프트를
            // 에코보다 먼저 버퍼에 담아 "이름 입력 : 나이 입력 : 송화성"처럼 순서가 뒤섞인다.
            int echoStart = session.Stdout.TextLength;
            session.Stdout.AppendLine(input ?? "");
            int echoLen = (input ?? "").Length;
            // 에코가 기대 위치에 정확히 들어갔을 때만 구간을 기록한다. 4MB 상한 절단이나 리더 스레드의
            // 동시 append 로 오프셋이 어긋난 경우엔 기록을 생략 — 그 입력만 색 없이 표시될 뿐 안전하다.
            if (echoLen > 0 && session.Stdout.TextLength == echoStart + echoLen + Environment.NewLine.Length)
                session.Echoes.Add(new int[] { echoStart, echoLen });
            session.Process.StandardInput.BaseStream.Write(bytes, 0, bytes.Length);
            session.Process.StandardInput.BaseStream.Flush();
        }
    }

    static void StopPythonSession(string id)
    {
        PythonSession session = null;
        lock (PySessionsLock) PySessions.TryGetValue(id ?? "", out session);
        if (session == null) return;
        KillProcessTree(session.Process);
        // 완료 세션은 맵·작업폴더를 유지해 출력 파일을 다운로드할 수 있게 둔다(보존 정리는 SweepRetainedSessions 가 담당).
        // 프로세스를 죽이면 watcher 가 곧 출력 수집·완료 처리한다.
    }

    // 실행 전 작업폴더 파일(입력)을 기록 — 완료 후 새로 생기거나 바뀐 파일만 "출력"으로 잡기 위함
    static void SnapshotInputs(PythonSession session)
    {
        try
        {
            string root = session.TempRoot;
            foreach (string f in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
            {
                string rel = f.Substring(root.Length).TrimStart('\\', '/').Replace('\\', '/');
                FileInfo fi = new FileInfo(f);
                session.InitSize[rel] = fi.Length;
                session.InitMtime[rel] = fi.LastWriteTimeUtc.Ticks;
            }
        }
        catch { }
    }

    // 파이썬 바이트코드 찌꺼기(=학생이 만든 결과물이 아님) 판별. rel 은 '/' 로 정규화된 상대경로.
    // 실행 프로세스에 PYTHONDONTWRITEBYTECODE 를 걸어 애초에 안 생기게 했지만,
    // 그 설정 전에 만들어져 작업폴더로 이어진 것까지 걸러내는 안전망이다(셀 노트북 커널도 __pycache__ 를 제외한다).
    static bool IsBytecodeArtifact(string rel)
    {
        if (string.IsNullOrEmpty(rel)) return false;
        if (rel.EndsWith(".pyc", StringComparison.OrdinalIgnoreCase)) return true;
        if (rel.EndsWith(".pyo", StringComparison.OrdinalIgnoreCase)) return true;
        if (rel.StartsWith("__pycache__/", StringComparison.OrdinalIgnoreCase)) return true;
        return rel.IndexOf("/__pycache__/", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    // 작업폴더에서 새로 생기거나 내용이 바뀐 파일을 [{name,size}] JSON 으로
    static string ScanOutputs(PythonSession session)
    {
        try
        {
            string root = session.TempRoot;
            if (!Directory.Exists(root)) return "[]";
            string[] files = Directory.GetFiles(root, "*", SearchOption.AllDirectories);
            Array.Sort(files, StringComparer.OrdinalIgnoreCase);
            List<string> items = new List<string>();
            foreach (string f in files)
            {
                string rel = f.Substring(root.Length).TrimStart('\\', '/').Replace('\\', '/');
                if (IsBytecodeArtifact(rel)) continue;   // 파이썬이 자동으로 만든 __pycache__/*.pyc 는 출력이 아니다
                FileInfo fi;
                try { fi = new FileInfo(f); } catch { continue; }
                long size = fi.Length, mtime = fi.LastWriteTimeUtc.Ticks, initSize, initMtime;
                bool known = session.InitSize.TryGetValue(rel, out initSize);
                session.InitMtime.TryGetValue(rel, out initMtime);
                if (known && size == initSize && mtime == initMtime) continue;   // 변경 없음 = 입력 파일
                items.Add("{\"name\":" + JsonString(rel) + ",\"size\":" + size + "}");
                if (items.Count >= 200) break;
            }
            return "[" + string.Join(",", items.ToArray()) + "]";
        }
        catch { return "[]"; }
    }

    static void CleanupRunnerAndPlots(PythonSession session)
    {
        try { if (File.Exists(session.RunnerPath)) File.Delete(session.RunnerPath); } catch { }
        try { if (Directory.Exists(session.PlotDir)) Directory.Delete(session.PlotDir, true); } catch { }
    }

    // 보존된(완료) 세션을 정리: 30분 경과분 + 최근 6개 초과분의 작업폴더 삭제·맵에서 제거
    static void SweepRetainedSessions()
    {
        List<PythonSession> toDelete = new List<PythonSession>();
        lock (PySessionsLock)
        {
            List<PythonSession> done = new List<PythonSession>();
            foreach (KeyValuePair<string, PythonSession> kv in PySessions) if (kv.Value.Complete) done.Add(kv.Value);
            DateTime now = DateTime.UtcNow;
            foreach (PythonSession s in done) if ((now - s.DoneAt).TotalMinutes > 30) toDelete.Add(s);
            done.Sort(delegate(PythonSession a, PythonSession b) { return a.DoneAt.CompareTo(b.DoneAt); });
            for (int i = 0; i < done.Count - 6; i++) if (!toDelete.Contains(done[i])) toDelete.Add(done[i]);
            foreach (PythonSession s in toDelete) PySessions.Remove(s.Id);
        }
        foreach (PythonSession s in toDelete) CleanupPythonSessionFiles(s);
    }

    // 보존 세션의 출력 파일 1개를 읽어온다(경로는 작업폴더 안으로 제한 — zip-slip 방지)
    static bool TryGetSessionFile(string id, string name, out byte[] data, out string fileName)
    {
        data = null; fileName = null;
        PythonSession session;
        lock (PySessionsLock) if (!PySessions.TryGetValue(id ?? "", out session)) return false;
        string safe = SafeRelPath(name);
        if (safe == null) return false;
        string full = Path.Combine(session.TempRoot, safe);
        if (!File.Exists(full)) return false;
        try { data = File.ReadAllBytes(full); } catch { return false; }
        fileName = Path.GetFileName(full);
        return true;
    }

    static string ReadPlotImagesJson(string plotDir)
    {
        try
        {
            string[] files = Directory.GetFiles(plotDir, "*.png");
            Array.Sort(files, StringComparer.OrdinalIgnoreCase);
            StringBuilder images = new StringBuilder("[");
            int count = Math.Min(files.Length, 8);
            for (int i = 0; i < count; i++)
            {
                byte[] bytes = File.ReadAllBytes(files[i]);
                if (bytes.Length > 8 * 1024 * 1024) continue;
                if (images.Length > 1) images.Append(',');
                images.Append(JsonString("data:image/png;base64," + Convert.ToBase64String(bytes)));
            }
            return images.Append(']').ToString();
        }
        catch { return "[]"; }
    }

    static string ReadPythonVariablesJson(string plotDir)
    {
        try
        {
            string path = Path.Combine(plotDir, "variables.json");
            if (!File.Exists(path)) return "[]";
            FileInfo info = new FileInfo(path);
            if (info.Length <= 0 || info.Length > 256 * 1024) return "[]";
            string json = File.ReadAllText(path, Encoding.UTF8).Trim();
            return json.StartsWith("[", StringComparison.Ordinal) && json.EndsWith("]", StringComparison.Ordinal) ? json : "[]";
        }
        catch { return "[]"; }
    }

    static void CleanupPythonSessionFiles(PythonSession session)
    {
        try { if (File.Exists(session.RunnerPath)) File.Delete(session.RunnerPath); } catch { }
        try { if (Directory.Exists(session.PlotDir)) Directory.Delete(session.PlotDir, true); } catch { }
        try { if (Directory.Exists(session.TempRoot)) Directory.Delete(session.TempRoot, true); } catch { }
    }

    /* ===== %TEMP% 임시 작업폴더 청소 =====
       파이썬 세션·노트북 커널·터미널은 각자 종료 경로에서 임시물을 지우지만, 브라우저 탭을 닫으면
       하트비트 감시가 곧바로 프로세스를 끝내고(강제 종료·크래시도 마찬가지) 그때 살아 있던 임시물이 고아로 남는다.
       고아 폴더는 접근 통로인 세션 ID 가 메모리에만 있어 재실행 후에는 어떤 기능으로도 쓸 수 없으므로 지워도 잃을 게 없다.
       (설정·자동복원 데이터는 %LOCALAPPDATA%\ClassDock 와 브라우저 IndexedDB 에 있어 이 청소와 무관하다.)

       두 겹으로 막는다.
        1) 종료 직전 CleanupOwnTempEntries — 이번 실행이 만든 것을 그 자리에서 정리.
        2) 다음 기동 때 SweepOrphanTempEntries — 1)까지 못 간 강제 종료·크래시분을 뒤늦게 정리. */
    const int OrphanTempMinAgeHours = 24;
    static readonly string[] OrphanTempPrefixes = new string[] { "moidapy_", "moida_", "classdock_terminal_" };
    // 프로세스 안에서 필요할 때 재사용하는 작은 Python 도우미. 시작 청소와 첫 요청이 겹쳐
    // 실행 직전에 삭제되지 않도록 항상 보존한다(파일명은 고정이라 누적되지 않는다).
    static readonly string[] PersistentTempHelperNames = new string[] {
        "moida_sqlite_preview.py",
        "moida_sqlite_exec.py",
        "moida_python_import_index.py",
        "moida_jedi_complete.py"
    };

    // 지금 이 프로세스가 쓰는 경로는 나이와 무관하게 제외하고, 그 밖에는 24시간 지난 것만 지운다.
    // 별도 실행 인스턴스는 OS 뮤텍스로 막고, 시간 조건은 직전 실행이 막 끝낸 최근 임시물을 지켜 준다.
    static void SweepOrphanTempEntries()
    {
        string temp;
        try { temp = Path.GetTempPath(); } catch { return; }

        Dictionary<string, bool> inUse = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        foreach (string path in CurrentTempPaths()) if (path.Length > 0) inUse[path] = true;

        DateTime cutoff = DateTime.UtcNow.AddHours(-OrphanTempMinAgeHours);
        string[] dirs;
        string[] files;
        try { dirs = Directory.GetDirectories(temp); } catch { dirs = new string[0]; }
        try { files = Directory.GetFiles(temp); } catch { files = new string[0]; }

        foreach (string dir in dirs)
        {
            if (!IsOrphanTempCandidate(dir, inUse)) continue;
            try
            {
                DirectoryInfo info = new DirectoryInfo(dir);
                if (info.CreationTimeUtc > cutoff || info.LastWriteTimeUtc > cutoff) continue;
                Directory.Delete(dir, true);
            }
            catch { }   // 다른 프로세스가 쓰는 중이면 잠겨서 실패 — 다음 기동에서 다시 시도한다
        }
        foreach (string file in files)
        {
            if (!IsOrphanTempCandidate(file, inUse)) continue;
            try
            {
                FileInfo info = new FileInfo(file);
                if (info.CreationTimeUtc > cutoff || info.LastWriteTimeUtc > cutoff) continue;
                File.Delete(file);
            }
            catch { }
        }
    }

    static bool IsOrphanTempCandidate(string path, Dictionary<string, bool> inUse)
    {
        string name = Path.GetFileName(path);
        bool ours = false;
        foreach (string prefix in OrphanTempPrefixes)
            if (name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) { ours = true; break; }
        if (!ours) return false;
        return !inUse.ContainsKey(NormalizeTempPath(path));
    }

    static string NormalizeTempPath(string path)
    {
        if (string.IsNullOrEmpty(path)) return "";
        try { return Path.GetFullPath(path).TrimEnd('\\', '/'); } catch { return path; }
    }

    // 이 프로세스가 붙들고 있는 임시 경로(살아 있거나 보존 중인 세션·커널·터미널)
    static List<string> CurrentTempPaths()
    {
        List<string> paths = new List<string>();
        lock (PySessionsLock)
            foreach (PythonSession session in PySessions.Values)
            {
                paths.Add(NormalizeTempPath(session.TempRoot));
                paths.Add(NormalizeTempPath(session.RunnerPath));
                paths.Add(NormalizeTempPath(session.PlotDir));
            }
        lock (PyKernelsLock)
            foreach (PythonKernel kernel in PyKernels.Values)
            {
                paths.Add(NormalizeTempPath(kernel.TempRoot));
                paths.Add(NormalizeTempPath(kernel.RunnerPath));
            }
        lock (TerminalSessionsLock)
            foreach (TerminalSession session in TerminalSessions.Values)
                paths.Add(NormalizeTempPath(session.ScriptPath));
        try
        {
            string temp = Path.GetTempPath();
            foreach (string name in PersistentTempHelperNames)
                paths.Add(NormalizeTempPath(Path.Combine(temp, name)));
        }
        catch { }
        return paths;
    }

    // 종료 직전 정리. 아직 돌고 있는 것만 프로세스를 먼저 정리하고(끝난 것에 taskkill 을 걸어
    // 종료를 몇 초씩 늦추지 않는다), 임시 파일은 모두 지운다.
    static void CleanupOwnTempEntries()
    {
        try
        {
            List<PythonSession> sessions = new List<PythonSession>();
            lock (PySessionsLock)
            {
                foreach (PythonSession session in PySessions.Values) sessions.Add(session);
                PySessions.Clear();
            }
            foreach (PythonSession session in sessions)
            {
                if (!session.Complete) KillProcessTree(session.Process);
                CleanupPythonSessionFiles(session);
            }

            List<string> kernelIds = new List<string>();
            lock (PyKernelsLock) foreach (string id in PyKernels.Keys) kernelIds.Add(id);
            foreach (string id in kernelIds) StopPythonKernel(id);   // 프로세스 종료 + 작업폴더 삭제

            List<TerminalSession> terminals = new List<TerminalSession>();
            lock (TerminalSessionsLock)
            {
                foreach (TerminalSession session in TerminalSessions.Values) terminals.Add(session);
                TerminalSessions.Clear();
            }
            foreach (TerminalSession session in terminals)
            {
                if (!session.ShellExited) KillProcessTree(session.Process);
                try { if (File.Exists(session.ScriptPath)) File.Delete(session.ScriptPath); } catch { }
            }

            ClassDockSshTerminal.ShutdownAll();

            List<NpmJob> npmJobs = new List<NpmJob>();
            lock (NpmJobsLock)
            {
                foreach (NpmJob job in NpmJobs.Values) npmJobs.Add(job);
                NpmJobs.Clear();
            }
            foreach (NpmJob job in npmJobs)
                if (!job.Complete) KillProcessTree(job.Process);

            ClearPythonProjectMirror();   // 자동완성용 작업공간 미러
        }
        catch { }   // 정리는 최선 노력 — 실패해도 종료는 진행하고 다음 기동의 청소가 마저 치운다
    }

    // ===== 파이썬(.py) 실행 — 설치된 인터프리터를 찾아 임시 파일로 실행 =====
    static string _pythonCmd = null;     // 캐시: "py" / "python" / "python3"
    static bool _pythonProbed = false;
    static readonly object PyProbeLock = new object();

    /* ===== ffmpeg 영상 변환 (브라우저 미지원 코덱 → MP4) =====
       exe 를 크게 만들지 않으려고 ffmpeg 는 동봉하지 않는다 — exe 옆의 ffmpeg.exe,
       ffmpeg\bin\ffmpeg.exe, 또는 PATH 의 ffmpeg 순서로 찾아 있을 때만 변환을 제공한다.
       (PowerPoint 로 PPTX→PDF 변환하는 것과 같은 '있으면 활용' 방식) */
    static string FindFfmpeg()
    {
        lock (FfmpegProbeLock)
        {
            if (_ffmpegCmd != null) return _ffmpegCmd;   // 성공만 캐시 — 나중에 ffmpeg 를 놓아도 재시작 없이 인식
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string[] cands = {
                Path.Combine(baseDir, "ffmpeg.exe"),
                Path.Combine(baseDir, "ffmpeg", "bin", "ffmpeg.exe"),
                "ffmpeg"
            };
            foreach (string c in cands)
            {
                if (c.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && !File.Exists(c)) continue;
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(c, "-version");
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    psi.RedirectStandardOutput = true;
                    psi.RedirectStandardError = true;
                    Process p = Process.Start(psi);
                    if (p == null) continue;
                    p.StandardOutput.ReadToEnd();
                    p.StandardError.ReadToEnd();
                    if (!p.WaitForExit(5000)) { try { p.Kill(); } catch { } continue; }
                    if (p.ExitCode == 0) { _ffmpegCmd = c; break; }
                }
                catch { /* 해당 후보 없음 → 다음 */ }
            }
            return _ffmpegCmd;
        }
    }

    // ffmpeg 원클릭 설치 작업(백그라운드 스레드): 공식 배포 zip(약 90MB) 다운로드 →
    // 압축에서 bin/ffmpeg.exe 하나만 꺼내 exe 옆에 배치 → 임시파일 정리.
    // 사용자는 버튼만 누르면 되고, 진행률은 /ffmpeg-install-status 폴링으로 보여준다.
    static void InstallFfmpegWorker()
    {
        string tmpZip = Path.Combine(Path.GetTempPath(), "moida_ffmpeg_" + Guid.NewGuid().ToString("N") + ".zip");
        try
        {
            // 항상 최신 안정판을 가리키는 고정 주소(gyan.dev 공식 Windows 빌드)
            string url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
            try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { }   // TLS 1.2
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout = 30000;
            req.ReadWriteTimeout = 120000;
            using (WebResponse resp = req.GetResponse())
            using (Stream rs = resp.GetResponseStream())
            using (FileStream fs = new FileStream(tmpZip, FileMode.Create, FileAccess.Write))
            {
                Interlocked.Exchange(ref _ffInstallTotal, resp.ContentLength);
                byte[] buf = new byte[81920];
                int n;
                while ((n = rs.Read(buf, 0, buf.Length)) > 0)
                {
                    fs.Write(buf, 0, n);
                    Interlocked.Add(ref _ffInstallReceived, n);
                }
            }

            _ffInstallState = "extracting";
            string dest = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ffmpeg.exe");
            string partPath = dest + ".part";
            using (FileStream zipStream = File.OpenRead(tmpZip))
            using (ZipArchive archive = new ZipArchive(zipStream, ZipArchiveMode.Read))
            {
                ZipArchiveEntry hit = null;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string name = entry.FullName.Replace('\\', '/');
                    if (name.EndsWith("/bin/ffmpeg.exe", StringComparison.OrdinalIgnoreCase)
                        || name.Equals("ffmpeg.exe", StringComparison.OrdinalIgnoreCase)) { hit = entry; break; }
                }
                if (hit == null) throw new Exception("zip-no-ffmpeg");
                using (Stream es = hit.Open())
                using (FileStream os = new FileStream(partPath, FileMode.Create, FileAccess.Write))
                {
                    byte[] buf = new byte[81920];
                    int n;
                    while ((n = es.Read(buf, 0, buf.Length)) > 0) os.Write(buf, 0, n);
                }
            }
            try { if (File.Exists(dest)) File.Delete(dest); } catch { }
            File.Move(partPath, dest);

            if (FindFfmpeg() == null) throw new Exception("installed-but-not-detected");
            _ffInstallState = "done";
        }
        catch (Exception ex)
        {
            _ffInstallError = FlattenMessage(ex);
            _ffInstallState = "error";
        }
        finally
        {
            try { if (File.Exists(tmpZip)) File.Delete(tmpZip); } catch { }
        }
    }

    static bool RunFfmpeg(string cmd, string args, int timeoutMs)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(cmd, args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            Process p = Process.Start(psi);
            if (p == null) return false;
            // -loglevel error 라 출력이 거의 없다(파이프 교착 없음 — RunPyOutput 과 같은 방식)
            p.StandardOutput.ReadToEnd();
            p.StandardError.ReadToEnd();
            if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch { } return false; }
            return p.ExitCode == 0;
        }
        catch { return false; }
    }

    static byte[] ConvertMediaToMp4(byte[] media)
    {
        string ffmpeg = FindFfmpeg();
        if (ffmpeg == null) throw new FfmpegMissingException();
        string tmpDir = Path.Combine(Path.GetTempPath(), "moida_av_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmpDir);
        string inPath = Path.Combine(tmpDir, "in.bin");
        string outPath = Path.Combine(tmpDir, "out.mp4");
        try
        {
            File.WriteAllBytes(inPath, media);
            // 1차: 영상 스트림은 복사하고 소리만 AAC 로 재인코딩 — MKV 의 AC-3/DTS 소리 문제를 몇 분 안에 해결
            string fast = "-y -hide_banner -loglevel error -i \"" + inPath + "\""
                + " -map 0:v:0? -map 0:a:0? -c:v copy -c:a aac -b:a 192k -movflags +faststart \"" + outPath + "\"";
            bool ok = RunFfmpeg(ffmpeg, fast, 600000) && File.Exists(outPath) && new FileInfo(outPath).Length > 0;
            if (!ok)
            {
                // 2차: 영상 코덱 자체가 MP4 와 안 맞으면(H.264 아님 등) 전체 재인코딩(느리지만 확실)
                try { if (File.Exists(outPath)) File.Delete(outPath); } catch { }
                string full = "-y -hide_banner -loglevel error -i \"" + inPath + "\""
                    + " -map 0:v:0? -map 0:a:0? -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p"
                    + " -c:a aac -b:a 192k -movflags +faststart \"" + outPath + "\"";
                ok = RunFfmpeg(ffmpeg, full, 1800000) && File.Exists(outPath) && new FileInfo(outPath).Length > 0;
            }
            if (!ok) throw new Exception("ffmpeg-failed");
            return File.ReadAllBytes(outPath);
        }
        finally
        {
            try { if (Directory.Exists(tmpDir)) Directory.Delete(tmpDir, true); } catch { }
        }
    }

    static string FindPython()
    {
        lock (PyProbeLock)
        {
            if (_pythonProbed) return _pythonCmd;
            _pythonProbed = true;
            _pythonCmd = ProbePython();
            return _pythonCmd;
        }
    }

    // 파이썬을 새로 설치한 뒤 exe 재시작 없이 다시 찾도록 캐시를 비운다(Py Env 의 '다시 검사').
    static void ResetPythonProbe()
    {
        lock (PyProbeLock) { _pythonProbed = false; _pythonCmd = null; }
        lock (JediLock) { _jediReady = null; }
    }

    /* 설치할 때 'Add python.exe to PATH' 를 체크하지 않으면 PATH 로는 찾을 수 없다.
       그래서 PATH → 레지스트리(PEP 514) → 표준 설치 폴더 순으로 넓혀 가며 찾는다. */
    static string ProbePython()
    {
        // 1) PATH — Windows 런처 'py' 우선(버전 선택 처리), 그다음 python / python3
        string[] cands = { "py", "python", "python3" };
        foreach (string c in cands)
            if (IsUsablePython(c)) return c;
        // 2) PATH 밖 — 설치된 흔적에서 python.exe 를 찾아 최신 버전부터 검사
        foreach (string exe in InstalledPythonCandidates())
            if (IsUsablePython(exe)) return exe;
        return null;
    }

    // --version 이 정상 종료하고 Python 3 이라고 답할 때만 인정한다.
    // 파이썬을 설치하지 않아도 있는 Microsoft Store 안내용 가짜 python.exe 도 여기서 걸러진다.
    static bool IsUsablePython(string cmd)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(cmd, "--version");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            Process p = Process.Start(psi);
            if (p == null) return false;
            // ReadToEnd를 먼저 호출하면 응답하지 않는 PATH 후보에서 스트림 EOF를 영원히 기다려
            // 아래 5초 제한까지 도달하지 못한다. --version 출력은 매우 작으므로 종료를 먼저 기다린다.
            if (!p.WaitForExit(5000))
            {
                try { p.Kill(); } catch { }
                try { p.WaitForExit(1000); } catch { }
                return false;
            }
            string stdout = p.StandardOutput.ReadToEnd();
            string stderr = p.StandardError.ReadToEnd();
            if (p.ExitCode != 0) return false;
            return (stdout + stderr).IndexOf("Python 3", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        catch { return false; }   // 해당 후보 없음 → 다음
    }

    // 레지스트리와 표준 설치 폴더에서 python.exe 후보를 모아 최신 버전부터 돌려준다.
    static List<string> InstalledPythonCandidates()
    {
        var found = new List<KeyValuePair<int, string>>();   // (버전 순위, 경로)
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var paths = new List<string>();
        try { paths.AddRange(RegistryPythonPaths()); } catch { }
        try { paths.AddRange(WellKnownPythonPaths()); } catch { }
        foreach (string candidate in paths)
        {
            if (string.IsNullOrEmpty(candidate)) continue;
            string exe;
            try { exe = Path.GetFullPath(candidate); } catch { continue; }
            if (!File.Exists(exe) || !seen.Add(exe)) continue;
            found.Add(new KeyValuePair<int, string>(PythonVersionRank(exe), exe));
        }
        found.Sort(delegate(KeyValuePair<int, string> a, KeyValuePair<int, string> b) { return b.Key.CompareTo(a.Key); });
        var list = new List<string>();
        foreach (KeyValuePair<int, string> item in found) list.Add(item.Value);
        return list;
    }

    // 폴더 이름의 'Python313' / 'Python3.13' 에서 숫자를 뽑아 최신 우선 정렬에 쓴다(모르면 0 → 마지막).
    static int PythonVersionRank(string exePath)
    {
        try
        {
            string parent = Path.GetDirectoryName(exePath);
            string dir = parent == null ? "" : Path.GetFileName(parent);
            var digits = new StringBuilder();
            foreach (char ch in dir) if (ch >= '0' && ch <= '9') digits.Append(ch);
            if (digits.Length < 2) return 0;                       // anaconda3 처럼 버전이 없는 경우
            string text = digits.ToString();
            int major = text[0] - '0';
            int minor;
            if (!int.TryParse(text.Substring(1), out minor)) minor = 0;
            return major * 1000 + Math.Min(minor, 999);            // 3.13 → 3013
        }
        catch { return 0; }
    }

    // PEP 514: HKCU/HKLM 의 SOFTWARE\Python\<회사>\<태그>\InstallPath 에 설치 위치가 등록된다.
    static List<string> RegistryPythonPaths()
    {
        var list = new List<string>();
        var views = new KeyValuePair<RegistryHive, RegistryView>[] {
            new KeyValuePair<RegistryHive, RegistryView>(RegistryHive.CurrentUser, RegistryView.Registry64),
            new KeyValuePair<RegistryHive, RegistryView>(RegistryHive.LocalMachine, RegistryView.Registry64),
            new KeyValuePair<RegistryHive, RegistryView>(RegistryHive.LocalMachine, RegistryView.Registry32)
        };
        foreach (KeyValuePair<RegistryHive, RegistryView> view in views)
        {
            RegistryKey baseKey = null;
            try
            {
                baseKey = RegistryKey.OpenBaseKey(view.Key, view.Value);
                if (baseKey == null) continue;
                using (RegistryKey root = baseKey.OpenSubKey("SOFTWARE\\Python"))
                {
                    if (root == null) continue;
                    foreach (string company in root.GetSubKeyNames())
                    {
                        using (RegistryKey companyKey = root.OpenSubKey(company))
                        {
                            if (companyKey == null) continue;
                            foreach (string tag in companyKey.GetSubKeyNames())
                            {
                                using (RegistryKey install = companyKey.OpenSubKey(tag + "\\InstallPath"))
                                {
                                    if (install == null) continue;
                                    string exe = install.GetValue("ExecutablePath") as string;
                                    if (string.IsNullOrEmpty(exe))
                                    {
                                        string dir = install.GetValue(null) as string;   // 기본값 = 설치 폴더
                                        if (!string.IsNullOrEmpty(dir)) exe = Path.Combine(dir, "python.exe");
                                    }
                                    if (!string.IsNullOrEmpty(exe)) list.Add(exe);
                                }
                            }
                        }
                    }
                }
            }
            catch { /* 권한 없음·키 없음 → 다음 뷰 */ }
            finally { if (baseKey != null) { try { baseKey.Close(); } catch { } } }
        }
        return list;
    }

    // 레지스트리에 없더라도 대부분 아래 기본 위치에 설치된다.
    static List<string> WellKnownPythonPaths()
    {
        var list = new List<string>();
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        string systemDir = Environment.GetFolderPath(Environment.SpecialFolder.System);
        var roots = new List<string>();
        if (!string.IsNullOrEmpty(local)) roots.Add(Path.Combine(local, "Programs\\Python"));   // 기본 '나만 사용' 설치
        roots.Add(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles));
        roots.Add(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86));
        try { if (!string.IsNullOrEmpty(systemDir)) roots.Add(Path.GetPathRoot(systemDir)); } catch { }   // C:\Python313
        foreach (string root in roots)
        {
            if (string.IsNullOrEmpty(root)) continue;
            try
            {
                if (!Directory.Exists(root)) continue;
                foreach (string dir in Directory.GetDirectories(root, "Python3*"))
                    list.Add(Path.Combine(dir, "python.exe"));
            }
            catch { /* 접근 불가 폴더 → 건너뜀 */ }
        }
        string[] condaNames = { "anaconda3", "miniconda3", "miniforge3" };
        foreach (string name in condaNames)
        {
            if (!string.IsNullOrEmpty(profile)) list.Add(Path.Combine(profile, name + "\\python.exe"));
            if (!string.IsNullOrEmpty(programData)) list.Add(Path.Combine(programData, name + "\\python.exe"));
        }
        return list;
    }

    // pip 패키지 이름 검증(명령 주입 방지): 이름 + 선택적 버전 지정자만 허용
    static string RunPyOutput(string interp, string args, int timeoutMs)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(interp, args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = new UTF8Encoding(false);
            psi.StandardErrorEncoding = new UTF8Encoding(false);
            Process p = Process.Start(psi);
            if (p == null) return "";
            string stdout = p.StandardOutput.ReadToEnd();
            string stderr = p.StandardError.ReadToEnd();
            if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch { } return ""; }
            return (stdout + (stdout.Length > 0 && stderr.Length > 0 ? "\n" : "") + stderr).Trim();
        }
        catch { return ""; }
    }

    // 이 앱(호스트)과 그 자식 프로세스(파이썬 커널·chromedriver 등) 물리 메모리(WorkingSet) 합계를 JSON 으로.
    static string MemoryStatsJson()
    {
        try
        {
            int selfId = Process.GetCurrentProcess().Id;
            var parent = new Dictionary<int, int>();
            var pname = new Dictionary<int, string>();
            IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snap != IntPtr.Zero && snap.ToInt64() != -1)
            {
                try
                {
                    PROCESSENTRY32 pe = new PROCESSENTRY32();
                    pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                    if (Process32First(snap, ref pe))
                    {
                        do
                        {
                            int pid = (int)pe.th32ProcessID;
                            parent[pid] = (int)pe.th32ParentProcessID;
                            string nm = pe.szExeFile ?? "";
                            if (nm.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) nm = nm.Substring(0, nm.Length - 4);
                            pname[pid] = nm;
                        } while (Process32Next(snap, ref pe));
                    }
                }
                finally { CloseHandle(snap); }
            }
            // 자기 자신 + 모든 후손 PID 수집
            var tree = new HashSet<int>();
            tree.Add(selfId);
            bool changed = true;
            while (changed)
            {
                changed = false;
                foreach (var kv in parent)
                    if (tree.Contains(kv.Value) && !tree.Contains(kv.Key)) { tree.Add(kv.Key); changed = true; }
            }
            var rows = new List<KeyValuePair<string, long>>();
            long total = 0;
            foreach (int pid in tree)
            {
                long ws;
                string nm = pname.ContainsKey(pid) ? pname[pid] : "?";
                try { using (var p = Process.GetProcessById(pid)) { ws = p.WorkingSet64; } }
                catch { continue; }   // 이미 종료된 프로세스는 건너뜀
                total += ws;
                rows.Add(new KeyValuePair<string, long>(nm, ws));
            }
            rows.Sort(delegate(KeyValuePair<string, long> a, KeyValuePair<string, long> b) { return b.Value.CompareTo(a.Value); });
            var sb = new StringBuilder();
            sb.Append("{\"ok\":true,\"totalMB\":").Append(total / (1024 * 1024)).Append(",\"processes\":[");
            for (int i = 0; i < rows.Count && i < 12; i++)
            {
                if (i > 0) sb.Append(",");
                sb.Append("{\"name\":").Append(JsonString(rows[i].Key)).Append(",\"mb\":").Append(rows[i].Value / (1024 * 1024)).Append("}");
            }
            sb.Append("]}");
            return sb.ToString();
        }
        catch (Exception ex) { return "{\"ok\":false,\"reason\":" + JsonString(FlattenMessage(ex)) + "}"; }
    }

    static string PythonDiagnostics()
    {
        string interp = FindPython();
        if (interp == null)
        {
            return "{\"ok\":false,\"command\":\"\",\"version\":\"\",\"pip\":false,\"jedi\":false,\"saveRoot\":" + JsonString(CurrentSaveRoot()) + "}";
        }
        string prefix = interp == "py" ? "-3 " : "";
        string version = RunPyOutput(interp, prefix + "--version", 5000);
        bool pip = RunPyCheck(interp, "import pip");
        bool jedi = RunPyCheck(interp, "import jedi");
        return "{\"ok\":true"
             + ",\"command\":" + JsonString(interp)
             + ",\"version\":" + JsonString(version)
             + ",\"pip\":" + (pip ? "true" : "false")
             + ",\"jedi\":" + (jedi ? "true" : "false")
             + ",\"saveRoot\":" + JsonString(CurrentSaveRoot())
             + "}";
    }

    static readonly object SqlitePreviewLock = new object();
    static string _sqlitePreviewRunnerPath = null;

    static string SqlitePreviewRunner()
    {
        lock (SqlitePreviewLock)
        {
            if (_sqlitePreviewRunnerPath != null && File.Exists(_sqlitePreviewRunnerPath)) return _sqlitePreviewRunnerPath;
            string path = Path.Combine(Path.GetTempPath(), "moida_sqlite_preview.py");
            File.WriteAllText(path,
                "import sys, json, sqlite3\n" +
                "db = sys.argv[1]\n" +
                "def qid(value): return '\"' + str(value).replace('\"', '\"\"') + '\"'\n" +
                "def cell(value):\n" +
                "    if value is None: return None\n" +
                "    if isinstance(value, (bytes, bytearray, memoryview)): return '<BLOB %d bytes>' % len(value)\n" +
                "    text = str(value)\n" +
                "    return text if len(text) <= 500 else text[:500] + '…'\n" +
                "result = {'ok': True, 'limit': 200, 'tables': []}\n" +
                "try:\n" +
                "    uri = 'file:' + db.replace('\\\\', '/') + '?mode=ro'\n" +
                "    con = sqlite3.connect(uri, uri=True)\n" +
                "    con.execute('PRAGMA query_only=ON')\n" +
                "    masters = con.execute(\"SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name\").fetchall()\n" +
                "    result['totalTables'] = len(masters)\n" +
                "    remaining_cells = 12000\n" +
                "    for name, kind, sql in masters[:60]:\n" +
                "        item = {'name': name, 'type': kind, 'sql': (sql or '')[:4000], 'columns': [], 'rows': [], 'rowCount': None}\n" +
                "        try:\n" +
                "            info = con.execute('PRAGMA table_info(' + qid(name) + ')').fetchall()\n" +
                "            item['columns'] = [{'name': r[1], 'type': r[2] or '', 'notnull': bool(r[3]), 'default': r[4], 'pk': int(r[5] or 0)} for r in info[:80]]\n" +
                "            item['rowCount'] = int(con.execute('SELECT COUNT(*) FROM ' + qid(name)).fetchone()[0])\n" +
                "            width = max(1, min(len(info), 80))\n" +
                "            row_limit = min(200, remaining_cells // width)\n" +
                "            cur = con.execute('SELECT * FROM ' + qid(name) + ' LIMIT ' + str(row_limit))\n" +
                "            item['displayColumns'] = [d[0] for d in (cur.description or [])[:80]]\n" +
                "            item['rows'] = [[cell(v) for v in row[:80]] for row in cur.fetchall()]\n" +
                "            remaining_cells = max(0, remaining_cells - len(item['rows']) * max(1, len(item['displayColumns'])))\n" +
                "        except Exception as exc:\n" +
                "            item['error'] = str(exc)\n" +
                "        result['tables'].append(item)\n" +
                "    con.close()\n" +
                "except Exception as exc:\n" +
                "    result = {'ok': False, 'error': str(exc), 'tables': []}\n" +
                "print(json.dumps(result, ensure_ascii=False))\n",
                new UTF8Encoding(false));
            _sqlitePreviewRunnerPath = path;
            return path;
        }
    }

    static string SqlitePreview(byte[] body)
    {
        byte[] signature = Encoding.ASCII.GetBytes("SQLite format 3\0");
        if (body == null || body.Length < signature.Length) throw new InvalidDataException("not-sqlite3");
        for (int i = 0; i < signature.Length; i++) if (body[i] != signature[i]) throw new InvalidDataException("not-sqlite3");

        string interp = FindPython();
        if (interp == null) throw new PythonMissingException();
        string tempDir = Path.Combine(Path.GetTempPath(), "moida_sqlite_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        string dbPath = Path.Combine(tempDir, "preview.sqlite3");
        File.WriteAllBytes(dbPath, body);
        try
        {
            string runner = SqlitePreviewRunner();
            string args = (interp == "py" ? "-3 " : "") + "\"" + runner + "\" \"" + dbPath + "\"";
            return RunSqliteRunner(interp, args, null);
        }
        finally
        {
            try { Directory.Delete(tempDir, true); } catch { }
        }
    }

    static string _sqliteExecRunnerPath = null;
    static readonly object SqliteExecLock = new object();

    class SqliteProcessCapture
    {
        public readonly StringBuilder Text = new StringBuilder();
        public bool TooLarge;
        public Exception Error;
    }

    static string SqliteExecRunner()
    {
        lock (SqlitePreviewLock)
        {
            if (_sqliteExecRunnerPath != null && File.Exists(_sqliteExecRunnerPath)) return _sqliteExecRunnerPath;
            string path = Path.Combine(Path.GetTempPath(), "moida_sqlite_exec.py");
            File.WriteAllText(path,
                "import sys, json, sqlite3, hashlib, os\n" +
                "db = sys.argv[1]\n" +
                "mode = sys.argv[2] if len(sys.argv) > 2 else 'exec'\n" +
                "backup = sys.argv[3] if len(sys.argv) > 3 else ''\n" +
                "sql = sys.stdin.read() if mode == 'exec' else ''\n" +
                "def qid(value): return '\"' + str(value).replace('\"', '\"\"') + '\"'\n" +
                "def fingerprint(path, include_wal=True):\n" +
                "    digest = hashlib.sha256()\n" +
                "    paths = [(path, b'')]\n" +
                "    if include_wal and os.path.exists(path + '-wal'): paths.append((path + '-wal', b'\\0wal\\0'))\n" +
                "    for current, marker in paths:\n" +
                "        if marker: digest.update(marker)\n" +
                "        with open(current, 'rb') as source:\n" +
                "            while True:\n" +
                "                chunk = source.read(1024 * 1024)\n" +
                "                if not chunk: break\n" +
                "                digest.update(chunk)\n" +
                "    return digest.hexdigest()\n" +
                "def cell(value):\n" +
                "    if value is None: return None\n" +
                "    if isinstance(value, (bytes, bytearray, memoryview)): return '<BLOB %d bytes>' % len(value)\n" +
                "    text = str(value)\n" +
                "    return text if len(text) <= 500 else text[:500] + '…'\n" +
                "def snapshot(con):\n" +
                "    masters = con.execute(\"SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name\").fetchall()\n" +
                "    tables, remaining_cells = [], 12000\n" +
                "    for name, kind, tsql in masters[:60]:\n" +
                "        item = {'name': name, 'type': kind, 'sql': (tsql or '')[:4000], 'columns': [], 'rows': [], 'rowCount': None}\n" +
                "        try:\n" +
                "            info = con.execute('PRAGMA table_info(' + qid(name) + ')').fetchall()\n" +
                "            item['columns'] = [{'name': r[1], 'type': r[2] or '', 'notnull': bool(r[3]), 'default': r[4], 'pk': int(r[5] or 0)} for r in info[:80]]\n" +
                "            item['rowCount'] = int(con.execute('SELECT COUNT(*) FROM ' + qid(name)).fetchone()[0])\n" +
                "            width = max(1, min(len(info), 80))\n" +
                "            row_limit = min(200, remaining_cells // width)\n" +
                "            cur = con.execute('SELECT * FROM ' + qid(name) + ' LIMIT ' + str(row_limit))\n" +
                "            item['displayColumns'] = [d[0] for d in (cur.description or [])[:80]]\n" +
                "            item['rows'] = [[cell(v) for v in row[:80]] for row in cur.fetchall()]\n" +
                "            remaining_cells = max(0, remaining_cells - len(item['rows']) * max(1, len(item['displayColumns'])))\n" +
                "        except Exception as exc:\n" +
                "            item['error'] = str(exc)\n" +
                "        tables.append(item)\n" +
                "    return tables, len(masters)\n" +
                "def statements(script):\n" +
                "    parts, buf = [], ''\n" +
                "    for ch in script:\n" +
                "        buf += ch\n" +
                "        if ch == ';' and sqlite3.complete_statement(buf):\n" +
                "            if buf.strip(): parts.append(buf)\n" +
                "            buf = ''\n" +
                "    if buf.strip(): parts.append(buf)\n" +
                "    return parts\n" +
                "def first_keyword(statement):\n" +
                "    text = statement.lstrip()\n" +
                "    while True:\n" +
                "        if text.startswith('--'):\n" +
                "            pos = text.find('\\n')\n" +
                "            text = '' if pos < 0 else text[pos + 1:].lstrip()\n" +
                "            continue\n" +
                "        if text.startswith('/*'):\n" +
                "            pos = text.find('*/', 2)\n" +
                "            text = '' if pos < 0 else text[pos + 2:].lstrip()\n" +
                "            continue\n" +
                "        break\n" +
                "    return ''.join(ch for ch in text.split(None, 1)[0] if ch.isalpha()).upper() if text else ''\n" +
                "result, con, committed = {'ok': True}, None, False\n" +
                "try:\n" +
                "    con = sqlite3.connect(db)\n" +
                "    con.execute('PRAGMA busy_timeout=4000')\n" +
                "    if mode == 'preview':\n" +
                "        con.execute('PRAGMA query_only=ON')\n" +
                "        result = {'ok': True, 'limit': 200, 'tables': []}\n" +
                "        result['tables'], result['totalTables'] = snapshot(con)\n" +
                "    else:\n" +
                "        parts = statements(sql)\n" +
                "        if not parts: raise ValueError('empty-sql')\n" +
                "        if not backup: raise ValueError('missing-backup-path')\n" +
                "        backup_con = sqlite3.connect(backup)\n" +
                "        try: con.backup(backup_con)\n" +
                "        finally: backup_con.close()\n" +
                "        changes_before = con.total_changes\n" +
                "        con.execute('BEGIN IMMEDIATE')\n" +
                "        denied = (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_TRANSACTION)\n" +
                "        con.set_authorizer(lambda action, p1, p2, dbname, source: sqlite3.SQLITE_DENY if action in denied else sqlite3.SQLITE_OK)\n" +
                "        cur = con.cursor()\n" +
                "        try:\n" +
                "            for statement in parts: cur.execute(statement)\n" +
                "            if len(parts) == 1 and cur.description:\n" +
                "                cols = [d[0] for d in cur.description[:40]]\n" +
                "                data = cur.fetchmany(501)\n" +
                "                exec_info = {'kind': 'select', 'columns': cols, 'rows': [[cell(v) for v in row[:40]] for row in data[:500]], 'truncated': len(data) > 500, 'rowCount': min(len(data), 500)}\n" +
                "            elif len(parts) == 1:\n" +
                "                exec_info = {'kind': 'write', 'rowcount': cur.rowcount, 'lastrowid': cur.lastrowid}\n" +
                "            else:\n" +
                "                exec_info = {'kind': 'script', 'changes': con.total_changes - changes_before}\n" +
                "            con.set_authorizer(lambda action, p1, p2, dbname, source: sqlite3.SQLITE_OK)\n" +
                "            con.commit()\n" +
                "            committed = True\n" +
                "        except Exception:\n" +
                "            con.set_authorizer(lambda action, p1, p2, dbname, source: sqlite3.SQLITE_OK)\n" +
                "            con.rollback()\n" +
                "            try: os.remove(backup)\n" +
                "            except OSError: pass\n" +
                "            raise\n" +
                "        read_only = len(parts) == 1 and first_keyword(parts[0]) in ('SELECT', 'EXPLAIN', 'VALUES')\n" +
                "        if read_only:\n" +
                "            try: os.remove(backup)\n" +
                "            except OSError: pass\n" +
                "        else:\n" +
                "            exec_info['backup'] = os.path.basename(backup)\n" +
                "        result = {'ok': True, 'exec': exec_info}\n" +
                "except Exception as exc:\n" +
                "    if mode == 'exec' and backup and not committed:\n" +
                "        try:\n" +
                "            if con is not None and con.in_transaction: con.rollback()\n" +
                "        except Exception: pass\n" +
                "        try: os.remove(backup)\n" +
                "        except OSError: pass\n" +
                "    result = {'ok': False, 'error': str(exc)}\n" +
                "finally:\n" +
                "    if con is not None:\n" +
                "        try: con.close()\n" +
                "        except Exception: pass\n" +
                "if result.get('ok'):\n" +
                "    try: result['fingerprint'] = fingerprint(db)\n" +
                "    except Exception: result['fingerprint'] = ''\n" +
                "print(json.dumps(result, ensure_ascii=False))\n",
                new UTF8Encoding(false));
            _sqliteExecRunnerPath = path;
            return path;
        }
    }

    // SQL 쓰기는 저장 루트 아래의 명시적 상대경로만 허용한다. 절대경로는 로컬 PC의 임의 DB를
    // 수정할 수 있으므로 읽기용 TryReadLocalFile 과 달리 허용하지 않는다.
    static bool TryResolveDbPath(string path, out string full)
    {
        full = "";
        if (string.IsNullOrWhiteSpace(path) || Path.IsPathRooted(path)) return false;
        try
        {
            if (!TryResolveSaveRootPath(path, out full)) return false;
        }
        catch { return false; }
        if (!File.Exists(full)) return false;
        string ext = Path.GetExtension(full).ToLowerInvariant();
        return ext == ".db" || ext == ".sqlite" || ext == ".sqlite3";
    }

    static void ValidateSqliteHeader(string full)
    {
        byte[] signature = Encoding.ASCII.GetBytes("SQLite format 3\0");
        using (FileStream fs = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            byte[] headBytes = new byte[signature.Length];
            int read = fs.Read(headBytes, 0, headBytes.Length);
            if (read < signature.Length) throw new InvalidDataException("not-sqlite3");
            for (int i = 0; i < signature.Length; i++)
                if (headBytes[i] != signature[i]) throw new InvalidDataException("not-sqlite3");
        }
    }

    static void AppendHashFile(HashAlgorithm hash, string path)
    {
        using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            byte[] buffer = new byte[1024 * 1024];
            int read;
            while ((read = fs.Read(buffer, 0, buffer.Length)) > 0)
                hash.TransformBlock(buffer, 0, read, buffer, 0);
        }
    }

    static string DbFingerprint(string full, bool includeWal)
    {
        using (SHA256 sha = SHA256.Create())
        {
            AppendHashFile(sha, full);
            string wal = full + "-wal";
            if (includeWal && File.Exists(wal))
            {
                byte[] marker = Encoding.ASCII.GetBytes("\0wal\0");
                sha.TransformBlock(marker, 0, marker.Length, marker, 0);
                AppendHashFile(sha, wal);
            }
            sha.TransformFinalBlock(new byte[0], 0, 0);
            StringBuilder text = new StringBuilder(sha.Hash.Length * 2);
            foreach (byte value in sha.Hash) text.Append(value.ToString("x2"));
            return text.ToString();
        }
    }

    static void ValidateDbFingerprint(Dictionary<string, string> headers, string full, bool required, bool includeWal)
    {
        string expected = headers != null && headers.ContainsKey("X-Db-Fingerprint")
            ? headers["X-Db-Fingerprint"].Trim().ToLowerInvariant() : "";
        if (required && expected.Length != 64) throw new DbMismatchException();
        if (expected.Length > 0 && !string.Equals(expected, DbFingerprint(full, includeWal), StringComparison.Ordinal))
            throw new DbMismatchException();
    }

    static string NextDbBackupPath(string full)
    {
        string prefix = full + ".bak-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
        string candidate = prefix;
        int suffix = 1;
        while (File.Exists(candidate)) candidate = prefix + "-" + (suffix++);
        return candidate;
    }

    static void CaptureProcessText(StreamReader reader, int limit, SqliteProcessCapture capture)
    {
        try
        {
            char[] buffer = new char[4096];
            int read;
            while ((read = reader.Read(buffer, 0, buffer.Length)) > 0)
            {
                int remaining = limit - capture.Text.Length;
                if (remaining > 0) capture.Text.Append(buffer, 0, Math.Min(read, remaining));
                if (read > remaining) capture.TooLarge = true;
            }
        }
        catch (Exception ex) { capture.Error = ex; }
    }

    static string RunSqliteRunner(string interp, string args, string stdin)
    {
        ProcessStartInfo psi = new ProcessStartInfo(interp, args);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = new UTF8Encoding(false);
        psi.StandardErrorEncoding = new UTF8Encoding(false);
        psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        using (Process proc = Process.Start(psi))
        {
            if (proc == null) throw new Exception("sqlite-process-spawn-failed");
            SqliteProcessCapture stdout = new SqliteProcessCapture();
            SqliteProcessCapture stderr = new SqliteProcessCapture();
            Thread stdoutThread = new Thread(delegate() { CaptureProcessText(proc.StandardOutput, 12 * 1024 * 1024, stdout); });
            Thread stderrThread = new Thread(delegate() { CaptureProcessText(proc.StandardError, 1024 * 1024, stderr); });
            stdoutThread.IsBackground = true;
            stderrThread.IsBackground = true;
            stdoutThread.Start();
            stderrThread.Start();
            try
            {
                using (StreamWriter input = new StreamWriter(proc.StandardInput.BaseStream, new UTF8Encoding(false)))
                {
                    if (!string.IsNullOrEmpty(stdin)) input.Write(stdin);
                }
                if (!proc.WaitForExit(30000))
                {
                    try { proc.Kill(); } catch { }
                    try { proc.WaitForExit(5000); } catch { }
                    throw new Exception("sqlite-process-timeout");
                }
            }
            finally
            {
                stdoutThread.Join(5000);
                stderrThread.Join(5000);
            }
            if (stdout.Error != null) throw stdout.Error;
            if (stderr.Error != null) throw stderr.Error;
            if (stdout.TooLarge) throw new Exception("sqlite-result-too-large");
            if (proc.ExitCode != 0)
                throw new Exception(string.IsNullOrWhiteSpace(stderr.Text.ToString()) ? "sqlite-process-failed" : stderr.Text.ToString().Trim());
            return stdout.Text.ToString().Trim();
        }
    }

    static string SqliteDiskPreview(Dictionary<string, string> headers)
    {
        string rawPath = headers != null && headers.ContainsKey("X-Db-Path") ? Uri.UnescapeDataString(headers["X-Db-Path"]) : "";
        string full;
        if (!TryResolveDbPath(rawPath, out full)) throw new FileNotFoundException("db-not-found");
        ValidateSqliteHeader(full);
        ValidateDbFingerprint(headers, full, false, false);
        string interp = FindPython();
        if (interp == null) throw new PythonMissingException();
        string runner = SqliteExecRunner();
        string args = (interp == "py" ? "-3 " : "") + "\"" + runner + "\" \"" + full + "\" preview";
        return RunSqliteRunner(interp, args, null);
    }

    static string SqliteExec(Dictionary<string, string> headers, byte[] body)
    {
        string rawPath = headers != null && headers.ContainsKey("X-Db-Path") ? Uri.UnescapeDataString(headers["X-Db-Path"]) : "";
        string full;
        if (!TryResolveDbPath(rawPath, out full)) throw new FileNotFoundException("db-not-found");
        ValidateSqliteHeader(full);
        string sql = Encoding.UTF8.GetString(body ?? new byte[0]);
        if (string.IsNullOrWhiteSpace(sql)) throw new Exception("empty-sql");
        string interp = FindPython();
        if (interp == null) throw new PythonMissingException();
        lock (SqliteExecLock)
        {
            // 화면을 연 뒤 같은 경로가 다른 파일로 교체됐으면 실행하지 않는다.
            ValidateDbFingerprint(headers, full, true, true);
            string backup = NextDbBackupPath(full);
            string runner = SqliteExecRunner();
            string args = (interp == "py" ? "-3 " : "") + "\"" + runner + "\" \"" + full + "\" exec \"" + backup + "\"";
            return RunSqliteRunner(interp, args, sql);
        }
    }

    static readonly System.Text.RegularExpressions.Regex NpmPackageNameRe =
        new System.Text.RegularExpressions.Regex(@"^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$");
    static readonly System.Text.RegularExpressions.Regex NpmVersionRe =
        new System.Text.RegularExpressions.Regex(@"^[A-Za-z0-9][A-Za-z0-9._+~-]*$");
    static readonly System.Text.RegularExpressions.Regex JsGlobalNameRe =
        new System.Text.RegularExpressions.Regex(@"^[A-Za-z_$][A-Za-z0-9_$]*$");

    static bool IsSafeNpmId(string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length != 32) return false;
        for (int i = 0; i < id.Length; i++)
        {
            char c = id[i];
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }

    static string NpmPackageId(string spec, string globalName)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(spec + "\n" + globalName);
        byte[] hash;
        using (SHA256 sha = SHA256.Create()) hash = sha.ComputeHash(bytes);
        StringBuilder result = new StringBuilder(32);
        for (int i = 0; i < 16; i++) result.Append(hash[i].ToString("x2"));
        return result.ToString();
    }

    static string[] ParseNpmInstallRequest(byte[] body)
    {
        string text = Encoding.UTF8.GetString(body ?? new byte[0]).Replace("\r", "");
        string[] lines = text.Split('\n');
        string spec = lines.Length > 0 ? lines[0].Trim() : "";
        string globalName = lines.Length > 1 ? lines[1].Trim() : "";
        if (spec.Length == 0 || spec.Length > 160) throw new InvalidDataException("invalid-package-spec");
        if (!JsGlobalNameRe.IsMatch(globalName) || globalName.Length > 80) throw new InvalidDataException("invalid-global-name");

        string packageName = spec;
        string version = "";
        if (spec.StartsWith("@", StringComparison.Ordinal))
        {
            int slash = spec.IndexOf('/');
            if (slash < 2) throw new InvalidDataException("invalid-package-spec");
            int versionAt = spec.IndexOf('@', slash + 1);
            if (versionAt >= 0)
            {
                packageName = spec.Substring(0, versionAt);
                version = spec.Substring(versionAt + 1);
            }
        }
        else
        {
            int versionAt = spec.IndexOf('@');
            if (versionAt >= 0)
            {
                packageName = spec.Substring(0, versionAt);
                version = spec.Substring(versionAt + 1);
            }
        }
        if (!NpmPackageNameRe.IsMatch(packageName) || packageName.Length > 120)
            throw new InvalidDataException("invalid-package-spec");
        if (version.Length > 0 && (!NpmVersionRe.IsMatch(version) || version.Length > 80))
            throw new InvalidDataException("invalid-package-version");
        if (spec.EndsWith("@", StringComparison.Ordinal)) throw new InvalidDataException("invalid-package-version");
        return new string[] { spec, packageName, globalName };
    }

    static string FindPathExecutable(string fileName)
    {
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string raw in path.Split(';'))
        {
            string dir = raw.Trim().Trim('"');
            if (dir.Length == 0) continue;
            try
            {
                string candidate = Path.Combine(dir, fileName);
                if (File.Exists(candidate)) return Path.GetFullPath(candidate);
            }
            catch { }
        }
        return null;
    }

    static string FindNodeExecutable()
    {
        string found = FindPathExecutable("node.exe");
        if (!string.IsNullOrEmpty(found)) return found;
        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string candidate = Path.Combine(programFiles, "nodejs", "node.exe");
        return File.Exists(candidate) ? candidate : null;
    }

    static string FindNpmCli(string nodePath)
    {
        List<string> roots = new List<string>();
        if (!string.IsNullOrEmpty(nodePath)) roots.Add(Path.GetDirectoryName(nodePath));
        string npmCmd = FindPathExecutable("npm.cmd");
        if (!string.IsNullOrEmpty(npmCmd)) roots.Add(Path.GetDirectoryName(npmCmd));
        string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (!string.IsNullOrEmpty(appData)) roots.Add(Path.Combine(appData, "npm"));
        foreach (string root in roots)
        {
            if (string.IsNullOrEmpty(root)) continue;
            string candidate = Path.Combine(root, "node_modules", "npm", "bin", "npm-cli.js");
            if (File.Exists(candidate)) return Path.GetFullPath(candidate);
        }
        return null;
    }

    static string QuoteProcessArgument(string value)
    {
        value = value ?? "";
        if (value.Length > 0 && value.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0) return value;
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"')
            {
                result.Append('\\', slashes * 2 + 1).Append('"');
                slashes = 0;
                continue;
            }
            result.Append('\\', slashes).Append(c);
            slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }

    static string RunVersionProbe(string executable, string arguments)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(executable, arguments);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            using (Process process = Process.Start(psi))
            {
                if (process == null || !process.WaitForExit(5000))
                {
                    try { if (process != null) process.Kill(); } catch { }
                    return "";
                }
                string output = process.StandardOutput.ReadToEnd().Trim();
                if (output.Length == 0) output = process.StandardError.ReadToEnd().Trim();
                return process.ExitCode == 0 ? output : "";
            }
        }
        catch { return ""; }
    }

    static string JsNpmStatus()
    {
        string node = FindNodeExecutable();
        string npm = FindNpmCli(node);
        string nodeVersion = string.IsNullOrEmpty(node) ? "" : RunVersionProbe(node, "--version");
        string npmVersion = string.IsNullOrEmpty(node) || string.IsNullOrEmpty(npm)
            ? "" : RunVersionProbe(node, QuoteProcessArgument(npm) + " --version");
        bool available = nodeVersion.Length > 0 && npmVersion.Length > 0;
        return "{\"available\":" + (available ? "true" : "false")
            + ",\"node\":" + JsonString(nodeVersion) + ",\"npm\":" + JsonString(npmVersion) + "}";
    }

    static void PrepareNpmRunner()
    {
        string dir = Path.GetDirectoryName(NpmPackageRunnerPath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        bool same = false;
        try
        {
            if (File.Exists(NpmPackageRunnerPath))
            {
                byte[] old = File.ReadAllBytes(NpmPackageRunnerPath);
                if (old.Length == NpmPackageRunner.Length)
                {
                    same = true;
                    for (int i = 0; i < old.Length; i++) if (old[i] != NpmPackageRunner[i]) { same = false; break; }
                }
            }
        }
        catch { }
        if (!same) File.WriteAllBytes(NpmPackageRunnerPath, NpmPackageRunner);
    }

    static int InstalledNpmPackageCount()
    {
        if (!Directory.Exists(NpmPackageCachePath)) return 0;
        int count = 0;
        foreach (string dir in Directory.GetDirectories(NpmPackageCachePath))
            if (IsSafeNpmId(Path.GetFileName(dir)) && File.Exists(Path.Combine(dir, "metadata.json"))) count++;
        return count;
    }

    // 취소·강제 종료가 설치 교체 중간에 일어나도 다음 설치 전에 작업폴더를 정리하고 이전 캐시를 복구한다.
    static void RecoverNpmPackageCache()
    {
        try
        {
            if (!Directory.Exists(NpmPackageCachePath)) return;
            foreach (string dir in Directory.GetDirectories(NpmPackageCachePath))
            {
                string name = Path.GetFileName(dir);
                if (name.StartsWith(".work-", StringComparison.Ordinal))
                {
                    try { Directory.Delete(dir, true); } catch { }
                    continue;
                }
                if (name.Length > 37 && IsSafeNpmId(name.Substring(0, 32))
                    && name.Substring(32).StartsWith(".old-", StringComparison.Ordinal))
                {
                    string target = Path.Combine(NpmPackageCachePath, name.Substring(0, 32));
                    try
                    {
                        if (!Directory.Exists(target)) Directory.Move(dir, target);
                        else Directory.Delete(dir, true);
                    }
                    catch { }
                }
            }
        }
        catch { }
    }

    static string StartJsNpmInstall(byte[] body)
    {
        string[] request = ParseNpmInstallRequest(body);
        string node = FindNodeExecutable();
        if (string.IsNullOrEmpty(node)) throw new InvalidOperationException("no-node");
        string npmCli = FindNpmCli(node);
        if (string.IsNullOrEmpty(npmCli)) throw new InvalidOperationException("no-npm");
        lock (NpmJobsLock)
            foreach (NpmJob active in NpmJobs.Values)
                if (!active.Complete) throw new InvalidOperationException("npm-busy");
        SweepNpmJobs();
        RecoverNpmPackageCache();
        string packageId = NpmPackageId(request[0], request[2]);
        string target = Path.Combine(NpmPackageCachePath, packageId);
        if (File.Exists(Path.Combine(target, "metadata.json")))
            throw new InvalidOperationException("npm-package-exists");
        if (!Directory.Exists(target) && InstalledNpmPackageCount() >= 20)
            throw new InvalidOperationException("npm-package-limit");
        PrepareNpmRunner();

        NpmJob job = new NpmJob();
        job.Id = Guid.NewGuid().ToString("N");
        job.Log.AppendLine("npm 패키지를 별도 캐시에 설치합니다. install script는 실행하지 않습니다.");
        string[] args = new string[] { NpmPackageRunnerPath, NpmPackageCachePath, packageId, npmCli, request[0], request[1], request[2] };
        StringBuilder command = new StringBuilder();
        for (int i = 0; i < args.Length; i++)
        {
            if (i > 0) command.Append(' ');
            command.Append(QuoteProcessArgument(args[i]));
        }
        ProcessStartInfo psi = new ProcessStartInfo(node, command.ToString());
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = new UTF8Encoding(false);
        psi.StandardErrorEncoding = new UTF8Encoding(false);
        psi.EnvironmentVariables["NO_COLOR"] = "1";

        job.Process = new Process();
        job.Process.StartInfo = psi;
        job.Process.Start();
        lock (NpmJobsLock) NpmJobs[job.Id] = job;
        Thread outReader = StartLimitedReader(job.Process.StandardOutput, job.Log);
        Thread errReader = StartLimitedReader(job.Process.StandardError, job.Log);
        Thread watcher = new Thread(delegate()
        {
            bool exited = false;
            try { exited = job.Process.WaitForExit(480000); } catch { }
            if (!exited)
            {
                bool cancelled;
                lock (job.Sync) cancelled = job.CancelRequested;
                if (!cancelled) job.Log.AppendLine("[시간 초과: 설치를 8분 후 중단했습니다.]");
                KillProcessTree(job.Process);
                try { job.Process.WaitForExit(3000); } catch { }
            }
            try { outReader.Join(2500); errReader.Join(2500); } catch { }
            int code;
            try { code = job.Process.ExitCode; } catch { code = -1; }
            lock (job.Sync)
            {
                job.ExitCode = job.CancelRequested ? -1 : (exited ? code : -1);
                job.DoneAt = DateTime.UtcNow;
                job.Complete = true;
            }
            try { job.Process.Dispose(); } catch { }
            SweepNpmJobs();
        });
        watcher.IsBackground = true;
        watcher.Start();
        return "{\"id\":" + JsonString(job.Id) + "}";
    }

    static string PollJsNpmInstall(string id, string knownLen)
    {
        NpmJob job;
        lock (NpmJobsLock) if (!NpmJobs.TryGetValue(id ?? "", out job))
            return "{\"complete\":true,\"code\":-1,\"cancelled\":false,\"log\":" + JsonString("설치 작업을 찾지 못했습니다.") + "}";
        lock (job.Sync)
        {
            int from = 0;
            bool known = int.TryParse(knownLen ?? "", out from) && from >= 0 && from <= job.Log.TextLength;
            if (known && !job.Complete && from == job.Log.TextLength) return "{\"complete\":false,\"unchanged\":true}";
            string head = "{\"complete\":" + (job.Complete ? "true" : "false")
                + ",\"code\":" + job.ExitCode + ",\"cancelled\":" + (job.CancelRequested ? "true" : "false");
            if (known) return head + ",\"logDelta\":" + JsonString(job.Log.GetTextFrom(from)) + "}";
            return head + ",\"log\":" + JsonString(job.Log.GetText()) + "}";
        }
    }

    static void CancelJsNpmInstall(string id)
    {
        NpmJob job;
        lock (NpmJobsLock) if (!NpmJobs.TryGetValue(id ?? "", out job)) return;
        lock (job.Sync)
        {
            if (job.Complete || job.CancelRequested) return;
            job.CancelRequested = true;
        }
        job.Log.AppendLine("[설치를 취소했습니다. 이전에 완료된 캐시는 그대로 남습니다.]");
        KillProcessTree(job.Process);
    }

    static void SweepNpmJobs()
    {
        lock (NpmJobsLock)
        {
            List<NpmJob> done = new List<NpmJob>();
            foreach (NpmJob job in NpmJobs.Values) if (job.Complete) done.Add(job);
            done.Sort(delegate(NpmJob a, NpmJob b) { return a.DoneAt.CompareTo(b.DoneAt); });
            DateTime now = DateTime.UtcNow;
            List<NpmJob> remove = new List<NpmJob>();
            foreach (NpmJob job in done) if ((now - job.DoneAt).TotalMinutes > 10) remove.Add(job);
            for (int i = 0; i < done.Count - 8; i++) if (!remove.Contains(done[i])) remove.Add(done[i]);
            foreach (NpmJob job in remove) NpmJobs.Remove(job.Id);
        }
    }

    static string ListJsNpmPackages()
    {
        StringBuilder json = new StringBuilder("[");
        try
        {
            if (Directory.Exists(NpmPackageCachePath))
            {
                foreach (string dir in Directory.GetDirectories(NpmPackageCachePath))
                {
                    string id = Path.GetFileName(dir);
                    if (!IsSafeNpmId(id)) continue;
                    string metadataPath = Path.Combine(dir, "metadata.json");
                    if (!File.Exists(metadataPath) || new FileInfo(metadataPath).Length > 64 * 1024) continue;
                    string metadata = File.ReadAllText(metadataPath, Encoding.UTF8).Trim();
                    if (!metadata.StartsWith("{", StringComparison.Ordinal) || !metadata.EndsWith("}", StringComparison.Ordinal)) continue;
                    if (json.Length > 1) json.Append(',');
                    json.Append(metadata);
                }
            }
        }
        catch { }
        return json.Append(']').ToString();
    }

    static bool TryReadJsNpmBundle(string id, out byte[] bundle)
    {
        bundle = null;
        if (!IsSafeNpmId(id)) return false;
        string dir = Path.Combine(NpmPackageCachePath, id);
        string metadata = Path.Combine(dir, "metadata.json");
        string path = Path.Combine(dir, "bundle.js");
        try
        {
            if (!File.Exists(metadata) || !File.Exists(path)) return false;
            FileInfo info = new FileInfo(path);
            if (info.Length <= 0 || info.Length > 8L * 1024 * 1024) return false;
            bundle = File.ReadAllBytes(path);
            return true;
        }
        catch { bundle = null; return false; }
    }

    static bool DeleteJsNpmPackage(string id)
    {
        if (!IsSafeNpmId(id)) return false;
        string dir = Path.Combine(NpmPackageCachePath, id);
        try
        {
            if (!Directory.Exists(dir)) return false;
            Directory.Delete(dir, true);
            return true;
        }
        catch { return false; }
    }

    static readonly System.Text.RegularExpressions.Regex PkgNameRe =
        new System.Text.RegularExpressions.Regex(@"^[A-Za-z0-9][A-Za-z0-9._-]*([=<>!~]=?[A-Za-z0-9._*-]+)?$");

    // 본문(공백·쉼표 구분) → 설치할 패키지 목록. 주입 가능한 인자는 여기서 막는다.
    static List<string> ParsePipPackages(byte[] body)
    {
        string text = Encoding.UTF8.GetString(body ?? new byte[0]);
        string[] raw = text.Split(new char[] { ' ', '\t', '\r', '\n', ',' }, StringSplitOptions.RemoveEmptyEntries);
        List<string> pkgs = new List<string>();
        foreach (string p in raw)
        {
            string t = p.Trim();
            if (t.Length == 0) continue;
            if (!PkgNameRe.IsMatch(t)) throw new Exception("invalid-package: " + t);  // 주입/이상한 인자 차단
            pkgs.Add(t);
            if (pkgs.Count >= 40) break;
        }
        if (pkgs.Count == 0) throw new Exception("no-packages");
        return pkgs;
    }

    static ProcessStartInfo PipInstallStartInfo(string interp, List<string> pkgs)
    {
        StringBuilder argSb = new StringBuilder();
        if (interp == "py") argSb.Append("-3 ");
        argSb.Append("-m pip install --disable-pip-version-check --no-input");
        // 저장소에 번들된 순수 파이썬 휠(vendor/wheels)을 우선 사용 → 인터넷 없이도 클릭 한 번 설치(없는 패키지는 PyPI 폴백).
        string wheelsDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "vendor", "wheels");
        if (Directory.Exists(wheelsDir)) argSb.Append(" --find-links \"").Append(wheelsDir).Append("\"");
        foreach (string p in pkgs) argSb.Append(" \"").Append(p).Append("\"");

        ProcessStartInfo psi = new ProcessStartInfo(interp, argSb.ToString());
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = new UTF8Encoding(false);
        psi.StandardErrorEncoding = new UTF8Encoding(false);
        psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        // 파이프로 내보낼 때 pip 은 진행바를 생략한다. 대신 줄 단위 진행(Collecting/Downloading/Installing)을 바로 흘려보내게 한다.
        psi.EnvironmentVariables["PYTHONUNBUFFERED"] = "1";
        return psi;
    }

    // 설치를 시작만 하고 id 를 돌려준다. 로그는 버퍼에 쌓이고 프런트가 /pip-install-poll 로 증분을 받아간다.
    static string StartPipInstall(byte[] body)
    {
        string interp = FindPython();
        if (interp == null) throw new PythonMissingException();
        List<string> pkgs = ParsePipPackages(body);
        SweepPipJobs();

        PipJob job = new PipJob();
        job.Id = Guid.NewGuid().ToString("N");
        job.Log.AppendLine("pip install " + string.Join(" ", pkgs.ToArray()));

        job.Process = new Process();
        job.Process.StartInfo = PipInstallStartInfo(interp, pkgs);
        job.Process.Start();
        lock (PipJobsLock) PipJobs[job.Id] = job;

        // stdout·stderr 를 한 버퍼에 모아 pip 가 낸 순서대로 보이게 한다(LimitedTextBuffer 는 내부에서 잠근다).
        Thread outReader = StartLimitedReader(job.Process.StandardOutput, job.Log);
        Thread errReader = StartLimitedReader(job.Process.StandardError, job.Log);
        Thread watcher = new Thread(delegate()
        {
            bool exited = false;
            try { exited = job.Process.WaitForExit(300000); } catch { }   // 최대 5분(큰 휠 다운로드 여유)
            if (!exited)
            {
                bool cancelled;
                lock (job.Sync) cancelled = job.CancelRequested;
                if (!cancelled) job.Log.AppendLine("[시간 초과: 설치를 5분 후 중단했습니다.]");
                KillProcessTree(job.Process);
                try { job.Process.WaitForExit(2000); } catch { }
            }
            try { outReader.Join(2000); errReader.Join(2000); } catch { }
            int code;
            try { code = job.Process.ExitCode; } catch { code = -1; }
            lock (job.Sync)
            {
                // 취소는 pip 을 죽여서 끝내므로 종료 코드가 무엇이든 실패로 보고한다.
                job.ExitCode = job.CancelRequested ? -1 : (exited ? code : -1);
                job.DoneAt = DateTime.UtcNow;
                job.Complete = true;
            }
            try { job.Process.Dispose(); } catch { }
            SweepPipJobs();
        });
        watcher.IsBackground = true;
        watcher.Start();
        return "{\"id\":" + JsonString(job.Id) + "}";
    }

    // 증분 폴링 — 파이썬 세션(PollPythonSession)과 같은 규약. from 이 현재 길이와 같고 아직 진행 중이면 본문 없이 짧게 답한다.
    static string PollPipInstall(string id, string knownLen)
    {
        PipJob job;
        lock (PipJobsLock) if (!PipJobs.TryGetValue(id ?? "", out job))
            return "{\"complete\":true,\"code\":-1,\"cancelled\":false,\"log\":" + JsonString("설치 작업을 찾지 못했습니다.") + "}";
        lock (job.Sync)
        {
            int from = 0;
            bool known = int.TryParse(knownLen ?? "", out from) && from >= 0 && from <= job.Log.TextLength;
            if (known && !job.Complete && from == job.Log.TextLength)
                return "{\"complete\":false,\"unchanged\":true}";
            string head = "{\"complete\":" + (job.Complete ? "true" : "false")
                + ",\"code\":" + job.ExitCode
                + ",\"cancelled\":" + (job.CancelRequested ? "true" : "false");
            if (known) return head + ",\"logDelta\":" + JsonString(job.Log.GetTextFrom(from)) + "}";
            return head + ",\"log\":" + JsonString(job.Log.GetText()) + "}";
        }
    }

    static void CancelPipInstall(string id)
    {
        PipJob job;
        lock (PipJobsLock) if (!PipJobs.TryGetValue(id ?? "", out job)) return;
        lock (job.Sync)
        {
            if (job.Complete || job.CancelRequested) return;
            job.CancelRequested = true;
        }
        job.Log.AppendLine("[설치를 취소했습니다. 이미 설치된 패키지는 그대로 남습니다.]");
        KillProcessTree(job.Process);
    }

    // 끝난 작업은 로그를 잠시 남겨 두고(폴링이 늦게 와도 결과를 볼 수 있게) 오래된 것만 버린다.
    static void SweepPipJobs()
    {
        lock (PipJobsLock)
        {
            List<PipJob> done = new List<PipJob>();
            foreach (PipJob job in PipJobs.Values) if (job.Complete) done.Add(job);
            done.Sort(delegate(PipJob a, PipJob b) { return a.DoneAt.CompareTo(b.DoneAt); });
            DateTime now = DateTime.UtcNow;
            List<PipJob> remove = new List<PipJob>();
            foreach (PipJob job in done)
                if ((now - job.DoneAt).TotalMinutes > 10) remove.Add(job);
            for (int i = 0; i < done.Count - 8; i++)
                if (!remove.Contains(done[i])) remove.Add(done[i]);
            foreach (PipJob job in remove) PipJobs.Remove(job.Id);
        }
    }

    // 예전 오프라인 HTML(스트리밍 폴링을 모르는 판)을 위한 한 번에 응답하는 경로. 새 화면은 /pip-install-start 를 쓴다.
    static string PipInstall(byte[] body)
    {
        string interp = FindPython();
        if (interp == null) throw new PythonMissingException();

        List<string> pkgs = ParsePipPackages(body);
        ProcessStartInfo psi = PipInstallStartInfo(interp, pkgs);

        StringBuilder outSb = new StringBuilder();
        int exitCode = -1;
        Process proc = null;
        try
        {
            proc = new Process();
            proc.StartInfo = psi;
            proc.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) lock (outSb) outSb.AppendLine(e.Data); };
            proc.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) lock (outSb) outSb.AppendLine(e.Data); };
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
            if (!proc.WaitForExit(300000))   // 최대 5분(큰 휠 다운로드 여유)
            {
                try { proc.Kill(); } catch { }
                try { proc.WaitForExit(2000); } catch { }
                lock (outSb) outSb.AppendLine("[시간 초과: 설치를 5분 후 중단했습니다.]");
                exitCode = -1;
            }
            else { proc.WaitForExit(); exitCode = proc.ExitCode; }
        }
        finally { if (proc != null) { try { proc.Dispose(); } catch { } } }

        string tail;
        lock (outSb) tail = outSb.ToString();
        if (tail.Length > 8000) tail = "…(생략)…\n" + tail.Substring(tail.Length - 8000);  // 끝부분(설치 결과)만

        return "{\"ok\":" + (exitCode == 0 ? "true" : "false")
             + ",\"code\":" + exitCode
             + ",\"output\":" + JsonString(tail) + "}";
    }

    // ===== Jedi 기반 문맥 자동완성 =====
    // ===== 설치된 로컬 Python 패키지의 안전한 import 색인 =====
    static readonly object PythonImportIndexLock = new object();
    static string _pythonImportIndexState = "idle"; // idle | building | ready | error
    static string _pythonImportIndexJson = "";
    static string _pythonImportIndexRunnerPath = null;

    static string PythonImportIndexRunner()
    {
        lock (PythonImportIndexLock)
        {
            if (_pythonImportIndexRunnerPath != null && File.Exists(_pythonImportIndexRunnerPath)) return _pythonImportIndexRunnerPath;
            string path = Path.Combine(Path.GetTempPath(), "moida_python_import_index.py");
            File.WriteAllText(path, @"import ast
import json
import os
import site
import sysconfig
import tokenize

MAX_FILES = 20000
MAX_ITEMS = 20000
MAX_FILE_BYTES = 1024 * 1024
skip_dirs = set(['__pycache__', 'tests', 'test', 'docs', 'doc', 'examples', 'example', 'data', 'dist-info', 'egg-info'])
bases = []
for value in list(getattr(site, 'getsitepackages', lambda: [])()) + [getattr(site, 'getusersitepackages', lambda: '')(), sysconfig.get_paths().get('purelib', ''), sysconfig.get_paths().get('platlib', '')]:
    if value and os.path.isdir(value) and value not in bases:
        bases.append(value)

items = {}
def add(name, kind, import_text):
    if len(items) >= MAX_ITEMS or not name or name.startswith('_') or not name.isidentifier():
        return
    key = (name, import_text)
    if key not in items:
        items[key] = {'name': name, 'type': kind, 'importText': import_text}

def module_for(base, full):
    rel = os.path.relpath(full, base)
    parts = rel.split(os.sep)
    leaf = parts.pop()
    stem = os.path.splitext(leaf)[0]
    if stem != '__init__':
        parts.append(stem)
    if not parts or any((not p.isidentifier()) for p in parts):
        return ''
    return '.'.join(parts)

try:
    from importlib import metadata
    for dist in metadata.distributions():
        top_level = dist.read_text('top_level.txt') or ''
        for top in top_level.splitlines():
            top = top.strip()
            if top.isidentifier():
                add(top, 'module', 'import ' + top)
except Exception:
    pass

seen_files = 0
for base in bases:
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if not d.startswith('.') and not d.endswith(('.dist-info', '.egg-info')) and d not in skip_dirs]
        for file_name in files:
            if seen_files >= MAX_FILES or len(items) >= MAX_ITEMS:
                break
            if not file_name.endswith(('.py', '.pyi')) or file_name.startswith('.'):
                continue
            full = os.path.join(root, file_name)
            try:
                if os.path.getsize(full) > MAX_FILE_BYTES:
                    continue
                module = module_for(base, full)
                if not module:
                    continue
                seen_files += 1
                top = module.split('.')[0]
                add(top, 'module', 'import ' + top)
                with tokenize.open(full) as handle:
                    tree = ast.parse(handle.read(), filename=full)
            except Exception:
                continue
            for node in tree.body:
                if isinstance(node, ast.ClassDef):
                    add(node.name, 'class', 'from ' + module + ' import ' + node.name)
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    add(node.name, 'function', 'from ' + module + ' import ' + node.name)
                elif isinstance(node, ast.ImportFrom) and node.level:
                    for alias in node.names:
                        if alias.name != '*':
                            public_name = alias.asname or alias.name
                            add(public_name, 'class', 'from ' + module + ' import ' + public_name)
        if seen_files >= MAX_FILES or len(items) >= MAX_ITEMS:
            break

rows = sorted(items.values(), key=lambda item: (item['name'].lower(), item['name'], item['importText'].count('.'), item['importText']))
print(json.dumps({'ok': True, 'state': 'ready', 'items': rows, 'truncated': seen_files >= MAX_FILES or len(items) >= MAX_ITEMS}, ensure_ascii=False, separators=(',', ':')))
", new UTF8Encoding(false));
            _pythonImportIndexRunnerPath = path;
            return path;
        }
    }

    static void BuildPythonImportIndex()
    {
        string result = "";
        string error = "";
        try
        {
            string interp = FindPython();
            if (interp == null) throw new PythonMissingException();
            string args = (interp == "py" ? "-3 " : "") + "\"" + PythonImportIndexRunner() + "\"";
            ProcessStartInfo psi = new ProcessStartInfo(interp, args);
            psi.UseShellExecute = false; psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = new UTF8Encoding(false);
            psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            Process proc = Process.Start(psi);
            if (proc == null) throw new InvalidOperationException("index-spawn-failed");
            result = proc.StandardOutput.ReadToEnd();
            error = proc.StandardError.ReadToEnd();
            if (!proc.WaitForExit(60000))
            {
                try { proc.Kill(); } catch { }
                throw new TimeoutException("index-timeout");
            }
            if (proc.ExitCode != 0 || string.IsNullOrWhiteSpace(result)) throw new InvalidOperationException("index-failed: " + error);
            if (result.Length > 8 * 1024 * 1024) throw new InvalidOperationException("index-too-large");
            result = result.Trim();
            if (!result.StartsWith("{", StringComparison.Ordinal)) throw new InvalidOperationException("index-invalid-response");
        }
        catch (Exception ex)
        {
            error = FlattenMessage(ex);
            result = "";
        }
        lock (PythonImportIndexLock)
        {
            if (!string.IsNullOrEmpty(result))
            {
                _pythonImportIndexJson = result;
                _pythonImportIndexState = "ready";
            }
            else
            {
                _pythonImportIndexJson = "{\"ok\":false,\"state\":\"error\",\"reason\":" + JsonString(string.IsNullOrEmpty(error) ? "index-failed" : error) + ",\"items\":[]}";
                _pythonImportIndexState = "error";
            }
        }
    }

    static string PythonImportIndexJson()
    {
        lock (PythonImportIndexLock)
        {
            if (_pythonImportIndexState == "ready" || _pythonImportIndexState == "error") return _pythonImportIndexJson;
            if (_pythonImportIndexState == "idle")
            {
                _pythonImportIndexState = "building";
                Thread worker = new Thread(BuildPythonImportIndex);
                worker.IsBackground = true;
                worker.Start();
            }
            return "{\"ok\":true,\"state\":\"building\",\"items\":[]}";
        }
    }

    // ===== Jedi 기반 문맥 자동완성 =====
    static readonly object JediLock = new object();
    static bool? _jediReady = null;
    static string _jediRunnerPath = null;

    // ===== Jedi 프로젝트 미러 =====
    // 브라우저 폴더 핸들(showDirectoryPicker)로 연 작업공간에는 실제 디스크 경로가 없다. Jedi 가
    // 프로젝트 모듈(from 내패키지.모듈 import …)을 풀려면 진짜 폴더가 필요해서, 작업공간의 .py 를
    // 임시 폴더에 그대로 미러링하고 그 폴더를 jedi.Project 루트로 넘긴다.
    // 미러 경로는 서버만 알고 환경변수로 러너에 준다 — 요청이 임의 폴더를 가리킬 수 없게.
    static readonly object ProjectMirrorLock = new object();
    static string _projectMirrorRoot = null;
    const int ProjectMirrorMaxFiles = 20000;
    const int ProjectMirrorMaxFileBytes = 1024 * 1024;

    static string CurrentProjectMirrorRoot()
    {
        lock (ProjectMirrorLock)
        {
            return (_projectMirrorRoot != null && Directory.Exists(_projectMirrorRoot)) ? _projectMirrorRoot : null;
        }
    }

    // body: [count]([pathLen][path][dataLen][data])*  — 실행 번들과 같은 리틀엔디언 형식(대상·표준입력 없음).
    // 새 폴더에 통째로 쓰고 마지막에 교체한다 — 진행 중인 Jedi 프로세스가 읽던 파일이 사라지지 않도록.
    static string SyncPythonProjectMirror(byte[] body)
    {
        if (body == null || body.Length > 64 * 1024 * 1024) throw new Exception("bad-project-bundle");
        int pos = 0;
        int count = ReadBundleInt(body, ref pos);
        if (count < 0 || count > ProjectMirrorMaxFiles) throw new Exception("bad-project-bundle");
        string fresh = Path.Combine(Path.GetTempPath(), "moidapy_project_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(fresh);
        int written = 0;
        try
        {
            for (int i = 0; i < count; i++)
            {
                string rel = ReadBundleString(body, ref pos);
                int len = ReadBundleInt(body, ref pos);
                if (len < 0 || pos + len > body.Length) throw new Exception("bad-project-bundle");
                string safe = SafeRelPath(rel);
                if (safe != null && len <= ProjectMirrorMaxFileBytes && IsPythonSourcePath(safe))
                {
                    string full = Path.Combine(fresh, safe);
                    string dir = Path.GetDirectoryName(full);
                    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                    using (FileStream fs = new FileStream(full, FileMode.Create, FileAccess.Write))
                        fs.Write(body, pos, len);
                    written++;
                }
                pos += len;   // 건너뛴 파일도 스트림 위치는 그대로 진행
            }
            if (pos != body.Length) throw new Exception("bad-project-bundle");
        }
        catch
        {
            try { Directory.Delete(fresh, true); } catch { }
            throw;
        }
        string previous;
        lock (ProjectMirrorLock)
        {
            previous = _projectMirrorRoot;
            _projectMirrorRoot = fresh;
        }
        if (previous != null) try { Directory.Delete(previous, true); } catch { }   // 아직 읽는 중이면 다음 기회에 정리된다
        return "{\"ok\":true,\"files\":" + written + "}";
    }

    static bool IsPythonSourcePath(string rel)
    {
        string lower = (rel ?? "").ToLowerInvariant();
        return lower.EndsWith(".py") || lower.EndsWith(".pyw") || lower.EndsWith(".pyi");
    }

    static void ClearPythonProjectMirror()
    {
        string previous;
        lock (ProjectMirrorLock) { previous = _projectMirrorRoot; _projectMirrorRoot = null; }
        if (previous != null) try { Directory.Delete(previous, true); } catch { }
    }

    static bool RunPyCheck(string interp, string code)
    {
        try
        {
            string args = (interp == "py" ? "-3 " : "") + "-c \"" + code + "\"";
            ProcessStartInfo psi = new ProcessStartInfo(interp, args);
            psi.UseShellExecute = false; psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
            Process p = Process.Start(psi);
            if (p == null) return false;
            p.StandardOutput.ReadToEnd(); p.StandardError.ReadToEnd();
            if (!p.WaitForExit(8000)) { try { p.Kill(); } catch { } return false; }
            return p.ExitCode == 0;
        }
        catch { return false; }
    }

    // Jedi 사용 가능 보장(없으면 최초 1회 pip 설치 시도). 결과는 캐시 → 다음부터 즉시.
    static bool EnsureJedi()
    {
        string interp = FindPython();
        if (interp == null) return false;
        lock (JediLock)
        {
            if (_jediReady.HasValue) return _jediReady.Value;
            if (RunPyCheck(interp, "import jedi")) { _jediReady = true; return true; }
            try
            {
                StringBuilder a = new StringBuilder();
                if (interp == "py") a.Append("-3 ");
                a.Append("-m pip install --disable-pip-version-check --no-input jedi");
                ProcessStartInfo psi = new ProcessStartInfo(interp, a.ToString());
                psi.UseShellExecute = false; psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
                Process p = Process.Start(psi);
                if (p != null) { p.StandardOutput.ReadToEnd(); p.StandardError.ReadToEnd(); p.WaitForExit(180000); }
            }
            catch { /* 오프라인 등 → 설치 실패 시 폴백 */ }
            _jediReady = RunPyCheck(interp, "import jedi");
            return _jediReady.Value;
        }
    }

    static string JediRunner()
    {
        lock (JediLock)
        {
            if (_jediRunnerPath != null && File.Exists(_jediRunnerPath)) return _jediRunnerPath;
            string path = Path.Combine(Path.GetTempPath(), "moida_jedi_complete.py");
            File.WriteAllText(path,
                "import sys, json, os\n" +
                "data = json.load(sys.stdin)\n" +
                "mode = data.get('mode', 'complete')\n" +
                "try:\n" +
                "    import jedi\n" +
                "except Exception:\n" +
                "    print(json.dumps({'ok': False, 'reason': 'no-jedi'})); sys.exit(0)\n" +
                "src = data.get('source','')\n" +
                "line = int(data.get('line', 1)); col = int(data.get('column', 0))\n" +
                // 프로젝트 루트는 서버가 환경변수로만 준다. 요청의 path 는 그 안의 상대경로로만 쓴다
                // (정규화 후 루트 밖을 가리키면 버린다) — 요청이 임의 경로를 열지 못하게.
                "root = os.environ.get('MOIDA_JEDI_ROOT', '') or ''\n" +
                "root = os.path.normpath(root) if root else ''\n" +   // 구분자를 os 형식으로 통일 — 아래 경로 비교의 전제
                "if root and not os.path.isdir(root): root = ''\n" +
                "def inside(rel_path):\n" +           // 미러 안으로만 해석한다(루트 밖을 가리키면 버린다)
                "    if not root or not rel_path: return ''\n" +
                "    candidate = os.path.normpath(os.path.join(root, rel_path))\n" +
                "    return candidate if (candidate == root or candidate.startswith(root + os.sep)) else ''\n" +
                "clean = lambda value: str(value or '').replace('\\\\', '/').strip('/')\n" +
                "script_path = inside(clean(data.get('path', ''))) or None\n" +
                // 실행 기준 폴더(sys.path 루트)가 곧 프로젝트 루트다. 작업공간 루트와 다를 수 있어
                // (예: llm_project/ 아래에 패키지가 있는 구조) 앱이 추정한 값을 상대경로로 받는다.
                "project_root = inside(clean(data.get('root', ''))) or root\n" +
                "def to_workspace(p):\n" +           // 미러 안의 경로 → 작업공간 상대경로(앱이 원래 탭을 열도록)
                "    if not root or not p: return ''\n" +
                "    try: full = os.path.normpath(str(p))\n" +
                "    except Exception: return ''\n" +
                "    if not full.startswith(root + os.sep): return ''\n" +
                "    return full[len(root) + 1:].replace(os.sep, '/')\n" +
                "try:\n" +
                "    project = None\n" +
                "    if project_root:\n" +
                "        try: project = jedi.Project(project_root)\n" +
                "        except Exception: project = None\n" +
                "    try:\n" +
                "        script = jedi.Script(code=src, path=script_path, project=project)\n" +
                "    except TypeError:\n" +          // 예전 Jedi(project/path 인자 없음)에서는 지금까지처럼 코드만 본다
                "        script = jedi.Script(code=src)\n" +
                "    if mode == 'definition':\n" +
                "        defs = []\n" +
                "        try:\n" +
                "            defs = script.goto(line, col, follow_imports=True, follow_builtin_imports=True)\n" +
                "        except TypeError:\n" +
                "            defs = script.goto(line, col)\n" +
                "        if not defs:\n" +
                "            try: defs = script.infer(line, col)\n" +
                "            except Exception: defs = []\n" +
                "        for d in defs:\n" +
                "            p = getattr(d, 'module_path', None)\n" +
                "            if p:\n" +
                "                print(json.dumps({'ok': True, 'path': str(p), 'workspacePath': to_workspace(p), 'line': getattr(d, 'line', 1) or 1, 'column': getattr(d, 'column', 0) or 0, 'name': getattr(d, 'name', '') or '', 'type': getattr(d, 'type', '') or ''})); sys.exit(0)\n" +
                "        print(json.dumps({'ok': False, 'reason': 'builtin'})); sys.exit(0)\n" +
                // import 검사: 위치 목록을 한 번에 받아 각 자리에서 정의를 찾아본다(프로세스 1회).
                // 못 찾은 자리의 인덱스만 돌려준다 — 앱이 그 자리에 경고 표시를 붙인다.
                "    elif mode == 'imports':\n" +
                "        targets = data.get('targets') or []\n" +
                "        unresolved = []\n" +
                "        for index, target in enumerate(targets[:120]):\n" +
                "            try:\n" +
                "                at_line = int(target.get('line', 1)); at_col = int(target.get('column', 0))\n" +
                "            except Exception:\n" +
                "                continue\n" +
                "            found = []\n" +
                "            try:\n" +
                "                found = script.goto(at_line, at_col, follow_imports=True, follow_builtin_imports=True)\n" +
                "            except TypeError:\n" +
                "                try: found = script.goto(at_line, at_col)\n" +
                "                except Exception: found = []\n" +
                "            except Exception:\n" +
                "                found = []\n" +
                "            if not found:\n" +
                "                try: found = script.infer(at_line, at_col)\n" +
                "                except Exception: found = []\n" +
                "            if not found: unresolved.append(index)\n" +
                "        print(json.dumps({'ok': True, 'unresolved': unresolved})); sys.exit(0)\n" +
                "    elif mode == 'help':\n" +
                "        names = []\n" +
                "        try:\n" +
                "            names = script.help(line, col)\n" +
                "        except Exception:\n" +
                "            names = []\n" +
                "        for d in names:\n" +
                "            doc = ''\n" +
                "            try: doc = d.docstring(raw=False) or ''\n" +
                "            except Exception: doc = ''\n" +
                "            sig = ''\n" +
                "            try:\n" +
                "                sigs = d.get_signatures()\n" +
                "                if sigs: sig = sigs[0].to_string()[:400]\n" +
                "            except Exception: pass\n" +
                "            name = getattr(d, 'name', '') or ''\n" +
                "            if name or doc or sig:\n" +
                "                print(json.dumps({'ok': True, 'name': name, 'type': getattr(d, 'type', '') or '', 'signature': sig, 'docstring': doc[:4000]})); sys.exit(0)\n" +
                "        print(json.dumps({'ok': False, 'reason': 'no-help'})); sys.exit(0)\n" +
                "    else:\n" +
                "        comps = script.complete(line, col)\n" +
                "        items = []; seen = set()\n" +
                "        for c in comps[:50]:\n" +
                "            n = c.name\n" +
                "            if not n or n in seen: continue\n" +
                "            seen.add(n)\n" +
                "            kind = getattr(c, 'type', '') or ''\n" +
                "            signature = ''\n" +
                "            if kind == 'function':\n" +
                "                try:\n" +
                "                    signatures = c.get_signatures()\n" +
                "                    if signatures: signature = signatures[0].to_string()[:700]\n" +
                "                except Exception:\n" +
                "                    pass\n" +
                "            items.append({'name': n, 'type': kind, 'signature': signature})\n" +
                "        print(json.dumps({'ok': True, 'items': items}))\n" +
                "except Exception:\n" +
                "    print(json.dumps({'ok': False, 'reason': 'error'}))\n",
                new UTF8Encoding(false));
            _jediRunnerPath = path;
            return path;
        }
    }

    static string JediComplete(byte[] body)
    {
        string interp = FindPython();
        if (interp == null) throw new PythonMissingException();
        if (!EnsureJedi()) return "{\"ok\":false,\"reason\":\"no-jedi\"}";

        string runner = JediRunner();
        string args = (interp == "py" ? "-3 " : "") + "\"" + runner + "\"";
        ProcessStartInfo psi = new ProcessStartInfo(interp, args);
        psi.UseShellExecute = false; psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = new UTF8Encoding(false);
        psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        string mirror = CurrentProjectMirrorRoot();
        if (mirror != null) psi.EnvironmentVariables["MOIDA_JEDI_ROOT"] = mirror;   // 작업공간 미러가 있으면 그 폴더를 프로젝트로

        Process proc = Process.Start(psi);
        if (proc == null) return "{\"ok\":false,\"reason\":\"spawn\"}";
        byte[] inb = body ?? new byte[0];
        try { proc.StandardInput.BaseStream.Write(inb, 0, inb.Length); proc.StandardInput.BaseStream.Flush(); }
        catch { }
        try { proc.StandardInput.Close(); } catch { }
        string outp = proc.StandardOutput.ReadToEnd();
        try { proc.StandardError.ReadToEnd(); } catch { }
        if (!proc.WaitForExit(8000)) { try { proc.Kill(); } catch { } return "{\"ok\":false,\"reason\":\"timeout\"}"; }
        outp = (outp ?? "").Trim();
        return outp.Length == 0 ? "{\"ok\":false,\"reason\":\"empty\"}" : outp;
    }

    static string JediDefinition(byte[] body)
    {
        return JediComplete(body);
    }

    static string RunPython(byte[] body)
    {
        string interp = FindPython();
        if (interp == null) throw new PythonMissingException();

        byte[] src = body;
        string stdin = "";
        // 새 형식: [sourceLen][source][stdinLen][stdin]. 예전 HTML의 순수 소스 바디도 계속 허용한다.
        try
        {
            int pos = 0;
            int sourceLen = ReadBundleInt(body, ref pos);
            if (sourceLen >= 0 && pos + sourceLen + 4 <= body.Length)
            {
                byte[] parsed = new byte[sourceLen];
                Buffer.BlockCopy(body, pos, parsed, 0, sourceLen);
                pos += sourceLen;
                int stdinLen = ReadBundleInt(body, ref pos);
                if (stdinLen >= 0 && pos + stdinLen == body.Length)
                {
                    src = parsed;
                    stdin = Encoding.UTF8.GetString(body, pos, stdinLen);
                }
            }
        }
        catch { /* 구버전 요청은 body 전체를 파이썬 소스로 취급 */ }

        string tmpDir = Path.Combine(Path.GetTempPath(), "moidapy_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmpDir);
        try
        {
            string scriptPath = Path.Combine(tmpDir, "script.py");
            File.WriteAllBytes(scriptPath, src);   // 업로드 바이트 그대로(소스의 인코딩 선언 존중)
            return RunPythonFile(interp, scriptPath, tmpDir, stdin, tmpDir);
        }
        finally
        {
            try { if (Directory.Exists(tmpDir)) Directory.Delete(tmpDir, true); } catch { }
        }
    }

    // 압축 트리 번들([targetLen][target][count]([pathLen][path][dataLen][data])*[stdin][cwd])을 임시폴더에 복원 후
    // 지정한 프로젝트 cwd 에서 target 스크립트 실행 — 같은 압축의 옆 파일 import·상대경로 읽기 지원
    static string RunPythonBundle(byte[] body)
    {
        string interp = FindPython();
        if (interp == null) throw new PythonMissingException();

        int pos = 0;
        string target = ReadBundleString(body, ref pos);
        int count = ReadBundleInt(body, ref pos);
        if (count < 0 || count > 100000) throw new Exception("bad-bundle");
        string targetSafe = SafeRelPath(target);
        if (targetSafe == null) throw new Exception("bad-target");
        string stdin = "";
        string requestedCwd = "";

        string tmpDir = Path.Combine(Path.GetTempPath(), "moidapy_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmpDir);
        try
        {
            for (int i = 0; i < count; i++)
            {
                string rel = ReadBundleString(body, ref pos);
                int len = ReadBundleInt(body, ref pos);
                if (len < 0 || pos + len > body.Length) throw new Exception("bad-bundle");
                string safe = SafeRelPath(rel);
                if (safe != null)
                {
                    string full = Path.Combine(tmpDir, safe);
                    string dir = Path.GetDirectoryName(full);
                    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                    using (FileStream fs = new FileStream(full, FileMode.Create, FileAccess.Write))
                        fs.Write(body, pos, len);
                }
                pos += len;   // 안전하지 않은 경로는 건너뛰되 스트림 위치는 그대로 진행
            }

            // 새 클라이언트는 파일 목록 뒤에 표준 입력 문자열을 붙인다. 없으면 구버전 번들이다.
            if (pos < body.Length) stdin = ReadBundleString(body, ref pos);
            if (pos < body.Length) requestedCwd = ReadBundleString(body, ref pos);
            if (pos != body.Length) throw new Exception("bad-bundle");

            string targetFull = Path.Combine(tmpDir, targetSafe);
            if (!File.Exists(targetFull)) throw new Exception("target-not-found");
            string workDir = ResolveBundleWorkDir(tmpDir, requestedCwd, Path.GetDirectoryName(targetFull));
            return RunPythonFile(interp, targetFull, workDir, stdin, tmpDir);
        }
        finally
        {
            try { if (Directory.Exists(tmpDir)) Directory.Delete(tmpDir, true); } catch { }
        }
    }

    static int ReadBundleInt(byte[] b, ref int pos)
    {
        if (pos < 0 || pos + 4 > b.Length) throw new Exception("bad-bundle");
        int v = b[pos] | (b[pos + 1] << 8) | (b[pos + 2] << 16) | (b[pos + 3] << 24);
        pos += 4;
        return v;
    }

    static string ReadBundleString(byte[] b, ref int pos)
    {
        int len = ReadBundleInt(b, ref pos);
        if (len < 0 || pos + len > b.Length) throw new Exception("bad-bundle");
        string s = Encoding.UTF8.GetString(b, pos, len);
        pos += len;
        return s;
    }

    // zip-slip 방지: 절대경로·드라이브·".." 상위 탈출·잘못된 문자를 차단하고 상대경로로 정규화(null=거부)
    static string SafeRelPath(string rel)
    {
        if (string.IsNullOrEmpty(rel)) return null;
        rel = rel.Replace('\\', '/');
        char[] invalid = Path.GetInvalidFileNameChars();
        List<string> keep = new List<string>();
        foreach (string raw in rel.Split('/'))
        {
            string seg = raw.Trim();
            if (seg == "" || seg == ".") continue;
            if (seg == "..") return null;
            bool bad = false;
            foreach (char c in invalid) if (seg.IndexOf(c) >= 0) { bad = true; break; }
            if (bad) return null;
            keep.Add(seg);
        }
        if (keep.Count == 0) return null;
        return string.Join(Path.DirectorySeparatorChar.ToString(), keep.ToArray());
    }

    static string ResolveBundleWorkDir(string root, string requested, string fallback)
    {
        if (string.IsNullOrWhiteSpace(requested)) return fallback;
        string safe = SafeRelPath(requested);
        if (safe == null) throw new Exception("bad-cwd");
        string full = Path.Combine(root, safe);
        Directory.CreateDirectory(full);
        return full;
    }

    static string RunPythonFile(string interp, string scriptPath, string workDir, string stdin, string projectRoot)
    {
        string runnerPath = Path.Combine(Path.GetTempPath(), "moidapy_runner_" + Guid.NewGuid().ToString("N") + ".py");
        string plotDir = Path.Combine(Path.GetTempPath(), "moidapy_plots_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(plotDir);
        File.WriteAllText(runnerPath,
            "import os, runpy, sys\n" +
            "sys.argv[0] = os.environ['CLASSDOCK_SCRIPT']\n" +
            "_ps_script_dir = os.path.dirname(os.environ['CLASSDOCK_SCRIPT'])\n" +
            "_ps_project_root = os.environ.get('CLASSDOCK_PROJECT_ROOT', '')\n" +
            "_ps_paths = []\n" +
            "_ps_cur = _ps_script_dir\n" +
            "while _ps_cur:\n" +
            "    _ps_paths.append(_ps_cur)\n" +
            "    if _ps_project_root and os.path.normcase(os.path.abspath(_ps_cur)) == os.path.normcase(os.path.abspath(_ps_project_root)):\n" +
            "        break\n" +
            "    _ps_next = os.path.dirname(_ps_cur)\n" +
            "    if _ps_next == _ps_cur:\n" +
            "        break\n" +
            "    _ps_cur = _ps_next\n" +
            "for _ps_path in reversed(_ps_paths):\n" +
            "    if _ps_path and _ps_path not in sys.path:\n" +
            "        sys.path.insert(0, _ps_path)\n" +
            "try:\n" +
            "    runpy.run_path(os.environ['CLASSDOCK_SCRIPT'], run_name='__main__')\n" +
            "finally:\n" +
            "    try:\n" +
            "        import matplotlib.pyplot as _ps_plt\n" +
            "        for _ps_i, _ps_n in enumerate(_ps_plt.get_fignums()[:8]):\n" +
            "            _ps_plt.figure(_ps_n).savefig(os.path.join(os.environ['CLASSDOCK_PLOT_DIR'], 'plot_%02d.png' % _ps_i), bbox_inches='tight')\n" +
            "        _ps_plt.close('all')\n" +
            "    except Exception:\n" +
            "        pass\n",
            new UTF8Encoding(false));

        // -X utf8: UTF-8 모드(한글 출력 깨짐 방지). py 런처는 -3 으로 파이썬3 고정.
        string args = (interp == "py" ? "-3 " : "") + "-X utf8 \"" + runnerPath + "\"";

        ProcessStartInfo psi = new ProcessStartInfo(interp, args);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.RedirectStandardInput = true;
        psi.StandardOutputEncoding = new UTF8Encoding(false);
        psi.StandardErrorEncoding = new UTF8Encoding(false);
        psi.WorkingDirectory = workDir;
        psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        psi.EnvironmentVariables["MPLBACKEND"] = "Agg";
        psi.EnvironmentVariables["PYTHONDONTWRITEBYTECODE"] = "1";   // 세션 실행과 동일하게 __pycache__ 찌꺼기를 남기지 않는다
        psi.EnvironmentVariables["CLASSDOCK_SCRIPT"] = scriptPath;
        psi.EnvironmentVariables["CLASSDOCK_PROJECT_ROOT"] = string.IsNullOrEmpty(projectRoot) ? workDir : projectRoot;
        psi.EnvironmentVariables["CLASSDOCK_PLOT_DIR"] = plotDir;

        LimitedTextBuffer outSb = new LimitedTextBuffer();
        LimitedTextBuffer errSb = new LimitedTextBuffer();
        int exitCode = -1;
        Process proc = null;
        Thread outReader = null, errReader = null;
        try
        {
            proc = new Process();
            proc.StartInfo = psi;
            proc.Start();
            outReader = StartLimitedReader(proc.StandardOutput, outSb);
            errReader = StartLimitedReader(proc.StandardError, errSb);
            try
            {
                byte[] inputBytes = Encoding.UTF8.GetBytes(stdin ?? "");
                if (inputBytes.Length > 0) proc.StandardInput.BaseStream.Write(inputBytes, 0, inputBytes.Length);
                proc.StandardInput.BaseStream.Flush();
                proc.StandardInput.BaseStream.Close();      // 준비한 UTF-8 입력을 모두 전달한 뒤 EOF
            }
            catch { }

            bool timedOut = false;
            bool memoryLimit = false;
            Stopwatch watch = Stopwatch.StartNew();
            while (!proc.WaitForExit(250))
            {
                if (watch.ElapsedMilliseconds >= 60000) { timedOut = true; break; }
                if (ProcessTreeWorkingSetBytes(proc.Id) > PythonProcessMemoryLimitBytes) { memoryLimit = true; break; }
            }
            if (timedOut || memoryLimit)
            {
                KillProcessTree(proc);
                try { proc.WaitForExit(2000); } catch { }
                errSb.AppendLine(memoryLimit
                    ? "[메모리 제한: 실행이 4GB를 넘어 중단했습니다.]"
                    : "[시간 초과: 60초를 넘겨 실행을 중단했습니다.]");
                exitCode = -1;
            }
            else
            {
                proc.WaitForExit();                          // 비동기 출력 버퍼 flush 보장
                exitCode = proc.ExitCode;
            }
            try { if (outReader != null) outReader.Join(2000); if (errReader != null) errReader.Join(2000); } catch { }
        }
        finally
        {
            if (proc != null) { try { proc.Dispose(); } catch { } }
        }

        string imagesJson = "[]";
        try
        {
            string[] files = Directory.GetFiles(plotDir, "*.png");
            Array.Sort(files, StringComparer.OrdinalIgnoreCase);
            StringBuilder images = new StringBuilder("[");
            int count = Math.Min(files.Length, 8);
            for (int i = 0; i < count; i++)
            {
                byte[] bytes = File.ReadAllBytes(files[i]);
                if (bytes.Length > 8 * 1024 * 1024) continue;
                if (images.Length > 1) images.Append(',');
                images.Append(JsonString("data:image/png;base64," + Convert.ToBase64String(bytes)));
            }
            images.Append(']');
            imagesJson = images.ToString();
        }
        catch { }
        finally
        {
            try { if (File.Exists(runnerPath)) File.Delete(runnerPath); } catch { }
            try { if (Directory.Exists(plotDir)) Directory.Delete(plotDir, true); } catch { }
        }

        return "{\"stdout\":" + JsonString(outSb.GetText())
             + ",\"stderr\":" + JsonString(errSb.GetText())
             + ",\"code\":" + exitCode
             + ",\"images\":" + imagesJson + "}";
    }

    static string JsonString(string s)
    {
        if (s == null) s = "";
        StringBuilder sb = new StringBuilder(s.Length + 16);
        sb.Append('"');
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }

    static string FlattenMessage(Exception ex)
    {
        if (ex == null) return "";
        while (ex is TargetInvocationException && ex.InnerException != null) ex = ex.InnerException;
        string msg = ex.Message;
        if (ex.InnerException != null) msg += " / " + FlattenMessage(ex.InnerException);
        return msg;
    }

    static object Get(object o, string name)
    {
        return o.GetType().InvokeMember(name, BindingFlags.GetProperty, null, o, null);
    }
    static object Invoke(object o, string name, object[] args)
    {
        return o.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, o, args);
    }
    static object InvokeRetry(object o, string name, object[] args)
    {
        Exception last = null;
        for (int i = 0; i < 30; i++)
        {
            try { return Invoke(o, name, args); }
            catch (Exception ex)
            {
                last = ex;
                if (!IsComBusy(ex)) throw;
                Thread.Sleep(250);
            }
        }
        throw last;
    }
    static bool IsComBusy(Exception ex)
    {
        while (ex is TargetInvocationException && ex.InnerException != null) ex = ex.InnerException;
        COMException ce = ex as COMException;
        if (ce == null) return false;
        return ce.ErrorCode == unchecked((int)0x80010001) ||  // RPC_E_CALL_REJECTED
               ce.ErrorCode == unchecked((int)0x8001010A);    // RPC_E_SERVERCALL_RETRYLATER
    }
    static void TrySet(object o, string name, object val)
    {
        try { o.GetType().InvokeMember(name, BindingFlags.SetProperty, null, o, new object[] { val }); }
        catch { }
    }

    // ===================== 시험 제출 받기(교실 LAN) =====================
    // 학생 EXE 가 선생님 EXE 로 제출본(.examdone)을 바로 보내는 통로.
    //
    // 기본 서버(루프백)에는 /save-file, /workspace-save 처럼 디스크를 건드리는 통로가 열려 있다.
    // 거기에 외부 접속을 허용하면 제출 하나 받자고 그 통로 전체를 교실 네트워크에 내놓게 되므로,
    // 선생님이 [제출 받기]를 켠 동안에만 열리는 '제출 전용' 리스너를 따로 둔다.
    // 이 리스너가 아는 경로는 아래 셋뿐이고 나머지는 전부 404 다.
    //   OPTIONS /exam-submit   CORS·사설망(PNA) 사전 요청
    //   GET     /exam-hello    학생의 [연결 확인] — 세션 열림 여부와 시험 제목만
    //   POST    /exam-submit   제출본 접수
    // 학생 PC 에는 이 PC 의 로컬 토큰이 없으므로 토큰 대신 '세션 코드 + 열린 동안만 + 경로 화이트리스트'로 막는다.
    // 제출본 자체는 이미 선생님 공개키로 봉인돼 있어 평문 HTTP 로 실어도 내용은 새지 않는다.
    const int ExamReceiveMaxItems = 300;                 // 세션당 총 접수 상한
    const int ExamReceiveMaxBodyBytes = 1024 * 1024;     // 제출본 1개 상한
    const int ExamReceivePerIpPerMinute = 20;            // 같은 IP 도배 차단
    static readonly object ExamReceiveLock = new object();
    static TcpListener ExamReceiveListener = null;
    static int ExamReceivePort = 0;
    static string ExamReceiveCode = "";
    static string ExamReceiveExamId = "";
    static string ExamReceiveTitle = "";
    static DateTime ExamReceiveLastActivity = DateTime.MinValue;
    static readonly List<string> ExamReceiveItems = new List<string>();      // 접수한 .examdone 원문(색인 = seq)
    static readonly HashSet<string> ExamReceiveSeen = new HashSet<string>(StringComparer.Ordinal);
    static readonly Dictionary<string, int> ExamReceiveRate = new Dictionary<string, int>(StringComparer.Ordinal);
    static DateTime ExamReceiveRateWindow = DateTime.MinValue;
    static readonly TimeSpan ExamReceiveIdleTimeout = TimeSpan.FromHours(3);

    static string ExamReceiveNewCode()
    {
        byte[] buf = new byte[4];
        using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider()) rng.GetBytes(buf);
        int value = (int)(BitConverter.ToUInt32(buf, 0) % 1000000u);
        return value.ToString("D6");
    }

    // 학생에게 불러 줄 이 PC 의 주소. 172.16~31 을 포함한 사설 대역만 후보로 둔다.
    static List<string> ExamReceiveAddresses()
    {
        List<string> found = new List<string>();
        try
        {
            foreach (IPAddress ip in Dns.GetHostAddresses(Dns.GetHostName()))
            {
                if (ip.AddressFamily != AddressFamily.InterNetwork) continue;
                byte[] b = ip.GetAddressBytes();
                if (b[0] == 127) continue;
                bool priv = (b[0] == 10) || (b[0] == 192 && b[1] == 168) || (b[0] == 172 && b[1] >= 16 && b[1] <= 31);
                if (priv) found.Add(ip.ToString());
            }
        }
        catch { }
        return found;
    }

    static string ExamReceiveStatusJson(int since)
    {
        StringBuilder sb = new StringBuilder(512);
        lock (ExamReceiveLock)
        {
            bool open = ExamReceiveListener != null;
            sb.Append("{\"open\":").Append(open ? "true" : "false");
            sb.Append(",\"port\":").Append(ExamReceivePort);
            sb.Append(",\"code\":").Append(JsonString(ExamReceiveCode));
            sb.Append(",\"title\":").Append(JsonString(ExamReceiveTitle));
            sb.Append(",\"total\":").Append(ExamReceiveItems.Count);
            sb.Append(",\"addresses\":[");
            List<string> addr = ExamReceiveAddresses();
            for (int i = 0; i < addr.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(JsonString(addr[i]));
            }
            sb.Append("]");
            // since 이후로 새로 들어온 것만 원문 그대로 실어 보낸다(한 번에 최대 20개).
            if (since < 0) since = 0;
            sb.Append(",\"since\":").Append(since).Append(",\"items\":[");
            int sent = 0;
            for (int i = since; i < ExamReceiveItems.Count && sent < 20; i++, sent++)
            {
                if (sent > 0) sb.Append(',');
                sb.Append("{\"seq\":").Append(i + 1).Append(",\"payload\":").Append(ExamReceiveItems[i]).Append('}');
            }
            sb.Append("]}");
        }
        return sb.ToString();
    }

    static string ExamReceiveStart(string examId, string title)
    {
        lock (ExamReceiveLock)
        {
            if (ExamReceiveListener != null)
            {
                ExamReceiveExamId = examId ?? "";
                if (!string.IsNullOrEmpty(title)) ExamReceiveTitle = title;
                ExamReceiveLastActivity = DateTime.UtcNow;
                return ExamReceiveStatusJson(0);
            }
            TcpListener started = null;
            int chosen = 0;
            for (int cand = 17650; cand <= 17659 && started == null; cand++)
            {
                try
                {
                    TcpListener l = new TcpListener(IPAddress.Any, cand);
                    l.Start();
                    started = l;
                    chosen = cand;
                }
                catch { /* 점유·차단 → 다음 후보 */ }
            }
            if (started == null) return "{\"open\":false,\"error\":\"listen-failed\"}";

            ExamReceiveListener = started;
            ExamReceivePort = chosen;
            ExamReceiveCode = ExamReceiveNewCode();
            ExamReceiveExamId = examId ?? "";
            ExamReceiveTitle = title ?? "";
            ExamReceiveLastActivity = DateTime.UtcNow;
            ExamReceiveItems.Clear();
            ExamReceiveSeen.Clear();
            ExamReceiveRate.Clear();
            ExamReceiveRateWindow = DateTime.UtcNow;

            TcpListener captured = started;
            Thread accept = new Thread(delegate() { ExamReceiveAcceptLoop(captured); });
            accept.IsBackground = true;
            accept.Start();
            return ExamReceiveStatusJson(0);
        }
    }

    static void ExamReceiveStop()
    {
        TcpListener closing = null;
        lock (ExamReceiveLock)
        {
            closing = ExamReceiveListener;
            ExamReceiveListener = null;
            ExamReceivePort = 0;
            ExamReceiveCode = "";
        }
        if (closing != null) { try { closing.Stop(); } catch { } }
    }

    static void ExamReceiveAcceptLoop(TcpListener listener)
    {
        while (true)
        {
            lock (ExamReceiveLock) { if (ExamReceiveListener != listener) break; }
            TcpClient client = null;
            try { client = listener.AcceptTcpClient(); }
            catch { break; }   // Stop() 으로 닫힌 경우
            // 아무도 보내지 않는 채로 오래 열려 있으면 스스로 닫는다(켜 둔 걸 잊는 사고 방지).
            lock (ExamReceiveLock)
            {
                if (ExamReceiveListener == listener && DateTime.UtcNow - ExamReceiveLastActivity > ExamReceiveIdleTimeout)
                {
                    try { client.Close(); } catch { }
                    break;
                }
            }
            TcpClient captured = client;
            Thread worker = new Thread(delegate() { ExamReceiveHandle(captured); });
            worker.IsBackground = true;
            worker.Start();
        }
        try { listener.Stop(); } catch { }
        lock (ExamReceiveLock) { if (ExamReceiveListener == listener) { ExamReceiveListener = null; ExamReceivePort = 0; ExamReceiveCode = ""; } }
    }

    static void ExamReceiveWrite(Stream stream, string status, string body)
    {
        byte[] payload = Encoding.UTF8.GetBytes(body ?? "");
        string header =
            "HTTP/1.1 " + status + "\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: " + payload.Length + "\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Private-Network: true\r\n" +
            "Cache-Control: no-store\r\n" +
            "X-Content-Type-Options: nosniff\r\n" +
            "Connection: close\r\n" +
            "\r\n";
        byte[] headerBytes = Encoding.ASCII.GetBytes(header);
        stream.Write(headerBytes, 0, headerBytes.Length);
        stream.Write(payload, 0, payload.Length);
    }

    static bool ExamReceiveRateOk(string ip)
    {
        lock (ExamReceiveLock)
        {
            if (DateTime.UtcNow - ExamReceiveRateWindow > TimeSpan.FromMinutes(1))
            {
                ExamReceiveRate.Clear();
                ExamReceiveRateWindow = DateTime.UtcNow;
            }
            int used;
            ExamReceiveRate.TryGetValue(ip, out used);
            if (used >= ExamReceivePerIpPerMinute) return false;
            ExamReceiveRate[ip] = used + 1;
            return true;
        }
    }

    // 제출본은 평문 메타데이터(format·examId·student 등)와 봉인 덩어리로 이뤄진 최상위 JSON 이다.
    // 여기서 보는 값은 파일 이름과 대조용일 뿐이라 완전한 파서 대신 최상위 문자열만 훑어 꺼낸다.
    static string ExamJsonString(string json, string key)
    {
        if (string.IsNullOrEmpty(json)) return "";
        string needle = "\"" + key + "\"";
        int at = json.IndexOf(needle, StringComparison.Ordinal);
        if (at < 0) return "";
        int i = at + needle.Length;
        while (i < json.Length && (json[i] == ' ' || json[i] == '\t' || json[i] == '\r' || json[i] == '\n')) i++;
        if (i >= json.Length || json[i] != ':') return "";
        i++;
        while (i < json.Length && (json[i] == ' ' || json[i] == '\t' || json[i] == '\r' || json[i] == '\n')) i++;
        if (i >= json.Length || json[i] != '"') return "";
        i++;
        StringBuilder sb = new StringBuilder(64);
        while (i < json.Length && json[i] != '"')
        {
            if (json[i] == '\\' && i + 1 < json.Length)
            {
                i++;
                char esc = json[i];
                if (esc == 'n') sb.Append('\n');
                else if (esc == 't') sb.Append('\t');
                else if (esc == 'u' && i + 4 < json.Length)
                {
                    int code;
                    if (int.TryParse(json.Substring(i + 1, 4), System.Globalization.NumberStyles.HexNumber,
                        System.Globalization.CultureInfo.InvariantCulture, out code)) sb.Append((char)code);
                    i += 4;
                }
                else sb.Append(esc);
            }
            else sb.Append(json[i]);
            i++;
            if (sb.Length > 400) break;
        }
        return sb.ToString();
    }

    static string ExamSafeNameToken(string raw, string fallback)
    {
        if (raw == null) raw = "";
        StringBuilder sb = new StringBuilder(raw.Length);
        foreach (char c in raw.Trim())
        {
            if (char.IsControl(c)) continue;
            if ("\\/:*?\"<>|".IndexOf(c) >= 0) { sb.Append('_'); continue; }
            sb.Append(c);
            if (sb.Length >= 40) break;
        }
        string cleaned = sb.ToString().Trim().TrimEnd('.');
        return cleaned.Length > 0 ? cleaned : fallback;
    }

    static void ExamReceiveHandle(TcpClient client)
    {
        string ip = "?";
        try
        {
            IPEndPoint remote = client.Client.RemoteEndPoint as IPEndPoint;
            if (remote != null) ip = remote.Address.ToString();
        }
        catch { }
        try
        {
            using (client)
            using (NetworkStream stream = client.GetStream())
            {
                client.ReceiveTimeout = 15000;
                client.SendTimeout = 15000;
                List<byte> head = new List<byte>(1024);
                bool complete = false;
                int b;
                while ((b = stream.ReadByte()) != -1)
                {
                    head.Add((byte)b);
                    int n = head.Count;
                    if (n >= 4 && head[n - 4] == 13 && head[n - 3] == 10 && head[n - 2] == 13 && head[n - 1] == 10) { complete = true; break; }
                    if (n > MaxHttpHeaderBytes) { ExamReceiveWrite(stream, "431 Request Header Fields Too Large", "{\"ok\":false}"); return; }
                }
                if (!complete) { ExamReceiveWrite(stream, "400 Bad Request", "{\"ok\":false}"); return; }

                string headerText = Encoding.ASCII.GetString(head.ToArray());
                string[] lines = headerText.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                string[] rp = (lines.Length > 0 ? lines[0] : "").Split(' ');
                string method = rp.Length > 0 ? rp[0] : "";
                string rawPath = rp.Length > 1 ? rp[1] : "/";
                string path = rawPath;
                string query = "";
                int q = rawPath.IndexOf('?');
                if (q >= 0) { path = rawPath.Substring(0, q); query = rawPath.Substring(q + 1); }

                int contentLength = 0;
                string code = "";
                for (int i = 1; i < lines.Length; i++)
                {
                    int c = lines[i].IndexOf(':');
                    if (c <= 0) continue;
                    string key = lines[i].Substring(0, c).Trim();
                    string val = lines[i].Substring(c + 1).Trim();
                    if (key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) int.TryParse(val, out contentLength);
                    else if (key.Equals("X-Exam-Code", StringComparison.OrdinalIgnoreCase)) code = val;
                }

                if (method == "OPTIONS")
                {
                    // 학생 앱은 127.0.0.1 오리진이라 크로스 오리진 + 사설망 사전 요청이 먼저 온다.
                    string preflight =
                        "HTTP/1.1 204 No Content\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                        "Access-Control-Allow-Headers: *\r\n" +
                        "Access-Control-Allow-Private-Network: true\r\n" +
                        "Access-Control-Max-Age: 600\r\n" +
                        "Content-Length: 0\r\n" +
                        "Connection: close\r\n" +
                        "\r\n";
                    byte[] pre = Encoding.ASCII.GetBytes(preflight);
                    stream.Write(pre, 0, pre.Length);
                    return;
                }

                bool open;
                string wantCode, wantExamId, title;
                int total;
                lock (ExamReceiveLock)
                {
                    open = ExamReceiveListener != null;
                    wantCode = ExamReceiveCode;
                    wantExamId = ExamReceiveExamId;
                    title = ExamReceiveTitle;
                    total = ExamReceiveItems.Count;
                }
                if (!open) { ExamReceiveWrite(stream, "409 Conflict", "{\"ok\":false,\"error\":\"closed\"}"); return; }
                if (!ExamReceiveRateOk(ip)) { ExamReceiveWrite(stream, "429 Too Many Requests", "{\"ok\":false,\"error\":\"too-many\"}"); return; }

                if (query.IndexOf("code=", StringComparison.Ordinal) >= 0 && code.Length == 0)
                {
                    foreach (string part in query.Split('&'))
                    {
                        if (part.StartsWith("code=", StringComparison.Ordinal)) code = Uri.UnescapeDataString(part.Substring(5));
                    }
                }
                if (code != wantCode) { ExamReceiveWrite(stream, "403 Forbidden", "{\"ok\":false,\"error\":\"bad-code\"}"); return; }

                if (method == "GET" && path == "/exam-hello")
                {
                    ExamReceiveWrite(stream, "200 OK", "{\"ok\":true,\"title\":" + JsonString(title) + ",\"total\":" + total + "}");
                    return;
                }
                if (method != "POST" || path != "/exam-submit")
                {
                    ExamReceiveWrite(stream, "404 Not Found", "{\"ok\":false,\"error\":\"unknown\"}");
                    return;
                }
                if (contentLength <= 0 || contentLength > ExamReceiveMaxBodyBytes)
                {
                    ExamReceiveWrite(stream, "413 Payload Too Large", "{\"ok\":false,\"error\":\"too-large\"}");
                    return;
                }

                byte[] body = new byte[contentLength];
                int read = 0;
                while (read < contentLength)
                {
                    int got = stream.Read(body, read, contentLength - read);
                    if (got <= 0) break;
                    read += got;
                }
                if (read != contentLength) { ExamReceiveWrite(stream, "400 Bad Request", "{\"ok\":false,\"error\":\"incomplete\"}"); return; }

                string json = Encoding.UTF8.GetString(body).Trim();
                if (!json.StartsWith("{", StringComparison.Ordinal) || !json.EndsWith("}", StringComparison.Ordinal)
                    || ExamJsonString(json, "format") != "classdock-exam-result")
                {
                    ExamReceiveWrite(stream, "400 Bad Request", "{\"ok\":false,\"error\":\"bad-format\"}");
                    return;
                }
                string examId = ExamJsonString(json, "examId");
                string student = ExamJsonString(json, "student");
                string examTitle = ExamJsonString(json, "examTitle");
                if (student.Length == 0) { ExamReceiveWrite(stream, "400 Bad Request", "{\"ok\":false,\"error\":\"no-student\"}"); return; }
                if (wantExamId.Length > 0 && examId != wantExamId)
                {
                    ExamReceiveWrite(stream, "409 Conflict", "{\"ok\":false,\"error\":\"other-exam\"}");
                    return;
                }

                string fingerprint;
                using (SHA256 sha = SHA256.Create()) fingerprint = BitConverter.ToString(sha.ComputeHash(body)).Replace("-", "");

                lock (ExamReceiveLock)
                {
                    ExamReceiveLastActivity = DateTime.UtcNow;
                    // 저장은 됐는데 응답이 유실되면 학생 화면엔 실패로 보인다. 다시 눌렀을 때 오류를 내면
                    // "낸 건가 안 낸 건가"가 되므로, 같은 제출본은 조용히 접수 완료로 답한다.
                    if (ExamReceiveSeen.Contains(fingerprint))
                    {
                        ExamReceiveWrite(stream, "200 OK", "{\"ok\":true,\"duplicate\":true,\"receipt\":" + JsonString(fingerprint.Substring(0, 8)) + "}");
                        return;
                    }
                    if (ExamReceiveItems.Count >= ExamReceiveMaxItems)
                    {
                        ExamReceiveWrite(stream, "507 Insufficient Storage", "{\"ok\":false,\"error\":\"full\"}");
                        return;
                    }
                }

                // 파일이 곧 진실이다 — 앱이 죽어도 남고, 파일로 받은 제출과 같은 물건이 된다.
                string folder = "제출함/" + ExamSafeNameToken(examTitle.Length > 0 ? examTitle : title, "시험지");
                string stamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
                string rel = folder + "/" + ExamSafeNameToken(student, "학생") + "_" + stamp + ".examdone";
                string full;
                bool saved = false;
                if (TryResolveSaveRootPath(rel, out full))
                {
                    try
                    {
                        string dir = Path.GetDirectoryName(full);
                        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                        File.WriteAllBytes(full, body);
                        saved = true;
                    }
                    catch { }
                }
                if (!saved)
                {
                    // 학생 화면이 로컬 .examdone 파일로 폴백할 수 있도록 성공으로 접수하지 않는다.
                    ExamReceiveWrite(stream, "500 Internal Server Error", "{\"ok\":false,\"error\":\"save-failed\"}");
                    return;
                }

                lock (ExamReceiveLock)
                {
                    ExamReceiveSeen.Add(fingerprint);
                    ExamReceiveItems.Add(json);
                }
                ExamReceiveWrite(stream, "200 OK", "{\"ok\":true,\"receipt\":" + JsonString(fingerprint.Substring(0, 8)) + "}");
            }
        }
        catch { /* 끊긴 연결은 조용히 버린다 */ }
    }
}

class PowerPointMissingException : Exception { }
class PythonMissingException : Exception { }
class FfmpegMissingException : Exception { }
class DbMismatchException : Exception { }
