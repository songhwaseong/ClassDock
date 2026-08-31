using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

// Read-only SFTP v3 over a separate, non-PTY OpenSSH process. No remote shell commands.
static partial class ClassDockSshTerminal
{
    const long FileCacheLimit = 100L * 1024 * 1024;
    static readonly object FileGate = new object();
    static readonly Dictionary<string, FilePeer> FilePeers = new Dictionary<string, FilePeer>();
    static readonly Dictionary<string, RemoteFile> RemoteFiles = new Dictionary<string, RemoteFile>();
    static readonly Dictionary<string, FileJob> FileJobs = new Dictionary<string, FileJob>();
    static readonly string FileCacheDirectory = Path.Combine(SshDataDirectory, "previews");
    static readonly string FileJournalDirectory = Path.Combine(SshDataDirectory, "partial-downloads");
    static readonly HashSet<string> FileDeleteQueue = new HashSet<string>();
    static Timer FileTimer;
    static bool FilePickerOpen;
    static long FileCacheBytes;
    static bool FilesShuttingDown;

    sealed class FilePeer
    {
        public string Id, SessionId, KeyPath;
        public Process Process;
        public SftpReader Reader;
        public bool Busy, Closed;
        public DateTime LastUsed = DateTime.UtcNow, LastIo = DateTime.UtcNow;
        public ManualResetEvent AuthDone = new ManualResetEvent(false);
        public string Diagnostic = "";
    }
    sealed class FileAttributes
    {
        public long Size;
        public uint Modified, Mode;
        public bool Same(FileAttributes other) { return other != null && Size == other.Size && Modified == other.Modified && Mode == other.Mode; }
    }
    sealed class RemoteFile
    {
        public string Id, PeerId, Path;
        public FileAttributes Attributes;
        public DateTime LastUsed = DateTime.UtcNow;
    }
    sealed class FileJob
    {
        public string Id, Op, Signature, PeerId, FileId, State = "waiting", Error = "", Kind = "", CachePath;
        public string Destination, PartialPath, JournalPath;
        public long Bytes, Total, Reserved;
        public bool Done, Cancelled, Partial, DestinationExisted, Committing, Released;
        public long DestinationSize;
        public DateTime DestinationWrite, LastSeen = DateTime.UtcNow, Created = DateTime.UtcNow;
    }

    // All numeric fields in SFTP are network byte order, unlike the UI's length-prefixed bundle.
    sealed class SftpPacket
    {
        readonly MemoryStream data;
        public SftpPacket() { data = new MemoryStream(); }
        public SftpPacket(byte[] bytes) { data = new MemoryStream(bytes, false); }
        public long Remaining { get { return data.Length - data.Position; } }
        public void Byte(byte value) { data.WriteByte(value); }
        public byte Byte() { int b = data.ReadByte(); if (b < 0) throw FileError("protocol"); return (byte)b; }
        public void UInt(uint value) { Byte((byte)(value >> 24)); Byte((byte)(value >> 16)); Byte((byte)(value >> 8)); Byte((byte)value); }
        public uint UInt() { return ((uint)Byte() << 24) | ((uint)Byte() << 16) | ((uint)Byte() << 8) | Byte(); }
        public void Long(long value) { if (value < 0) throw FileError("protocol"); UInt((uint)((ulong)value >> 32)); UInt((uint)value); }
        public long Long() { ulong value = ((ulong)UInt() << 32) | UInt(); if (value > long.MaxValue) throw FileError("size"); return (long)value; }
        public void Bytes(byte[] value) { UInt((uint)value.Length); data.Write(value, 0, value.Length); }
        public byte[] Bytes() { uint count = UInt(); if (count > 1024 * 1024 || count > Remaining) throw FileError("protocol"); return ReadExactly(data, (int)count); }
        public void Text(string value) { Bytes(Encoding.UTF8.GetBytes(value)); }
        public string Text() { return new UTF8Encoding(false, true).GetString(Bytes()); }
        public byte[] Array() { return data.ToArray(); }
    }

