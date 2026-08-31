using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Text;
using System.Threading;

static class SshFilesTest
{
    public static void Main(string[] args) { ClassDockSshTerminal.TestFiles(args[0]); Console.WriteLine("SFTP file checks passed"); }
}
static partial class ClassDockSshTerminal
{
    sealed class FakeSftp : Stream
    {
        public byte[] Content;
        public bool WrongId, Changed, Special, BadPacket, Denied;
        public long GreatestOffset;
        public int Reads, Opens;
        public Action OnRead;
        public int MaxRead = 65536;
        readonly MemoryStream pending = new MemoryStream();
        MemoryStream reply = new MemoryStream();
        public FakeSftp(byte[] bytes) { Content = bytes; }
        public override bool CanRead { get { return true; } }
        public override bool CanWrite { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override long Length { get { return reply.Length; } }
        public override long Position { get { return reply.Position; } set { throw new NotSupportedException(); } }
        public override long Seek(long n, SeekOrigin o) { throw new NotSupportedException(); }
        public override void SetLength(long n) { throw new NotSupportedException(); }
        public override int Read(byte[] bytes, int start, int count) { return reply.Read(bytes, start, Math.Min(count, 7)); } // fragmented TCP/pipe reads
        public override void Write(byte[] bytes, int start, int count) { pending.Write(bytes, start, count); }
        void Attrs(SftpPacket p)
        {
            p.UInt(13); p.Long(Content.LongLength); p.UInt(Special ? 0x1000u : 0x81a4u); p.UInt(100);
            p.UInt(Changed && Reads > 1 ? 101u : 100u);
        }
        void Status(SftpPacket p, uint status, uint id) { p.Byte(101); p.UInt(id); p.UInt(status); p.Text("ignored diagnostic"); p.Text(""); }
        public override void Flush()
        {
            SftpPacket incoming = new SftpPacket(pending.ToArray()); pending.SetLength(0);
            incoming.UInt(); byte op=incoming.Byte(); SftpPacket answer=new SftpPacket();
            if(op==1){ Require(incoming.UInt()==3,"SFTP version");answer.Byte(2);answer.UInt(3); }
            else
            {
                uint id=incoming.UInt(); if(WrongId) id++;
                if(Denied) Status(answer,3,id);
                else if(op==16){Require(incoming.Text().StartsWith("/"),"absolute path");answer.Byte(104);answer.UInt(id);answer.UInt(1);answer.Text("/resolved/한글 'file'.txt");answer.Text("");Attrs(answer);}
                else if(op==17 || op==8){if(op==17)incoming.Text();else incoming.Bytes();answer.Byte(105);answer.UInt(id);Attrs(answer);}
                else if(op==3){incoming.Text();Require(incoming.UInt()==1,"open must be read-only");Require(incoming.UInt()==0,"no mutation attributes");Opens++;answer.Byte(102);answer.UInt(id);answer.Bytes(new byte[]{7});}
                else if(op==5)
                {
                    incoming.Bytes();long offset=incoming.Long();uint size=incoming.UInt();GreatestOffset=Math.Max(GreatestOffset,offset);Reads++;
                    if(OnRead!=null)OnRead();
                    Require(size<=65536,"bounded read request");
                    if(offset>=Content.LongLength)Status(answer,1,id);
                    else{int length=(int)Math.Min(Math.Min(size,MaxRead),Content.LongLength-offset);byte[] bytes=new byte[length];Buffer.BlockCopy(Content,(int)offset,bytes,0,length);answer.Byte(103);answer.UInt(id);answer.Bytes(bytes);}
                }
                else if(op==4){incoming.Bytes();Status(answer,0,id);}
                else throw new Exception("Unexpected write-capable SFTP command: "+op);
            }
            byte[] packet=answer.Array();SftpPacket frame=new SftpPacket();frame.UInt(BadPacket ? 2000000u : (uint)packet.Length);
            byte[] head=frame.Array();reply=new MemoryStream();reply.Write(head,0,head.Length);reply.Write(packet,0,packet.Length);reply.Position=0;
        }
    }
    static void Require(bool value,string label){if(!value)throw new Exception(label);}
    static void Fails(Action action,string contains)
    {
        try{action();}catch(Exception ex){Require(ex.Message.Contains(contains),"wrong failure: "+ex.Message);return;}
        throw new Exception("Expected failure: "+contains);
    }
    static FilePeer TestPeer(string sessionId, FakeSftp wire)
    {
        FilePeer peer=new FilePeer();peer.Id=Guid.NewGuid().ToString("N");peer.SessionId=sessionId;
        peer.Reader=new SftpReader(wire,wire,delegate{});peer.Reader.Initialize();return peer;
    }
    static RemoteFile TestRemote(FilePeer peer,FakeSftp wire)
    {
        RemoteFile file=new RemoteFile();file.Id=Guid.NewGuid().ToString("N");file.PeerId=peer.Id;file.Path="/a.txt";file.Attributes=peer.Reader.Stat(file.Path);return file;
    }
    static FileJob TestJob(string op,FilePeer peer,RemoteFile file)
    {
        FileJob job=new FileJob();job.Id=Guid.NewGuid().ToString("N");job.Op=op;job.PeerId=peer.Id;job.FileId=file.Id;return job;
    }
    static byte[] TestBundle(params string[] values)
    {
        using(MemoryStream stream=new MemoryStream())
        {
            foreach(string value in values){byte[] bytes=Encoding.UTF8.GetBytes(value);byte[] size=BitConverter.GetBytes(bytes.Length);stream.Write(size,0,4);stream.Write(bytes,0,bytes.Length);}
            return stream.ToArray();
        }
    }
    static void TestAskPassCancellation()
    {
        // Exercise real Windows overlapped accepts, not a mocked SFTP stream. Disposing their
        // AsyncWaitHandle too early crashes this isolated test process on the I/O completion thread.
        for(int n=0;n<40;n++)
        {
            FilePeer peer=new FilePeer();string pipeName="classdock-askpass-test-"+Guid.NewGuid().ToString("N");
            byte[] secret=Encoding.UTF8.GetBytes("test-secret");
            Thread worker=StartFileAskPass(peer,pipeName,secret);
            if(n%2==0)
            {
                using(NamedPipeClientStream client=new NamedPipeClientStream(".",pipeName,PipeDirection.In))
                {
                    client.Connect(3000);int size=BitConverter.ToInt32(ReadExactly(client,4),0);
                    Require(Encoding.UTF8.GetString(ReadExactly(client,size))=="test-secret","askpass payload");
                }
            }
            Thread.Sleep(n%4+1);peer.AuthDone.Set();
            Require(worker.Join(3000),"cancelled askpass worker must exit");
            foreach(byte b in secret)Require(b==0,"askpass secret must be cleared after cancellation");
            peer.AuthDone.Dispose();
        }
        for(int n=0;n<10;n++)
        using(NamedPipeServerStream pipe=new NamedPipeServerStream("classdock-timeout-test-"+Guid.NewGuid().ToString("N"),PipeDirection.Out,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous))
            Require(!WaitForAskPassConnection(pipe,null,TimeSpan.FromMilliseconds(2)),"idle pipe accept must time out safely");
        // Drain callbacks from the cancelled accepts and then demonstrate that a fresh authentication works.
        Thread.Sleep(100);
        FilePeer retry=new FilePeer();string retryName="classdock-retry-test-"+Guid.NewGuid().ToString("N");
        byte[] retrySecret=Encoding.UTF8.GetBytes("retry-secret");Thread next=StartFileAskPass(retry,retryName,retrySecret);
        using(NamedPipeClientStream client=new NamedPipeClientStream(".",retryName,PipeDirection.In))
        {
            client.Connect(3000);int size=BitConverter.ToInt32(ReadExactly(client,4),0);
            Require(Encoding.UTF8.GetString(ReadExactly(client,size))=="retry-secret","authentication works after failures");
        }
        retry.AuthDone.Set();Require(next.Join(3000),"retry helper exits");retry.AuthDone.Dispose();
    }
    public static void TestFiles(string temp)
    {
        TestAskPassCancellation();
        // Isolate all test output, including cleanup records, from the real application's cache.
        typeof(ClassDockSshTerminal).GetField("FileCacheDirectory",BindingFlags.Static|BindingFlags.NonPublic).SetValue(null,temp);
        typeof(ClassDockSshTerminal).GetField("FileJournalDirectory",BindingFlags.Static|BindingFlags.NonPublic).SetValue(null,temp);
        SshSession session=new SshSession();session.Id="test-files";Sessions[session.Id]=session;
        byte[] bytes=new byte[2*1024*1024+17];for(int n=0;n<bytes.Length;n++)bytes[n]=(byte)('a'+n%26);
        FakeSftp wire=new FakeSftp(bytes);FilePeer peer=TestPeer(session.Id,wire);RemoteFile file=TestRemote(peer,wire);
        Require(peer.Reader.RealPath("/literal/$(echo x)")=="/resolved/한글 'file'.txt","UTF-8 canonical path");
        byte[] handle=peer.Reader.Open(file.Path);
        Require(peer.Reader.Read(handle,(long)uint.MaxValue+5,16)==null,"large offset EOF");
        Require(wire.GreatestOffset==(long)uint.MaxValue+5,"64-bit offset must not wrap");peer.Reader.Close(handle);
        FileJob preview=TestJob("preview",peer,file);ReceiveRemoteFile(preview,peer,file);
        Require(preview.Partial && preview.Bytes==1024*1024,"text preview byte cap");
        byte[] prefix=File.ReadAllBytes(preview.CachePath);for(int n=0;n<prefix.Length;n++)Require(prefix[n]==bytes[n],"preview bytes");
        DropFileCache(preview);Require(FileCacheBytes==0,"cache accounting");
        FileJob download=TestJob("download",peer,file);download.Destination=Path.Combine(temp,"original.txt");
        ReceiveRemoteFile(download,peer,file);Require(download.Done && download.Bytes==bytes.Length,"full download");
        byte[] saved=File.ReadAllBytes(download.Destination);Require(saved.Length==bytes.Length,"download must not save preview prefix");
        for(int n=0;n<saved.Length;n++)Require(saved[n]==bytes[n],"download bytes");CleanupPartial(download);
        FileJob conflict=TestJob("download",peer,file);conflict.Destination=download.Destination;conflict.PartialPath=Path.Combine(temp,"conflict.part");
        File.WriteAllText(conflict.PartialPath,"new");Fails(delegate{CommitDownload(conflict);},"destination-changed");
        Require(File.ReadAllBytes(download.Destination).Length==bytes.Length,"existing target survives conflict");CleanupPartial(conflict);
        FileJob overwrite=TestJob("download",peer,file);overwrite.Destination=download.Destination;overwrite.DestinationExisted=true;
        FileInfo existing=new FileInfo(overwrite.Destination);overwrite.DestinationSize=existing.Length;overwrite.DestinationWrite=existing.LastWriteTimeUtc;
        overwrite.PartialPath=Path.Combine(temp,"replace.part");File.WriteAllText(overwrite.PartialPath,"replacement");CommitDownload(overwrite);
        Require(File.ReadAllText(overwrite.Destination)=="replacement","approved atomic overwrite");
        FileJob cancelled=TestJob("preview",peer,file);cancelled.Cancelled=true;Fails(delegate{ReceiveRemoteFile(cancelled,peer,file);},"cancelled");
        FileJob midway=TestJob("download",peer,file);midway.Destination=Path.Combine(temp,"cancelled.txt");
        wire.OnRead=delegate{midway.Cancelled=true;};Fails(delegate{ReceiveRemoteFile(midway,peer,file);},"cancelled");CleanupPartial(midway);wire.OnRead=null;
        Require(!File.Exists(midway.Destination) && midway.PartialPath==null,"mid-transfer cancel leaves no final or partial file");
        wire.Changed=true;wire.Reads=0;FileJob changing=TestJob("download",peer,file);changing.Destination=Path.Combine(temp,"changed.txt");
        Fails(delegate{ReceiveRemoteFile(changing,peer,file);},"changed");CleanupPartial(changing);wire.Changed=false;
        Require(!File.Exists(changing.Destination),"mid-transfer file change must not commit");
        wire.Special=true;Fails(delegate{peer.Reader.Stat("/pipe");},"not-regular");wire.Special=false;
        wire.Denied=true;Fails(delegate{peer.Reader.Stat("/secret");},"permission");wire.Denied=false;
        wire.WrongId=true;Fails(delegate{peer.Reader.Stat("/x");},"protocol");wire.WrongId=false;
        wire.BadPacket=true;Fails(delegate{peer.Reader.Stat("/x");},"protocol");wire.BadPacket=false;
        Require(SafeDownloadName("/x/CON.txt")=="_CON.txt","reserved Windows name");
        Require(!SafeDownloadName("/x/a:b.txt").Contains(":"),"no alternate data stream");
        Require(ValidateRemoteFilePath("/x/a b'$(echo x)")=="/x/a b'$(echo x)","literal path");
        Fails(delegate{ValidateRemoteFilePath("relative.txt");},"path");
        FakeSftp emptyWire=new FakeSftp(new byte[0]);FilePeer emptyPeer=TestPeer(session.Id,emptyWire);RemoteFile emptyFile=TestRemote(emptyPeer,emptyWire);
        FileJob empty=TestJob("download",emptyPeer,emptyFile);empty.Destination=Path.Combine(temp,"empty.txt");ReceiveRemoteFile(empty,emptyPeer,emptyFile);
        Require(new FileInfo(empty.Destination).Length==0,"empty file download");CleanupPartial(empty);
        FakeSftp shortWire=new FakeSftp(Encoding.UTF8.GetBytes("short read content"));shortWire.MaxRead=2;
        FilePeer shortPeer=TestPeer(session.Id,shortWire);RemoteFile shortFile=TestRemote(shortPeer,shortWire);
        FileJob shortPreview=TestJob("preview",shortPeer,shortFile);ReceiveRemoteFile(shortPreview,shortPeer,shortFile);
        Require(File.ReadAllText(shortPreview.CachePath)=="short read content","short SFTP reads must be assembled");DropFileCache(shortPreview);
        MethodInfo auth=typeof(ClassDockLauncher).GetMethod("RequiresLocalAuthToken",BindingFlags.Static|BindingFlags.NonPublic);
        Require((bool)auth.Invoke(null,new object[]{"GET","/ssh-file-content?id=anything"}),"preview content requires launcher token");
        Require((bool)auth.Invoke(null,new object[]{"GET","/ssh-file-job?id=anything"}),"job status requires launcher token");
        FilePeers[peer.Id]=peer;EnsureFileManager();
        string requestId=Guid.NewGuid().ToString("N");
        FileRequest("inspect",TestBundle(requestId,peer.Id,"/literal file.txt"));
        FileRequest("inspect",TestBundle(requestId,peer.Id,"/literal file.txt"));
        DateTime deadline=DateTime.UtcNow.AddSeconds(3);
        while(!FileJobs[requestId].Done && DateTime.UtcNow<deadline)Thread.Sleep(1);
        Require(FileJobs.Count==1 && FileJobs[requestId].State=="complete","duplicate starts reuse one job");
        Fails(delegate{FileRequest("inspect",TestBundle(requestId,peer.Id,"/different.txt"));},"request");
        string inspected=FileJobs[requestId].FileId;FileJob forged=new FileJob();forged.Id=Guid.NewGuid().ToString("N");forged.Op="save-pick";forged.State="selected";
        forged.FileId=inspected;forged.PeerId="other-peer";forged.Destination=Path.Combine(temp,"forged.txt");FileJobs[forged.Id]=forged;
        Fails(delegate{FileRequest("download",TestBundle(Guid.NewGuid().ToString("N"),inspected,forged.Id));},"destination");
        FileJobs.Remove(forged.Id);ShutdownFiles();
        Sessions.Remove(session.Id);
    }
}
