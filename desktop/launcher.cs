using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

class PdfSignerLauncher
{
    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int dwProcessId);
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

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

    static readonly string LocalAuthToken = CreateLocalAuthToken();
    static readonly byte[] Page = InjectLocalAuthToken(ReadResource("app.html"));
    static readonly byte[] PythonKernelRunner = ReadResource("python_kernel.py");
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
        "PdfSigner", "workspace.bin");
    // 브라우저 origin(포트) 변경과 무관하게 유지할 설정 저장소(localStorage 스냅샷 JSON).
    // 런처가 다른 포트로 떠도 테마·자동복원·탭 순서 등이 초기화되지 않도록 서버측 원본으로 삼는다.
    static readonly string AppStatePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PdfSigner", "app-state.json");
    static readonly object AppStateLock = new object();
    const int AppStateMaxBytes = 8 * 1024 * 1024;
    const int MaxHttpHeaderBytes = 64 * 1024;
    const int MaxHttpRequestBodyBytes = 510 * 1024 * 1024;
    // 일반적인 수업용 데이터 분석은 허용하면서, 실수로 큰 배열을 반복 생성해 PC 전체가 멈추는 일을 줄인다.
    const long PythonProcessMemoryLimitBytes = 4096L * 1024 * 1024;
    // 직전 인스턴스가 실제로 바인딩한 포트. 다음 실행이 후보 포트 전체를 HTTP 로 뒤지지 않고 이 한 곳만 확인해
    // 단일 인스턴스 여부를 빠르게 판단하도록 기록한다(기동 지연 방지).
    static readonly string InstancePortPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PdfSigner", "instance-port.txt");
    // 편집한 코드를 브라우저 권한 팝업 없이 바로 저장하는 폴더. 사용자가 바꾸지 않으면 내 문서\만능교실 저장.
    static readonly string DefaultSaveRoot = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        "만능교실 저장");
    static readonly string SaveRootConfigPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PdfSigner", "save-root.txt");
    static readonly object SaveRootLock = new object();
    static string SaveRoot = LoadSaveRoot();
    static readonly object ImageMemoLock = new object();
    static readonly object SaveRootPickerLock = new object();
    static string SaveRootPickerState = "idle";
    static string SaveRootPickerResult = "";
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
        static readonly string[] Markers = { "__MANNEUNG_DIAG__", "__MANNEUNG_GRADE__", "__MANNEUNG_TRACE__" };
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
    }

    static readonly object PySessionsLock = new object();
    static readonly Dictionary<string, PythonSession> PySessions = new Dictionary<string, PythonSession>();

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
        string tokenScript = "<script>window.__MANNEUNG_LOCAL_TOKEN__=" + JsonString(LocalAuthToken) + ";</script>\n";
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
            "  $folder = $shell.BrowseForFolder(0, '만능파일교실에서 파일을 자동 저장할 폴더를 선택하세요.', 81, 0)\n" +
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

    static bool HasLocalActionHeader(Dictionary<string, string> headers)
    {
        string value;
        return headers != null && headers.TryGetValue("X-PdfSigner-Action", out value) && value == "1";
    }

    static bool HasImageMemoHeader(Dictionary<string, string> headers)
    {
        string value;
        return headers != null && headers.TryGetValue("X-PdfSigner-Image-Memo", out value) && value == "1";
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
        if (headers != null && headers.TryGetValue("X-Manneung-Token", out value) && TokenEquals(value)) return true;
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
            if (path == "/sqlite-preview" || path == "/save-file") return true;
            if (path == "/open-save-folder" || path == "/open-file-folder" || path == "/choose-save-folder") return true;
            if (path == "/image-memo-delete") return true;
            if (path == "/complete" || path == "/definition" || path == "/pip-install") return true;
            if (path.StartsWith("/heartbeat", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/python-kernel-", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/python-session-", StringComparison.Ordinal)) return true;
            if (path == "/run-python" || path == "/run-python-bundle") return true;
        }
        if (method == "GET")
        {
            if (path == "/workspace-load") return true;
            if (path == "/save-root" || path == "/choose-save-folder-status") return true;
            if (path == "/image-memo-list" || path.StartsWith("/image-memo-file?", StringComparison.Ordinal)) return true;
            if (path == "/can-complete") return true;
            if (path.StartsWith("/local-file?", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/python-kernel-file?", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/python-session-poll", StringComparison.Ordinal)) return true;
            if (path.StartsWith("/python-session-file", StringComparison.Ordinal)) return true;
        }
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

    static void Main()
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
            if (Environment.GetEnvironmentVariable("PDFSIGNER_NO_BROWSER") != "1")
            {
                try { Process.Start("http://127.0.0.1:" + remembered + "/"); } catch {}
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
        HeartbeatRequired = Environment.GetEnvironmentVariable("PDFSIGNER_NO_BROWSER") != "1";
        HeartbeatStartedAt = DateTime.UtcNow;

        Console.WriteLine("============================================");
        Console.WriteLine("  만능파일교실 is running");
        Console.WriteLine("============================================");
        Console.WriteLine("  URL: " + url);
        Console.WriteLine("  Close this window to stop.");
        Console.WriteLine("============================================");

        // PDFSIGNER_NO_BROWSER=1 이면 자동 브라우저 실행을 끈다(테스트/자동화용).
        if (HeartbeatRequired)
        {
            Thread browser = new Thread(delegate()
            {
                Thread.Sleep(400);
                try
                {
                    Process.Start(url);
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

                        if (HeartbeatClients.Count > 0) NoHeartbeatClientsSince = DateTime.MaxValue;
                        else if (HeartbeatSeen)
                        {
                            if (NoHeartbeatClientsSince == DateTime.MaxValue) NoHeartbeatClientsSince = now;
                            else if ((now - NoHeartbeatClientsSince).TotalSeconds >= 5) shouldExit = true;
                        }
                        else if ((now - HeartbeatStartedAt).TotalSeconds >= 45) shouldExit = true;
                    }
                    if (shouldExit) Environment.Exit(0);
                }
            });
            heartbeatWatcher.IsBackground = true;
            heartbeatWatcher.Start();
        }

        while (true)
        {
            TcpClient client = listener.AcceptTcpClient();
            Thread worker = new Thread(delegate() { HandleClient(client); });
            worker.IsBackground = true;
            worker.Start();
        }
    }

    static void HandleClient(TcpClient client)
    {
        try
        {
            using (client)
            using (NetworkStream stream = client.GetStream())
            {
                client.ReceiveTimeout = 15000;
                client.SendTimeout = 15000;
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
                        WriteResponse(stream, "431 Request Header Fields Too Large", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("request-header-too-large"));
                        return;
                    }
                }
                if (!headerComplete)
                {
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
                            WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("invalid-content-length"));
                            return;
                        }
                    }
                }

                if (rp.Length < 3 || !rp[2].StartsWith("HTTP/", StringComparison.Ordinal) || !path.StartsWith("/", StringComparison.Ordinal))
                {
                    WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("invalid-request-line"));
                    return;
                }
                if (!HasAllowedLocalHost(headers))
                {
                    WriteResponse(stream, "400 Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("invalid-local-host"));
                    return;
                }
                // 지도 스냅샷의 sandbox iframe은 Origin: null로 /tile-proxy만 호출한다.
                // 해당 프록시는 별도 목적지 allowlist로 보호하므로 이 경로만 예외로 둔다.
                if (!HasAllowedLocalOrigin(headers) && !path.StartsWith("/tile-proxy", StringComparison.Ordinal))
                {
                    WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("invalid-local-origin"));
                    return;
                }
                if (contentLength > MaxHttpRequestBodyBytes)
                {
                    WriteResponse(stream, "413 Payload Too Large", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("request-body-too-large"));
                    return;
                }
                // 인증 실패 요청은 본문을 읽지 않는다. 큰 무단 요청으로 메모리·I/O를 점유하는 것을 막는다.
                if (RequiresLocalAuthToken(method, path) && !HasLocalAuthToken(headers))
                {
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
                    if (read != contentLength) body = new byte[0];
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
                        "Connection: close\r\n" +
                        "\r\n";
                    byte[] preflightBytes = Encoding.ASCII.GetBytes(preflight);
                    stream.Write(preflightBytes, 0, preflightBytes.Length);
                }
                else if (method == "POST" && path.StartsWith("/workspace-save", StringComparison.Ordinal))
                {
                    if (!headers.ContainsKey("X-PdfSigner-Workspace"))
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
                    if (!headers.ContainsKey("X-PdfSigner-Workspace"))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("workspace-header-required"));
                        return;
                    }
                    ClearWorkspace();
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "POST" && path == "/workspace-remove")
                {
                    if (!headers.ContainsKey("X-PdfSigner-Workspace"))
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
                    if (!headers.ContainsKey("X-PdfSigner-Heartbeat"))
                    {
                        WriteResponse(stream, "403 Forbidden", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("heartbeat-header-required"));
                        return;
                    }
                    TouchHeartbeatClient(QueryValue(path, "id"));
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("ok"));
                }
                else if (method == "POST" && path.StartsWith("/heartbeat-close?", StringComparison.Ordinal))
                {
                    if (!headers.ContainsKey("X-PdfSigner-Heartbeat"))
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
                else if (path == "/can-save-file")
                {
                    // exe 로컬 서버가 디스크 저장을 지원함을 알린다(앱이 브라우저 권한 팝업 대신 서버 저장 선택)
                    WriteResponse(stream, "200 OK", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("yes"));
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
                else if (method == "POST" && path == "/pip-install")
                {
                    string pipConfirmed;
                    if (!headers.TryGetValue("x-manneung-pip-confirm", out pipConfirmed) || pipConfirmed != "1")
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
                else if (method == "GET" && path.StartsWith("/tile-proxy?", StringComparison.Ordinal))
                {
                    // 노트북 PDF 지도 스냅샷용 — sandbox iframe 의 fetch 가 차단되는 타일을 서버가 대신 받아온다
                    byte[] tileData; string tileMime;
                    if (TryProxyMapTile(QueryValue(path, "u"), out tileData, out tileMime))
                        WriteCorsResponse(stream, "200 OK", tileMime, tileData);
                    else
                        WriteCorsResponse(stream, "502 Bad Gateway", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("tile-proxy-failed"));
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
        catch { /* 연결 오류는 무시 */ }
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
                return resp.Headers["X-App"] == "manneung-classroom";
            }
        }
        catch { return false; }
    }

    static void WriteResponse(Stream stream, string status, string contentType, byte[] body)
    {
        string header =
            "HTTP/1.1 " + status + "\r\n" +
            "Content-Type: " + contentType + "\r\n" +
            "Content-Length: " + body.Length + "\r\n" +
            "Cache-Control: no-store\r\n" +
            "X-Content-Type-Options: nosniff\r\n" +
            "Referrer-Policy: no-referrer\r\n" +
            "X-App: manneung-classroom\r\n" +      // 우리 서버 식별용(중복 실행 시 단일 인스턴스 판별)
            "Connection: close\r\n" +
            "\r\n";
        byte[] headerBytes = Encoding.ASCII.GetBytes(header);
        stream.Write(headerBytes, 0, headerBytes.Length);
        stream.Write(body, 0, body.Length);
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
            "X-App: manneung-classroom\r\n" +
            "Connection: close\r\n" +
            "\r\n";
        byte[] headerBytes = Encoding.ASCII.GetBytes(header);
        stream.Write(headerBytes, 0, headerBytes.Length);
        stream.Write(body, 0, body.Length);
    }

    /* ===== 지도 타일 프록시 (노트북 PDF 의 지도 스냅샷 전용) =====
       캡처 라이브러리는 타일 이미지를 fetch 로 다시 받아 인라인하는데, sandbox iframe 의 fetch 는
       Origin: null 로 나가 OSM 정책에 차단된다(화면의 <img> 요청은 통과). 캡처 순간에만 타일 주소를
       이 프록시로 바꿔, 서버가 올바른 User-Agent 로 대신 받아온다. SSRF 방지를 위해 https + 알려진
       타일 호스트만 허용하고, 같은 타일 반복 요청은 짧게 캐시한다. */
    static readonly string[] TileProxyHosts = {
        "tile.openstreetmap.org", "basemaps.cartocdn.com", "tile.opentopomap.org",
        "server.arcgisonline.com", "tiles.stadiamaps.com", "tile.thunderforest.com"
    };
    static readonly object TileCacheLock = new object();
    static readonly Dictionary<string, byte[]> TileCache = new Dictionary<string, byte[]>();
    static bool TileTlsReady;
    static bool TryProxyMapTile(string url, out byte[] data, out string mime)
    {
        data = null; mime = "image/png";
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
            lock (TileCacheLock) if (TileCache.TryGetValue(url, out data)) return true;
            if (!TileTlsReady)
            {
                try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { }
                TileTlsReady = true;
            }
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(uri);
            request.UserAgent = "ManneungClassroom/1.0 (local classroom app; PDF export)";
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
                    if (total > 2 * 1024 * 1024) return false;   // 타일치고 비정상적으로 크면 중단
                    buffer.Write(chunk, 0, read);
                }
                if (!string.IsNullOrEmpty(response.ContentType)) mime = response.ContentType;
                data = buffer.ToArray();
            }
            lock (TileCacheLock)
            {
                if (TileCache.Count > 500) TileCache.Clear();   // 단순 상한 — 지도 몇 장 분량이면 충분
                TileCache[url] = data;
            }
            return true;
        }
        catch { data = null; return false; }
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
            psi.EnvironmentVariables["MANNEUNG_KERNEL_ROOT"] = tempRoot;

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
            if (!reader.Join(30 * 60 * 1000))
            {
                KillProcessTree(kernel.Process);
                throw new Exception("kernel-timeout");
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
            if (info.Length > 20 * 1024 * 1024) return false;
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

    static void KillProcessTree(Process process)
    {
        if (process == null) return;
        try { if (process.HasExited) return; } catch { return; }
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo("taskkill", "/PID " + process.Id + " /T /F");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process killer = Process.Start(psi);
            if (killer != null) killer.WaitForExit(5000);
        }
        catch { }
        try { if (!process.HasExited) process.Kill(); } catch { }
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
            "sys.argv[0] = os.environ['PDFSIGNER_SCRIPT']\n" +
            "_ps_script_dir = os.path.dirname(os.environ['PDFSIGNER_SCRIPT'])\n" +
            "_ps_project_root = os.environ.get('PDFSIGNER_PROJECT_ROOT', '')\n" +
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
            "    _ps_vars = runpy.run_path(os.environ['PDFSIGNER_SCRIPT'], run_name='__main__')\n" +
            "finally:\n" +
            "    try:\n" +
            "        import matplotlib.pyplot as _ps_plt\n" +
            "        for _ps_i, _ps_n in enumerate(_ps_plt.get_fignums()[:8]):\n" +
            "            _ps_plt.figure(_ps_n).savefig(os.path.join(os.environ['PDFSIGNER_PLOT_DIR'], 'plot_%02d.png' % _ps_i), bbox_inches='tight')\n" +
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
            "        with open(os.path.join(os.environ['PDFSIGNER_PLOT_DIR'], 'variables.json'), 'w', encoding='utf-8') as _ps_file:\n" +
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
        psi.EnvironmentVariables["PDFSIGNER_SCRIPT"] = scriptPath;
        psi.EnvironmentVariables["PDFSIGNER_PROJECT_ROOT"] = tempRoot;
        psi.EnvironmentVariables["PDFSIGNER_PLOT_DIR"] = session.PlotDir;

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
                     + ",\"images\":" + session.ImagesJson
                     + ",\"variables\":" + session.VariablesJson
                     + ",\"outputs\":" + session.OutputsJson + "}";
            return "{\"complete\":" + (session.Complete ? "true" : "false")
                 + ",\"code\":" + session.ExitCode
                 + ",\"stdout\":" + JsonString(session.Stdout.GetText())
                 + ",\"stderr\":" + JsonString(session.Stderr.GetText())
                 + ",\"images\":" + session.ImagesJson
                 + ",\"variables\":" + session.VariablesJson
                 + ",\"outputs\":" + session.OutputsJson + "}";
        }
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
            session.Stdout.AppendLine(input ?? "");
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
            // Windows 런처 'py' 우선(버전 선택 처리), 그다음 python / python3
            string[] cands = { "py", "python", "python3" };
            foreach (string c in cands)
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(c, "--version");
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    psi.RedirectStandardOutput = true;
                    psi.RedirectStandardError = true;
                    Process p = Process.Start(psi);
                    if (p == null) continue;
                    p.StandardOutput.ReadToEnd();
                    p.StandardError.ReadToEnd();
                    if (!p.WaitForExit(5000)) { try { p.Kill(); } catch { } continue; }
                    if (p.ExitCode == 0) { _pythonCmd = c; break; }
                }
                catch { /* 해당 후보 없음 → 다음 */ }
            }
            return _pythonCmd;
        }
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
                "    for name, kind, sql in masters[:60]:\n" +
                "        item = {'name': name, 'type': kind, 'sql': (sql or '')[:4000], 'columns': [], 'rows': [], 'rowCount': None}\n" +
                "        try:\n" +
                "            info = con.execute('PRAGMA table_info(' + qid(name) + ')').fetchall()\n" +
                "            item['columns'] = [{'name': r[1], 'type': r[2] or '', 'notnull': bool(r[3]), 'default': r[4], 'pk': int(r[5] or 0)} for r in info[:80]]\n" +
                "            item['rowCount'] = int(con.execute('SELECT COUNT(*) FROM ' + qid(name)).fetchone()[0])\n" +
                "            cur = con.execute('SELECT * FROM ' + qid(name) + ' LIMIT 200')\n" +
                "            item['displayColumns'] = [d[0] for d in (cur.description or [])[:80]]\n" +
                "            item['rows'] = [[cell(v) for v in row[:80]] for row in cur.fetchall()]\n" +
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
            ProcessStartInfo psi = new ProcessStartInfo(interp, args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = new UTF8Encoding(false);
            psi.StandardErrorEncoding = new UTF8Encoding(false);
            psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            Process proc = Process.Start(psi);
            if (proc == null) throw new Exception("sqlite-preview-spawn-failed");
            string stdout = proc.StandardOutput.ReadToEnd();
            string stderr = proc.StandardError.ReadToEnd();
            if (!proc.WaitForExit(30000))
            {
                try { proc.Kill(); } catch { }
                throw new Exception("sqlite-preview-timeout");
            }
            if (proc.ExitCode != 0) throw new Exception(string.IsNullOrWhiteSpace(stderr) ? "sqlite-preview-failed" : stderr.Trim());
            if (stdout.Length > 12 * 1024 * 1024) throw new Exception("sqlite-preview-result-too-large");
            return stdout.Trim();
        }
        finally
        {
            try { Directory.Delete(tempDir, true); } catch { }
        }
    }

    static readonly System.Text.RegularExpressions.Regex PkgNameRe =
        new System.Text.RegularExpressions.Regex(@"^[A-Za-z0-9][A-Za-z0-9._-]*([=<>!~]=?[A-Za-z0-9._*-]+)?$");

    static string PipInstall(byte[] body)
    {
        string interp = FindPython();
        if (interp == null) throw new PythonMissingException();

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
    static readonly object JediLock = new object();
    static bool? _jediReady = null;
    static string _jediRunnerPath = null;

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
                "import sys, json\n" +
                "data = json.load(sys.stdin)\n" +
                "mode = data.get('mode', 'complete')\n" +
                "try:\n" +
                "    import jedi\n" +
                "except Exception:\n" +
                "    print(json.dumps({'ok': False, 'reason': 'no-jedi'})); sys.exit(0)\n" +
                "src = data.get('source','')\n" +
                "line = int(data.get('line', 1)); col = int(data.get('column', 0))\n" +
                "try:\n" +
                "    script = jedi.Script(code=src)\n" +
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
                "                print(json.dumps({'ok': True, 'path': str(p), 'line': getattr(d, 'line', 1) or 1, 'column': getattr(d, 'column', 0) or 0, 'name': getattr(d, 'name', '') or '', 'type': getattr(d, 'type', '') or ''})); sys.exit(0)\n" +
                "        print(json.dumps({'ok': False, 'reason': 'builtin'})); sys.exit(0)\n" +
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
            "sys.argv[0] = os.environ['PDFSIGNER_SCRIPT']\n" +
            "_ps_script_dir = os.path.dirname(os.environ['PDFSIGNER_SCRIPT'])\n" +
            "_ps_project_root = os.environ.get('PDFSIGNER_PROJECT_ROOT', '')\n" +
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
            "    runpy.run_path(os.environ['PDFSIGNER_SCRIPT'], run_name='__main__')\n" +
            "finally:\n" +
            "    try:\n" +
            "        import matplotlib.pyplot as _ps_plt\n" +
            "        for _ps_i, _ps_n in enumerate(_ps_plt.get_fignums()[:8]):\n" +
            "            _ps_plt.figure(_ps_n).savefig(os.path.join(os.environ['PDFSIGNER_PLOT_DIR'], 'plot_%02d.png' % _ps_i), bbox_inches='tight')\n" +
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
        psi.EnvironmentVariables["PDFSIGNER_SCRIPT"] = scriptPath;
        psi.EnvironmentVariables["PDFSIGNER_PROJECT_ROOT"] = string.IsNullOrEmpty(projectRoot) ? workDir : projectRoot;
        psi.EnvironmentVariables["PDFSIGNER_PLOT_DIR"] = plotDir;

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
}

class PowerPointMissingException : Exception { }
class PythonMissingException : Exception { }
class FfmpegMissingException : Exception { }