    sealed class SftpReader
    {
        readonly Stream input, output;
        readonly Action touch;
        uint sequence;
        public SftpReader(Stream inputStream, Stream outputStream, Action onIo) { input = inputStream; output = outputStream; touch = onIo; }
        void Send(SftpPacket packet)
        {
            byte[] bytes = packet.Array(); SftpPacket header = new SftpPacket(); header.UInt((uint)bytes.Length);
            byte[] head = header.Array(); input.Write(head, 0, head.Length); input.Write(bytes, 0, bytes.Length); input.Flush();
        }
        SftpPacket Receive()
        {
            uint size = new SftpPacket(ReadExactly(output, 4)).UInt();
            if (size < 1 || size > 1024 * 1024) throw FileError("protocol");
            SftpPacket packet = new SftpPacket(ReadExactly(output, (int)size)); touch(); return packet;
        }
        public void Initialize()
        {
            SftpPacket init = new SftpPacket(); init.Byte(1); init.UInt(3); Send(init);
            SftpPacket answer = Receive(); if (answer.Byte() != 2 || answer.UInt() != 3) throw FileError("sftp-unavailable");
        }
        SftpPacket Request(byte type, Action<SftpPacket> fill, byte expected, bool eof)
        {
            uint id = ++sequence;
            SftpPacket packet = new SftpPacket(); packet.Byte(type); packet.UInt(id); fill(packet); Send(packet);
            SftpPacket reply = Receive(); byte kind = reply.Byte();
            if (reply.UInt() != id) throw FileError("protocol");
            if (kind == 101)
            {
                uint status = reply.UInt();
                if (status == 1 && eof) return null;
                if (status == 0 && expected == 101) return reply;
                throw FileError(status == 2 ? "not-found" : status == 3 ? "permission" : status == 8 ? "sftp-unavailable" : "remote-failure");
            }
            if (kind != expected) throw FileError("protocol");
            return reply;
        }
        public string RealPath(string path)
        {
            SftpPacket reply = Request(16, delegate(SftpPacket p) { p.Text(path); }, 104, false);
            if (reply.UInt() != 1) throw FileError("protocol");
            return ValidateRemoteFilePath(reply.Text());
        }
        static FileAttributes Attributes(SftpPacket p)
        {
            uint flags = p.UInt(); FileAttributes a = new FileAttributes();
            if ((flags & 1) != 0) a.Size = p.Long();
            if ((flags & 2) != 0) { p.UInt(); p.UInt(); }
            if ((flags & 4) != 0) a.Mode = p.UInt();
            if ((flags & 8) != 0) { p.UInt(); a.Modified = p.UInt(); }
            if ((flags & 13) != 13) throw FileError("attributes-unavailable");
            if ((a.Mode & 0xf000) != 0x8000) throw FileError("not-regular");
            return a;
        }
        public FileAttributes Stat(string path) { return Attributes(Request(17, delegate(SftpPacket p) { p.Text(path); }, 105, false)); }
        public FileAttributes Stat(byte[] handle) { return Attributes(Request(8, delegate(SftpPacket p) { p.Bytes(handle); }, 105, false)); }
        public byte[] Open(string path)
        {
            SftpPacket p = Request(3, delegate(SftpPacket q) { q.Text(path); q.UInt(1); q.UInt(0); }, 102, false);
            byte[] handle = p.Bytes(); if (handle.Length == 0 || handle.Length > 256) throw FileError("protocol"); return handle;
        }
        public byte[] Read(byte[] handle, long offset, int count)
        {
            SftpPacket p = Request(5, delegate(SftpPacket q) { q.Bytes(handle); q.Long(offset); q.UInt((uint)count); }, 103, true);
            if (p == null) return null;
            byte[] bytes = p.Bytes(); if (bytes.Length == 0 || bytes.Length > count) throw FileError("protocol"); return bytes;
        }
        public void Close(byte[] handle) { Request(4, delegate(SftpPacket p) { p.Bytes(handle); }, 101, false); }
    }

