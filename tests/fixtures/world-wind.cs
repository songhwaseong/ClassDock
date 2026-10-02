using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

class WorldWindTest
{
    static int checks;
    static void Check(bool ok) { checks++; if (!ok) throw new Exception("Check " + checks); }
    static void Reject(Action fn) { bool rejected = false; try { fn(); } catch { rejected = true; } Check(rejected); }
    static void Main(string[] args)
    {
        byte[] message = File.ReadAllBytes(args[0]);
        var decoded = WorldWindGrib.Decode(message);
        Check(decoded.Run == new DateTime(2026,10,2,0,0,0,DateTimeKind.Utc) && decoded.Hour == 6);
        Check(decoded.Level == 85000 && decoded.Surface == 100 && decoded.Parameter == 2 && decoded.Category == 2);
        // Independent oracle: ECMWF ecCodes 2.49.0, north/south flipped and rounded to little-endian float32.
        using (var data = new MemoryStream()) using (var writer = new BinaryWriter(data)) using (var sha = SHA256.Create())
        {
            foreach (float value in decoded.Values) writer.Write(value);
            string hash = BitConverter.ToString(sha.ComputeHash(data.ToArray())).Replace("-", "").ToLowerInvariant();
            Check(hash == "31447743f00f10a95df8e3ad980d26276396aea8b893388f8e778a814834c89a");
        }
        Reject(() => WorldWindGrib.Decode(message.Take(message.Length - 1).ToArray()));
        foreach (int position in new[] { 0, 7, 12, 37 + 71, message.Length - 1 })
        { byte[] broken = (byte[])message.Clone(); broken[position] ^= 127; Reject(() => WorldWindGrib.Decode(broken)); }
        Check(WorldWindService.SourceUrl("2026100200",6).EndsWith("gfs.t00z.pgrb2.1p00.f006"));
        foreach (string cycle in new[] { "../20261002", "2026130200", "2026100201", "http://bad" }) Reject(() => WorldWindService.SourceUrl(cycle, 6));
        foreach (int hour in new[] { -3, 1, 73, 999 }) Reject(() => WorldWindService.SourceUrl("2026100200", hour));
        string index = "1:0:d=2026100200:UGRD:850 mb:6 hour fcst:\n2:50:d=2026100200:VGRD:850 mb:6 hour fcst:\n3:90:d=2026100200:TMP:850 mb:6 hour fcst:\n4:120:d=2026100200:PRES:surface:6 hour fcst:\n";
        var records = WorldWindService.ReadIndex(index,"2026100200"); Check(records[0].Last == 49 && records[1].First == 50 && records[2].Last == 119);
        Reject(() => WorldWindService.ReadIndex(index.Replace(":50:",":0:"),"2026100200"));
        Reject(() => WorldWindService.ReadIndex(index,"2026100206"));

        DateTime run = DateTime.UtcNow.AddHours(-6); run = new DateTime(run.Year,run.Month,run.Day,run.Hour / 6 * 6,0,0,DateTimeKind.Utc);
        string current = run.ToString("yyyyMMddHH");
        int count = WorldWindGrib.Count;
        var u = Enumerable.Repeat(10f,count).ToArray(); var v = Enumerable.Repeat(-5f,count).ToArray();
        var temperature = Enumerable.Repeat(273.15f,count).ToArray(); var pressure = Enumerable.Repeat(100000f,count).ToArray();
        pressure[0] = 84000; pressure[1] = Single.NaN; u[3] = Single.PositiveInfinity;
        byte[] packed = WorldWindService.Pack(current,6,850,u,v,temperature,pressure);
        Check(packed.Length == WorldWindService.FrameBytes && WorldWindService.ValidFrame(packed,current,6,850));
        Check(Single.IsNaN(BitConverter.ToSingle(packed,40)) && Single.IsNaN(BitConverter.ToSingle(packed,44)));
        Check(BitConverter.ToSingle(packed,48) == 10 && Single.IsNaN(BitConverter.ToSingle(packed,52)));
        Check(Math.Abs(BitConverter.ToSingle(packed,40 + count * 8 + 8)) < .001);
        Check(!WorldWindService.ValidFrame(packed,current,9,850) && !WorldWindService.ValidFrame(packed,current,6,500));
        byte[] surface = WorldWindService.Pack(current,6,10,u,v,temperature,null); Check(BitConverter.ToSingle(surface,40) == 10);

        string cache = args[1]; Directory.CreateDirectory(cache); int calls = 0; bool cached;
        var service = new WorldWindService(cache,(url,first,last,limit) => { calls++; throw new IOException("offline"); });
        File.WriteAllBytes(Path.Combine(cache,current + "-006-850.bin"),packed);
        Check(service.Frame(current,6,850,out cached).SequenceEqual(packed) && cached && calls == 0);
        Reject(() => service.Frame(current,6,1000,out cached)); Check(calls == 0);
        Reject(() => service.Frame(current,9,850,out cached)); Check(calls == 1);
        Reject(() => service.Frame(current,9,850,out cached)); Check(calls == 1); // Retry cooldown.
        string catalog = Encoding.UTF8.GetString(service.Catalog()); Check(catalog.Contains("\"saved\":true") && catalog.Contains(current));
        int afterCatalog = calls; service.Catalog(); Check(calls == afterCatalog);
        // Bad calendar names in the cache do not prevent discovery of a valid saved run.
        File.WriteAllBytes(Path.Combine(cache,"9999999999-006-850.bin"),packed);
        var another = new WorldWindService(cache,(url,first,last,limit) => { throw new IOException(); });
        Check(Encoding.UTF8.GetString(another.Catalog()).Contains(current));
        Console.WriteLine("World wind checks: " + checks + " passed");
    }
}