    static InvalidOperationException FileError(string code) { return new InvalidOperationException("ssh-file-" + code); }
    static string ValidateRemoteFilePath(string value)
    {
        if (string.IsNullOrEmpty(value) || !value.StartsWith("/", StringComparison.Ordinal) || value.Length > 4096) throw FileError("path");
        foreach (char c in value) if (char.IsControl(c)) throw FileError("path");
        return value;
    }
    static void EnsureFileManager()
    {
        lock (FileGate)
        {
            if (FilesShuttingDown) throw FileError("closed");
            if (FileTimer != null) return;
            Directory.CreateDirectory(FileCacheDirectory); ApplyOwnerOnlyAcl(FileCacheDirectory, true);
            Directory.CreateDirectory(FileJournalDirectory); ApplyOwnerOnlyAcl(FileJournalDirectory, true);
            // Only files generated by this feature are eligible for cleanup; never recurse.
            foreach (string path in Directory.GetFiles(FileCacheDirectory, "*.preview"))
                if (Regex.IsMatch(Path.GetFileName(path), "^[a-f0-9]{32}\\.preview$")) QueueFileDelete(path);
            foreach (string record in Directory.GetFiles(FileJournalDirectory, "*.pending"))
            {
                try
                {
                    string id = Path.GetFileNameWithoutExtension(record);
                    string partial = File.ReadAllText(record, Encoding.UTF8);
                    if (Regex.IsMatch(id, "^[a-f0-9]{32}$") && Path.IsPathRooted(partial)
                        && Path.GetFileName(partial) == ".classdock-" + id + ".part")
                    { File.Delete(partial); File.Delete(record); }
                }
                catch { /* Keep the journal for the next startup. */ }
            }
            FileTimer = new Timer(delegate { SweepFiles(); }, null, 5000, 5000);
        }
    }
    static void QueueFileDelete(string path)
    {
        if (string.IsNullOrEmpty(path)) return;
        try { File.Delete(path); FileDeleteQueue.Remove(path); }
        catch { FileDeleteQueue.Add(path); }
    }
    static void DropFileCache(FileJob job)
    {
        job.Released = true;
        // A writer or content reader may still hold the file. Keep its quota until deletion succeeds.
        if (job.CachePath != null) { try { File.Delete(job.CachePath); } catch { return; } }
        job.CachePath = null;
        FileCacheBytes -= job.Reserved; job.Reserved = 0;
    }
    static void SweepFiles()
    {
        List<FilePeer> close = new List<FilePeer>();
        lock (FileGate)
        {
            DateTime now = DateTime.UtcNow;
            foreach (FilePeer peer in FilePeers.Values)
            {
                if (peer.Closed) continue;
                if ((!peer.Busy && now - peer.LastUsed > TimeSpan.FromMinutes(5))
                    || (peer.Busy && now - peer.LastIo > TimeSpan.FromSeconds(45))) close.Add(peer);
            }
            List<string> old = new List<string>();
            foreach (FileJob job in FileJobs.Values)
            {
                if (job.Released && job.Done) DropFileCache(job);
                if (!job.Done && now - job.LastSeen > TimeSpan.FromMinutes(2)) CancelFileJob(job);
                if (job.Done && now - job.LastSeen > TimeSpan.FromMinutes(10)) { DropFileCache(job); if (job.CachePath == null) old.Add(job.Id); }
            }
            foreach (string id in old) FileJobs.Remove(id);
            old.Clear();
            foreach (RemoteFile file in RemoteFiles.Values)
                if (now - file.LastUsed > TimeSpan.FromMinutes(15)) old.Add(file.Id);
            foreach (string id in old) RemoteFiles.Remove(id);
            old.Clear();
            foreach (FilePeer peer in FilePeers.Values)
                if (peer.Closed && !peer.Busy && now - peer.LastUsed > TimeSpan.FromMinutes(10)) old.Add(peer.Id);
            foreach (string id in old)
            {
                FilePeer peer = FilePeers[id];
                try { if (peer.Process != null) peer.Process.Dispose(); } catch { }
                peer.AuthDone.Dispose(); FilePeers.Remove(id);
            }
            foreach (string path in new List<string>(FileDeleteQueue)) QueueFileDelete(path);
        }
        foreach (FilePeer peer in close) CloseFilePeer(peer);
    }
    static bool FileSessionAlive(string id)
    {
        SshSession session;
        lock (SessionsLock) Sessions.TryGetValue(id ?? "", out session);
        if (session == null) return false;
        lock (session.Sync) return !session.Complete && !session.StopRequested;
    }
    static void CloseFilePeer(FilePeer peer)
    {
        Process process; string key;
        lock (FileGate)
        {
            if (peer.Closed) return;
            peer.Closed = true; peer.AuthDone.Set(); process = peer.Process; key = peer.KeyPath; peer.KeyPath = null;
        }
        try { if (process != null && !process.HasExited) process.Kill(); } catch { }
        WipeStagedPrivateKey(key);
    }
    static void StopSessionFiles(string sessionId)
    {
        List<FilePeer> close = new List<FilePeer>();
        lock (FileGate)
        {
            foreach (FilePeer peer in FilePeers.Values) if (peer.SessionId == sessionId) close.Add(peer);
            foreach (FileJob job in FileJobs.Values)
            {
                FilePeer peer;
                if (FilePeers.TryGetValue(job.PeerId ?? "", out peer) && peer.SessionId == sessionId)
                { if (!job.Done) CancelFileJob(job); DropFileCache(job); }
            }
        }
        foreach (FilePeer peer in close) CloseFilePeer(peer);
    }
    static void ShutdownFiles()
    {
        List<FilePeer> close;
        lock (FileGate)
        {
            FilesShuttingDown = true;
            if (FileTimer != null) FileTimer.Dispose();
            close = new List<FilePeer>(FilePeers.Values);
            foreach (FileJob job in FileJobs.Values) { CancelFileJob(job); DropFileCache(job); }
        }
        foreach (FilePeer peer in close) CloseFilePeer(peer);
    }

    static Thread StartFileAskPass(FilePeer peer, string pipeName, byte[] secret)
    {
        Thread worker = new Thread(delegate()
        {
            try
            {
                for (int attempt = 0; attempt < 3 && !peer.AuthDone.WaitOne(0); attempt++)
                using (NamedPipeServerStream pipe = new NamedPipeServerStream(pipeName, PipeDirection.Out, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous))
                {
                    if (!WaitForAskPassConnection(pipe, peer.AuthDone, TimeSpan.FromSeconds(45))) return;
                    byte[] size = BitConverter.GetBytes(secret.Length);
                    pipe.Write(size, 0, size.Length); pipe.Write(secret, 0, secret.Length); pipe.Flush();
                }
            }
            catch { }
            finally { Array.Clear(secret, 0, secret.Length); }
        });
        worker.IsBackground = true; worker.Start(); return worker;
    }
    static void ConnectFiles(FilePeer peer, byte[] secret)
    {
        try
        {
            SshSession session = FindSession(peer.SessionId);
            string host, user, auth, keyId; int port;
            lock (session.Sync)
            {
                if (session.Complete || session.StopRequested) throw FileError("closed");
                host = session.Host; user = session.User; port = session.Port; auth = session.Authentication; keyId = session.PrivateKeyId;
            }
            if (TrustedFingerprint(KnownHostField(host, port)).Length == 0) throw FileError("host-key");
            if (auth == "password" && secret.Length == 0) throw FileError("authentication");
            string ssh = FindOpenSsh("ssh.exe"); if (ssh == null) throw FileError("client");
            string key = auth == "private-key" ? StagePrivateKey(ResolvePrivateKey(keyId).Path) : "";
            lock (FileGate) { if (peer.Closed) { WipeStagedPrivateKey(key); throw FileError("cancelled"); } peer.KeyPath = key; }
            // Reuse authentication options, remove terminal allocation, and request only the SFTP subsystem.
            string arguments = BuildSshArguments(host, port, user, auth, key).Replace(QuoteArgument("-tt") + " ", "");
            arguments = QuoteArgument("-T") + " " + QuoteArgument("-s") + " " + arguments + " " + QuoteArgument("sftp");
            string pipe = "classdock_sftp_askpass_" + Guid.NewGuid().ToString("N");
            ProcessStartInfo info = new ProcessStartInfo(ssh, arguments);
            info.UseShellExecute = false; info.CreateNoWindow = true; info.RedirectStandardInput = true;
            info.RedirectStandardOutput = true; info.RedirectStandardError = true;
            info.EnvironmentVariables["SSH_ASKPASS"] = Process.GetCurrentProcess().MainModule.FileName;
            info.EnvironmentVariables["SSH_ASKPASS_REQUIRE"] = "force"; info.EnvironmentVariables["DISPLAY"] = "ClassDock";
            info.EnvironmentVariables["CLASSDOCK_SSH_ASKPASS_PIPE"] = pipe;
            StartFileAskPass(peer, pipe, secret); secret = null;
            Process process = new Process(); process.StartInfo = info;
            lock (FileGate)
            {
                if (peer.Closed) throw FileError("cancelled");
                peer.Process = process; process.Start(); peer.LastIo = DateTime.UtcNow;
            }
            Thread errors = new Thread(delegate()
            {
                char[] chars = new char[1024];
                try { int n; while ((n = process.StandardError.Read(chars, 0, chars.Length)) > 0) lock (FileGate)
                    { peer.Diagnostic += new string(chars, 0, n); if (peer.Diagnostic.Length > 4096) peer.Diagnostic = peer.Diagnostic.Substring(peer.Diagnostic.Length - 4096); } }
                catch { }
            });
            errors.IsBackground = true; errors.Start();
            peer.Reader = new SftpReader(process.StandardInput.BaseStream, process.StandardOutput.BaseStream,
                delegate { lock (FileGate) { if (peer.Closed) throw FileError("closed"); peer.LastIo = DateTime.UtcNow; } });
            peer.Reader.Initialize(); peer.AuthDone.Set();
            if (!FileSessionAlive(peer.SessionId)) throw FileError("closed");
        }
        catch { CloseFilePeer(peer); throw; }
        finally { if (secret != null) Array.Clear(secret, 0, secret.Length); }
    }

    public static string FileRequest(string operation, byte[] body)
    {
        EnsureFileManager();
        int count = operation == "connect" || operation == "inspect" || operation == "download" ? 3 : 2;
        string[] request;
        try { request = ReadBundle(body, count, 64 * 1024); }
        finally { if (body != null) Array.Clear(body, 0, body.Length); }
        if (operation == "cancel" || operation == "release" || operation == "disconnect")
        {
            lock (FileGate)
            {
                FileJob job; FilePeer peer;
                if (operation == "cancel" && FileJobs.TryGetValue(request[1], out job)) CancelFileJob(job);
                if (operation == "release")
                {
                    if (FileJobs.TryGetValue(request[1], out job)) { if (!job.Done) CancelFileJob(job); DropFileCache(job); }
                    RemoteFiles.Remove(request[1]);
                }
                if (operation == "disconnect" && FilePeers.TryGetValue(request[1], out peer)) CloseFilePeer(peer);
            }
            return "{}";
        }
        if (operation != "connect" && operation != "inspect" && operation != "preview" && operation != "save-pick" && operation != "download") throw FileError("request");
        if (!Regex.IsMatch(request[0], "^[a-f0-9]{32}$")) throw FileError("request");
        string signature = operation + "\n" + request[1] + (count == 3 && operation != "connect" ? "\n" + request[2] : "");
        FileJob task; FilePeer connection = null; RemoteFile file = null; byte[] secret = null;
        lock (FileGate)
        {
            if (FileJobs.TryGetValue(request[0], out task))
            {
                if (task.Signature != signature) throw FileError("request");
                task.LastSeen = DateTime.UtcNow; return FileJobJson(task);
            }
            if (FileJobs.Count >= 512) throw FileError("limit");
            int active = 0; foreach (FileJob value in FileJobs.Values) if (!value.Done) active++;
            if (active >= 2) throw FileError("limit");
            if (operation == "connect")
            {
                // Do not take session.Sync while FileGate is held. Lifecycle closure is checked again in the worker.
                int live = 0;
                foreach (FilePeer value in FilePeers.Values) if (!value.Closed)
                { live++; if (value.SessionId == request[1]) throw FileError("busy"); }
                if (live >= 4) throw FileError("limit");
                if (request[2].Length > 16384 || request[2].IndexOf('\0') >= 0) throw FileError("authentication");
                secret = Encoding.UTF8.GetBytes(request[2]); request[2] = "";
                connection = new FilePeer(); connection.Id = Guid.NewGuid().ToString("N"); connection.SessionId = request[1];
                FilePeers[connection.Id] = connection;
            }
            else
            {
                if (operation == "inspect")
                {
                    ValidateRemoteFilePath(request[2]);
                    if (!FilePeers.TryGetValue(request[1], out connection)) throw FileError("closed");
                }
                else
                {
                    if (!RemoteFiles.TryGetValue(request[1], out file) || !FilePeers.TryGetValue(file.PeerId, out connection)) throw FileError("expired");
                    file.LastUsed = DateTime.UtcNow;
                }
                if (connection.Closed) throw FileError("closed");
                if (connection.Busy) throw FileError("busy");
            }
            if (operation == "save-pick" && FilePickerOpen) throw FileError("picker-busy");
            task = new FileJob(); task.Id = request[0]; task.Op = operation; task.Signature = signature;
            task.PeerId = connection.Id; task.FileId = file == null ? "" : file.Id;
            if (operation == "download")
            {
                FileJob picker;
                if (!FileJobs.TryGetValue(request[2], out picker) || picker.Op != "save-pick" || picker.State != "selected"
                    || picker.FileId != task.FileId || picker.PeerId != connection.Id || string.IsNullOrEmpty(picker.Destination)) throw FileError("destination");
                task.Destination = picker.Destination; task.DestinationExisted = picker.DestinationExisted;
                task.DestinationSize = picker.DestinationSize; task.DestinationWrite = picker.DestinationWrite;
                picker.Destination = null;
            }
            if (operation == "save-pick") FilePickerOpen = true;
            connection.Busy = true; connection.LastIo = DateTime.UtcNow;
            FileJobs[task.Id] = task;
        }
        Thread worker = new Thread(delegate()
        {
            try
            {
                if (operation == "connect") { SetFileState(task, "authenticating"); ConnectFiles(connection, secret); secret = null; }
                else if (operation == "inspect")
                {
                    CheckFileJob(task, connection); SetFileState(task, "inspecting");
                    string canonical = connection.Reader.RealPath(request[2]);
                    FileAttributes attrs = connection.Reader.Stat(canonical);
                    RemoteFile entry = new RemoteFile(); entry.Id = Guid.NewGuid().ToString("N"); entry.PeerId = connection.Id; entry.Path = canonical; entry.Attributes = attrs;
                    lock (FileGate)
                    {
                        if (RemoteFiles.Count >= 64) throw FileError("limit");
                        RemoteFiles[entry.Id] = entry; task.FileId = entry.Id; task.Total = attrs.Size;
                    }
                }
                else if (operation == "save-pick") PickFileDestination(task, file);
                else ReceiveRemoteFile(task, connection, file);
                if (!task.Done) CheckFileJob(task, connection);
                lock (FileGate) { if (task.State != "selected" && task.State != "cancelled") task.State = "complete"; }
            }
            catch (Exception ex)
            {
                lock (FileGate)
                {
                    task.Error = task.Cancelled ? "ssh-file-cancelled" : FileFailure(ex, connection);
                    task.State = task.Cancelled ? "cancelled" : "failed"; DropFileCache(task);
                }
                // An interrupted response cannot be reused as the next SFTP packet.
                if (ex is IOException || task.Cancelled || connection.Closed || ex.Message == "ssh-file-protocol") CloseFilePeer(connection);
            }
            finally
            {
                if (secret != null) Array.Clear(secret, 0, secret.Length);
                lock (FileGate)
                {
                    connection.Busy = false; connection.LastUsed = DateTime.UtcNow;
                    if (operation == "save-pick") FilePickerOpen = false;
                    CleanupPartial(task);
                    if (task.Released) DropFileCache(task);
                    task.Done = true;
                }
            }
        });
        worker.IsBackground = true; if (operation == "save-pick") worker.SetApartmentState(ApartmentState.STA); worker.Start();
        lock (FileGate) return FileJobJson(task);
    }
    static void SetFileState(FileJob job, string state) { lock (FileGate) job.State = state; }
    static void CheckFileJob(FileJob job, FilePeer peer)
    {
        lock (FileGate) { if (job.Cancelled) throw FileError("cancelled"); if (peer.Closed) throw FileError("closed"); }
        if (!FileSessionAlive(peer.SessionId)) throw FileError("closed");
    }
    static string FileFailure(Exception ex, FilePeer peer)
    {
        if (ex.Message.StartsWith("ssh-file-", StringComparison.Ordinal)) return ex.Message;
        string diagnostic = peer.Diagnostic;
        if (Regex.IsMatch(diagnostic, "Permission denied|incorrect passphrase|bad passphrase", RegexOptions.IgnoreCase)) return "ssh-file-authentication";
        if (Regex.IsMatch(diagnostic, "HOST IDENTIFICATION HAS CHANGED|Host key verification failed", RegexOptions.IgnoreCase)) return "ssh-file-host-key";
        if (Regex.IsMatch(diagnostic, "subsystem request failed|sftp-server", RegexOptions.IgnoreCase)) return "ssh-file-sftp-unavailable";
        if (ex is UnauthorizedAccessException) return "ssh-file-local-permission";
        return "ssh-file-io";
    }
    static void CancelFileJob(FileJob job)
    {
        if (job.Done || job.Committing) return;
        job.Cancelled = true;
        FilePeer peer;
        if (job.Op != "save-pick" && FilePeers.TryGetValue(job.PeerId, out peer)) CloseFilePeer(peer);
    }
    public static string FileStatus(string id)
    {
        lock (FileGate)
        {
            FileJob job; if (!FileJobs.TryGetValue(id ?? "", out job)) throw FileError("expired");
            job.LastSeen = DateTime.UtcNow;
            FilePeer peer;
            if (!job.Done && job.Op == "save-pick" && FilePeers.TryGetValue(job.PeerId, out peer)) peer.LastIo = DateTime.UtcNow;
            return FileJobJson(job);
        }
    }
    static string FileJobJson(FileJob job)
    {
        RemoteFile file; RemoteFiles.TryGetValue(job.FileId ?? "", out file);
        FilePeer peer; FilePeers.TryGetValue(job.PeerId ?? "", out peer);
        return "{\"id\":" + JsonString(job.Id) + ",\"peerId\":" + JsonString(job.PeerId) + ",\"fileId\":" + JsonString(job.FileId)
            + ",\"state\":" + JsonString(job.State) + ",\"done\":" + (job.Done ? "true" : "false")
            + ",\"error\":" + JsonString(job.Error) + ",\"bytes\":" + JsonString(job.Bytes.ToString()) + ",\"total\":" + JsonString(job.Total.ToString())
            + ",\"kind\":" + JsonString(job.Kind) + ",\"partial\":" + (job.Partial ? "true" : "false")
            + ",\"connected\":" + (peer != null && !peer.Closed ? "true" : "false")
            + ",\"path\":" + JsonString(file == null ? "" : file.Path) + ",\"size\":" + JsonString(file == null ? "0" : file.Attributes.Size.ToString())
            + ",\"readAt\":" + JsonString(job.Created.ToString("o")) + "}";
    }
    public static byte[] FileContent(string id)
    {
        lock (FileGate)
        {
            FileJob job;
            if (!FileJobs.TryGetValue(id ?? "", out job) || job.Op != "preview" || job.State != "complete" || job.CachePath == null) throw FileError("expired");
            job.LastSeen = DateTime.UtcNow; return File.ReadAllBytes(job.CachePath);
        }
    }

    static string FilePreviewKind(string path, byte[] head)
    {
        string ascii = Encoding.ASCII.GetString(head);
        if (head.Length >= 8 && head[0] == 137 && ascii.Substring(1, 3) == "PNG") return "image";
        if (head.Length >= 3 && head[0] == 255 && head[1] == 216 && head[2] == 255) return "image";
        if (ascii.StartsWith("GIF87a") || ascii.StartsWith("GIF89a") || ascii.StartsWith("BM")) return "image";
        if (head.Length >= 12 && ascii.StartsWith("RIFF") && ascii.Substring(8, 4) == "WEBP") return "image";
        if (ascii.StartsWith("%PDF-")) return "pdf";
        string name = path.Substring(path.LastIndexOf('/') + 1);
        int dot = name.LastIndexOf('.');
        string ext = dot < 0 ? "" : name.Substring(dot).ToLowerInvariant();
        if (Regex.IsMatch(ext, "^\\.(png|jpe?g|gif|bmp|webp|pdf|docx?|xlsx?|pptx?|zip|gz|7z|exe|dll|mp[34]|wav|ogg|avi|mov|woff2?|ttf|bin)$")) return "unsupported";
        bool utf16 = head.Length >= 2 && ((head[0] == 255 && head[1] == 254) || (head[0] == 254 && head[1] == 255));
        if (!utf16) foreach (byte b in head) if (b == 0 || (b < 9) || (b > 13 && b < 32)) return "unsupported";
        return ext == ".csv" || ext == ".tsv" ? "table" : "text";
    }
    static void ReceiveRemoteFile(FileJob job, FilePeer peer, RemoteFile file)
    {
        CheckFileJob(job, peer); SetFileState(job, "reading");
        SftpReader reader = peer.Reader;
        FileAttributes before = reader.Stat(file.Path);
        if (!file.Attributes.Same(before)) throw FileError("changed");
        byte[] handle = reader.Open(file.Path);
        try
        {
            if (!before.Same(reader.Stat(handle))) throw FileError("changed");
            long limit = before.Size; byte[] head = null;
            if (job.Op == "preview")
            {
                int headerLength = (int)Math.Min(512, before.Size);
                using (MemoryStream prefix = new MemoryStream())
                {
                    while (prefix.Length < headerLength)
                    {
                        CheckFileJob(job, peer);
                        byte[] chunk = reader.Read(handle, prefix.Length, headerLength - (int)prefix.Length);
                        if (chunk == null) throw FileError("changed");
                        prefix.Write(chunk, 0, chunk.Length);
                    }
                    head = prefix.ToArray();
                }
                job.Kind = FilePreviewKind(file.Path, head);
                if (job.Kind == "unsupported") { job.Total = before.Size; return; }
                long cap = job.Kind == "image" ? 20L * 1024 * 1024 : job.Kind == "pdf" ? 30L * 1024 * 1024 : 1024 * 1024;
                if ((job.Kind == "image" || job.Kind == "pdf") && before.Size > cap) { job.Kind = "too-large"; job.Total = before.Size; return; }
                limit = Math.Min(before.Size, cap); job.Partial = limit < before.Size;
                lock (FileGate)
                {
                    if (FileCacheBytes + limit > FileCacheLimit) throw FileError("cache-limit");
                    FileCacheBytes += limit; job.Reserved = limit;
                    job.CachePath = Path.Combine(FileCacheDirectory, job.Id + ".preview");
                }
            }
            else
            {
                string folder = Path.GetDirectoryName(job.Destination);
                long free = new DriveInfo(Path.GetPathRoot(folder)).AvailableFreeSpace;
                if (free < limit) throw FileError("disk-full");
                job.PartialPath = Path.Combine(folder, ".classdock-" + job.Id + ".part");
                job.JournalPath = Path.Combine(FileJournalDirectory, job.Id + ".pending");
                File.WriteAllText(job.JournalPath, job.PartialPath, new UTF8Encoding(false));
            }
            lock (FileGate) job.Total = before.Size;
            using (FileStream output = new FileStream(job.Op == "preview" ? job.CachePath : job.PartialPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536))
            {
                long offset = 0;
                if (head != null) { output.Write(head, 0, head.Length); offset = head.Length; }
                while (offset < limit)
                {
                    CheckFileJob(job, peer);
                    byte[] bytes = reader.Read(handle, offset, (int)Math.Min(65536, limit - offset));
                    if (bytes == null) throw FileError("changed");
                    output.Write(bytes, 0, bytes.Length); offset += bytes.Length;
                    lock (FileGate) job.Bytes = offset;
                }
                lock (FileGate) job.Bytes = offset;
                if (!before.Same(reader.Stat(handle)) || !before.Same(reader.Stat(file.Path))) throw FileError("changed");
                if (!job.Partial && reader.Read(handle, offset, 1) != null) throw FileError("changed");
                output.Flush(true);
            }
            CheckFileJob(job, peer);
            if (job.Op == "download")
            {
                lock (FileGate)
                {
                    if (job.Cancelled || peer.Closed) throw FileError("cancelled");
                    job.Committing = true; job.State = "saving";
                    CommitDownload(job);
                    // Commit is the point of success: a disconnect afterwards must not report a saved file as failed.
                    job.Done = true; job.State = "complete";
                }
            }
        }
        finally { try { reader.Close(handle); } catch { CloseFilePeer(peer); } }
    }

    [DllImport("comdlg32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetSaveFileName([In, Out] ref OPENFILENAME dialog);
    [DllImport("comdlg32.dll")]
    static extern uint CommDlgExtendedError();
    static string SafeDownloadName(string path)
    {
        string name = path.Substring(path.LastIndexOf('/') + 1);
        name = Regex.Replace(name, "[<>:\"/\\\\|?*\\x00-\\x1f]", "_").TrimEnd('.', ' ');
        if (name.Length > 160) name = name.Substring(0, 160).TrimEnd('.', ' ');
        if (string.IsNullOrEmpty(name)) name = "download";
        if (Regex.IsMatch(name, "^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\\.|$)", RegexOptions.IgnoreCase)) name = "_" + name;
        return name;
    }
    static void PickFileDestination(FileJob job, RemoteFile file)
    {
        SetFileState(job, "choosing");
        IntPtr buffer = Marshal.AllocHGlobal(32768 * 2);
        try
        {
            for (int n = 0; n < 32768 * 2; n += 2) Marshal.WriteInt16(buffer, n, 0);
            char[] name = SafeDownloadName(file.Path).ToCharArray(); Marshal.Copy(name, 0, buffer, name.Length);
            OPENFILENAME dialog = new OPENFILENAME(); dialog.lStructSize = Marshal.SizeOf(typeof(OPENFILENAME));
            dialog.hwndOwner = GetForegroundWindow(); dialog.lpstrFilter = "모든 파일\0*.*\0\0";
            dialog.lpstrFile = buffer; dialog.nMaxFile = 32768; dialog.lpstrTitle = "원격 파일을 다른 이름으로 저장";
            dialog.Flags = OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_DONTADDTORECENT | OFN_EXPLORER | 0x00000002 | 0x00000004;
            if (!GetSaveFileName(ref dialog))
            {
                if (CommDlgExtendedError() != 0) throw FileError("picker");
                lock (FileGate) { job.State = "cancelled"; job.Done = true; } return;
            }
            string destination = Path.GetFullPath(Marshal.PtrToStringUni(buffer));
            if (destination.StartsWith("\\\\", StringComparison.Ordinal) || destination.Substring(2).IndexOf(':') >= 0) throw FileError("destination");
            FileInfo info = new FileInfo(destination);
            lock (FileGate)
            {
                if (job.Cancelled) throw FileError("cancelled");
                job.Destination = destination; job.DestinationExisted = info.Exists;
                if (info.Exists) { job.DestinationSize = info.Length; job.DestinationWrite = info.LastWriteTimeUtc; }
                job.State = "selected";
            }
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    static void CommitDownload(FileJob job)
    {
        FileInfo target = new FileInfo(job.Destination);
        if (target.Exists != job.DestinationExisted || (target.Exists && (target.Length != job.DestinationSize || target.LastWriteTimeUtc != job.DestinationWrite))) throw FileError("destination-changed");
        if (target.Exists)
        {
            if ((target.Attributes & System.IO.FileAttributes.ReparsePoint) != 0) throw FileError("destination");
            File.Replace(job.PartialPath, job.Destination, null);
        }
        else File.Move(job.PartialPath, job.Destination);
        job.PartialPath = null;
    }
    static void CleanupPartial(FileJob job)
    {
        if (job.PartialPath != null)
        {
            try { File.Delete(job.PartialPath); job.PartialPath = null; }
            catch { return; } // Journal remains for restart cleanup.
        }
        QueueFileDelete(job.JournalPath); job.JournalPath = null;
    }
}
