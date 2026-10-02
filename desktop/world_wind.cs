using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

// NOAA GFS 1 degree, regular latitude/longitude grids only. No external runtime.
// GRIB2 templates 3.0, 4.0, 5.0/5.2/5.3, 7.0/7.2/7.3 follow the NCEP tables:
// https://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_doc/
// Unsupported packing or inconsistent metadata fails closed rather than displaying wrong winds.
internal static class WorldWindGrib
{
    internal const int Count = 360 * 181;
    internal sealed class Field
    {
        internal DateTime Run;
        internal int Hour, Category, Parameter, Surface;
        internal double Level;
        internal float[] Values;
    }
    static void Check(bool ok) { if (!ok) throw new InvalidDataException("world-wind-data"); }
    static uint UInt(byte[] a, int p) { return ((uint)a[p] << 24) | ((uint)a[p + 1] << 16) | ((uint)a[p + 2] << 8) | a[p + 3]; }
    static int U16(byte[] a, int p) { return (a[p] << 8) | a[p + 1]; }
    static int Signed(uint value, int bits) { uint sign = 1U << (bits - 1); return (value & sign) != 0 ? -(int)(value & (sign - 1)) : (int)value; }
    static double Reference(byte[] a, int p) { byte[] b = a.Skip(p).Take(4).ToArray(); if (BitConverter.IsLittleEndian) Array.Reverse(b); return BitConverter.ToSingle(b, 0); }
    sealed class Bits
    {
        readonly byte[] data; int bit;
        internal Bits(byte[] bytes, int offset) { data = bytes; bit = offset * 8; }
        internal long Read(int count)
        {
            Check(count >= 0 && count <= 32 && (long)bit + count <= (long)data.Length * 8);
            long value = 0;
            for (int n = 0; n < count; n++, bit++) value = (value << 1) | (uint)((data[bit / 8] >> (7 - bit % 8)) & 1);
            return value;
        }
        internal void Align() { bit = (bit + 7) / 8 * 8; }
    }
    internal static Field Decode(byte[] message)
    {
        Check(message != null && message.Length >= 20 && message.Length <= 4 * 1024 * 1024);
        Check(Encoding.ASCII.GetString(message, 0, 4) == "GRIB" && message[7] == 2 && message[6] == 0);
        Check(UInt(message, 8) == 0 && UInt(message, 12) == message.Length && Encoding.ASCII.GetString(message, message.Length - 4, 4) == "7777");
        var sections = new Dictionary<int, byte[]>();
        int pos = 16;
        while (pos < message.Length - 4)
        {
            Check(pos + 5 <= message.Length - 4);
            int length = checked((int)UInt(message, pos)), id = message[pos + 4];
            Check(length >= 5 && length <= message.Length - 4 - pos && id >= 1 && id <= 7 && !sections.ContainsKey(id));
            sections[id] = message.Skip(pos).Take(length).ToArray(); pos += length;
        }
        Check(pos == message.Length - 4 && new[] { 1, 3, 4, 5, 6, 7 }.All(sections.ContainsKey));
        byte[] s1 = sections[1], s3 = sections[3], s4 = sections[4], s5 = sections[5], s6 = sections[6], s7 = sections[7];
        Check(s1.Length >= 21 && s3.Length == 72 && s4.Length >= 34 && s5.Length >= 21 && s6.Length >= 6);
        Check(U16(s3, 12) == 0 && UInt(s3, 6) == Count && UInt(s3, 30) == 360 && UInt(s3, 34) == 181);
        Check(UInt(s3, 38) == 0 && Signed(UInt(s3, 46), 32) == 90000000 && UInt(s3, 50) == 0
            && Signed(UInt(s3, 55), 32) == -90000000 && UInt(s3, 59) == 359000000
            && UInt(s3, 63) == 1000000 && UInt(s3, 67) == 1000000 && s3[71] == 0 && (s3[54] & 8) == 0);
        Check(U16(s4, 7) == 0 && s4[17] == 1 && s4[28] == 255);
        var field = new Field {
            Run = new DateTime(U16(s1, 12), s1[14], s1[15], s1[16], s1[17], s1[18], DateTimeKind.Utc),
            Hour = checked((int)UInt(s4, 18)), Category = s4[9], Parameter = s4[10], Surface = s4[22],
            Level = s4[23] == 255 ? 0 : UInt(s4, 24) * Math.Pow(10, -Signed(s4[23], 8))
        };
        int count = checked((int)UInt(s5, 5)), template = U16(s5, 9), bits = s5[19];
        Check(count > 0 && count <= Count && bits <= 32 && (template == 0 || template == 2 || template == 3));
        double reference = Reference(s5, 11), binary = Math.Pow(2, Signed((uint)U16(s5, 15), 16)), dec = Math.Pow(10, -Signed((uint)U16(s5, 17), 16));
        Check(!Double.IsNaN(reference) && !Double.IsInfinity(reference) && binary > 0 && dec > 0 && !Double.IsInfinity(binary) && !Double.IsInfinity(dec));
        var reader = new Bits(s7, 5); long[] values = new long[count];
        if (template == 0) { for (int i = 0; i < count; i++) values[i] = reader.Read(bits); }
        else
        {
            Check(s5.Length >= (template == 3 ? 49 : 47) && s5[21] == 1 && s5[22] == 0);
            int groups = checked((int)UInt(s5, 31)); Check(groups > 0 && groups <= count);
            int order = template == 3 ? s5[47] : 0, descriptorBits = template == 3 ? s5[48] * 8 : 0;
            Check(template != 3 || ((order == 1 || order == 2) && descriptorBits > 0 && descriptorBits <= 32 && count >= order));
            long first = 0, second = 0, minimum = 0;
            if (order > 0) { first = reader.Read(descriptorBits); if (order == 2) second = reader.Read(descriptorBits); minimum = Signed((uint)reader.Read(descriptorBits), descriptorBits); }
            long[] refs = new long[groups]; int[] widths = new int[groups], lengths = new int[groups];
            for (int i = 0; i < groups; i++) refs[i] = reader.Read(bits); reader.Align();
            for (int i = 0; i < groups; i++) { widths[i] = checked((int)reader.Read(s5[36]) + s5[35]); Check(widths[i] <= 32); } reader.Align();
            long total = 0;
            for (int i = 0; i < groups; i++)
            {
                long packedLength = reader.Read(s5[46]);
                long length = i == groups - 1 ? UInt(s5, 42) : UInt(s5, 37) + packedLength * s5[41];
                Check(length >= 0 && length <= count); lengths[i] = (int)length; total += length;
            }
            Check(total == count); reader.Align(); int index = 0;
            for (int g = 0; g < groups; g++) for (int i = 0; i < lengths[g]; i++) values[index++] = refs[g] + reader.Read(widths[g]);
            if (order > 0)
            {
                values[0] = first; if (order == 2) values[1] = second;
                checked { for (int i = order; i < count; i++) values[i] += minimum + (order == 1 ? values[i - 1] : 2 * values[i - 1] - values[i - 2]); }
            }
        }
        Check(s6[5] == 255 || (s6[5] == 0 && s6.Length == 6 + (Count + 7) / 8));
        float[] result = new float[Count]; int at = 0;
        for (int i = 0; i < Count; i++)
        {
            bool present = s6[5] == 255 || (s6[6 + i / 8] & (1 << (7 - i % 8))) != 0;
            float value = Single.NaN;
            if (present) { Check(at < count); double v = (reference + values[at++] * binary) * dec; Check(!Double.IsNaN(v) && !Double.IsInfinity(v) && Math.Abs(v) < 1e9); value = (float)v; }
            // Source scans north to south; output scans south to north, longitude 0..359.
            result[(180 - i / 360) * 360 + i % 360] = value;
        }
        Check(at == count); field.Values = result; return field;
    }
}

internal sealed class WorldWindService
{
    internal const int FrameBytes = 40 + WorldWindGrib.Count * 3 * 4;
    internal static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    readonly string cache;
    readonly Func<string, long, long, int, byte[]> download;
    readonly object gate = new object();
    readonly Dictionary<string, DateTime> failures = new Dictionary<string, DateTime>();
    DateTime nextCatalogCheck = DateTime.MinValue;
    string lastCycle = "";
    bool catalogSaved;
    internal WorldWindService(string cachePath, Func<string, long, long, int, byte[]> request = null)
    { cache = Path.GetFullPath(cachePath); download = request ?? new Func<string, long, long, int, byte[]>(Download); }
    static DateTime CycleDate(string cycle)
    {
        DateTime value;
        if (!Regex.IsMatch(cycle ?? "", "^[0-9]{10}$") || !DateTime.TryParseExact(cycle, "yyyyMMddHH", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out value) || value.Hour % 6 != 0) throw new ArgumentException("world-wind-query");
        return value;
    }
    internal static string SourceUrl(string cycle, int hour)
    {
        CycleDate(cycle);
        if (hour < 0 || hour > 72 || hour % 3 != 0) throw new ArgumentException("world-wind-query");
        return "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs." + cycle.Substring(0, 8) + "/" + cycle.Substring(8, 2)
            + "/atmos/gfs.t" + cycle.Substring(8, 2) + "z.pgrb2.1p00.f" + hour.ToString("000", CultureInfo.InvariantCulture);
    }
    static byte[] Download(string url, long first, long last, int limit)
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.Timeout = 20000; request.ReadWriteTimeout = 20000; request.AllowAutoRedirect = false;
        request.UserAgent = "ClassDock/1.0 (NOAA GFS educational map)";
        if (first >= 0) request.AddRange(first, last);
        using (var response = (HttpWebResponse)request.GetResponse())
        {
            if (response.StatusCode != (first >= 0 ? HttpStatusCode.PartialContent : HttpStatusCode.OK)) throw new IOException("world-wind-network");
            if (first >= 0 && !(response.Headers["Content-Range"] ?? "").StartsWith("bytes " + first + "-" + last + "/", StringComparison.Ordinal)) throw new IOException("world-wind-range");
            if (response.ContentLength > limit) throw new IOException("world-wind-size");
            using (var input = response.GetResponseStream()) using (var output = new MemoryStream())
            {
                byte[] buffer = new byte[16384]; int read;
                while ((read = input.Read(buffer, 0, buffer.Length)) > 0) { if (output.Length + read > limit) throw new IOException("world-wind-size"); output.Write(buffer, 0, read); }
                if (first >= 0 && output.Length != last - first + 1) throw new IOException("world-wind-truncated");
                return output.ToArray();
            }
        }
    }
    internal sealed class Record { internal long First, Last; internal string Variable, Level; }
    internal static List<Record> ReadIndex(string index, string cycle)
    {
        var records = new List<Record>();
        foreach (string line in index.Split('\n'))
        {
            if (String.IsNullOrWhiteSpace(line)) continue;
            string[] cells = line.Trim().Split(':'); long offset;
            if (cells.Length < 6 || !Int64.TryParse(cells[1], NumberStyles.None, CultureInfo.InvariantCulture, out offset) || offset < 0
                || cells[2] != "d=" + cycle || (records.Count > 0 && offset <= records[records.Count - 1].First)) throw new InvalidDataException("world-wind-index");
            if (records.Count > 0) records[records.Count - 1].Last = offset - 1;
            records.Add(new Record { First = offset, Last = -1, Variable = cells[3], Level = cells[4] });
        }
        if (records.Count < 4 || records.Count > 5000) throw new InvalidDataException("world-wind-index");
        return records;
    }
    string Index(string cycle, int hour, bool refresh = false)
    {
        string file = Path.Combine(cache, cycle + "-" + hour.ToString("000") + ".idx");
        try {
            if (!refresh && File.Exists(file) && new FileInfo(file).Length <= 512 * 1024)
            { string stored = File.ReadAllText(file); ReadIndex(stored, cycle); return stored; }
        } catch (IOException) { } catch (UnauthorizedAccessException) { }
        string text = Encoding.UTF8.GetString(download(SourceUrl(cycle, hour) + ".idx", -1, -1, 512 * 1024));
        ReadIndex(text, cycle); Save(file, Encoding.UTF8.GetBytes(text)); return text;
    }
    void Save(string file, byte[] data)
    {
        try
        {
            Directory.CreateDirectory(cache);
            string temp = file + ".tmp"; File.WriteAllBytes(temp, data);
            if (File.Exists(file)) File.Delete(file); File.Move(temp, file);
        }
        catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
    internal byte[] Catalog()
    {
        lock (gate)
        {
            DateTime now = DateTime.UtcNow;
            if (now >= nextCatalogCheck)
            {
                nextCatalogCheck = now.AddMinutes(5);
                DateTime candidate = now.AddHours(-4); candidate = new DateTime(candidate.Year, candidate.Month, candidate.Day, candidate.Hour / 6 * 6, 0, 0, DateTimeKind.Utc);
                string found = "";
                for (int attempt = 0; attempt < 2; attempt++)
                {
                    string cycle = candidate.AddHours(-6 * attempt).ToString("yyyyMMddHH", CultureInfo.InvariantCulture);
                    int hour = (int)((now - CycleDate(cycle)).TotalHours / 3) * 3;
                    try { Index(cycle, hour, true); found = cycle; break; } catch (WebException) { } catch (IOException) { }
                }
                catalogSaved = found.Length == 0;
                if (found.Length == 0 && Directory.Exists(cache))
                    found = Directory.GetFiles(cache, "*.bin").Select(Path.GetFileName).Where(n => Regex.IsMatch(n, "^[0-9]{10}-[0-9]{3}-(10|850|500|250)\\.bin$"))
                        .Select(n => n.Substring(0, 10)).Where(c => RecentCycle(c, now)).OrderByDescending(c => c).FirstOrDefault() ?? "";
                if (found.Length == 0) { lastCycle = ""; throw new IOException("world-wind-network"); }
                lastCycle = found; nextCatalogCheck = now.AddMinutes(catalogSaved ? 5 : 30);
                Sweep();
            }
            if (lastCycle.Length == 0 || !RecentCycle(lastCycle, now)) throw new IOException("world-wind-network");
            DateTime run = CycleDate(lastCycle); int first = Math.Max(0, (int)((now - run).TotalHours / 3) * 3);
            int[] hours = Enumerable.Range(0, 9).Select(i => first + i * 3).ToArray();
            return Encoding.UTF8.GetBytes("{\"cycle\":\"" + lastCycle + "\",\"runAt\":" + (run - Epoch).TotalMilliseconds.ToString(CultureInfo.InvariantCulture)
                + ",\"hours\":[" + String.Join(",", hours.Select(h => h.ToString(CultureInfo.InvariantCulture))) + "],\"saved\":"
                + (catalogSaved ? "true" : "false") + ",\"step\":3,\"resolution\":1}");
        }
    }
    static bool RecentCycle(string cycle, DateTime now)
    {
        try { DateTime run = CycleDate(cycle); return run <= now && now - run < TimeSpan.FromHours(48); }
        catch (ArgumentException) { return false; }
    }
    void Sweep()
    {
        try
        {
            if (!Directory.Exists(cache)) return;
            var files = new DirectoryInfo(cache).GetFiles().Where(f => Regex.IsMatch(f.Name, "^[0-9]{10}-[0-9]{3}(-(10|850|500|250))?\\.(bin|idx)(\\.tmp)?$"))
                .OrderBy(f => f.LastWriteTimeUtc).ToList();
            long size = files.Sum(f => f.Length);
            foreach (var file in files) if (size > 128L * 1024 * 1024 || DateTime.UtcNow - file.LastWriteTimeUtc > TimeSpan.FromHours(72)) { size -= file.Length; file.Delete(); }
        }
        catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
    WorldWindGrib.Field FetchField(List<Record> records, string cycle, int hour, string variable, string level)
    {
        var matches = records.Where(record => record.Variable == variable && record.Level == level).ToArray();
        if (matches.Length != 1) throw new InvalidDataException("world-wind-index");
        Record r = matches[0]; if (r.Last < r.First || r.Last - r.First + 1 > 4 * 1024 * 1024) throw new InvalidDataException("world-wind-range");
        var field = WorldWindGrib.Decode(download(SourceUrl(cycle, hour), r.First, r.Last, 4 * 1024 * 1024));
        int category = variable == "TMP" ? 0 : variable == "PRES" ? 3 : 2;
        int parameter = variable == "UGRD" ? 2 : variable == "VGRD" ? 3 : 0;
        int surface = level == "surface" ? 1 : level.EndsWith("mb") ? 100 : 103;
        double expectedLevel = level == "surface" ? 0 : Double.Parse(level.Split(' ')[0], CultureInfo.InvariantCulture) * (surface == 100 ? 100 : 1);
        if (field.Run != CycleDate(cycle) || field.Hour != hour || field.Category != category || field.Parameter != parameter
            || field.Surface != surface || field.Level != expectedLevel) throw new InvalidDataException("world-wind-metadata");
        return field;
    }
    internal static byte[] Pack(string cycle, int hour, int level, float[] u, float[] v, float[] temperature, float[] pressure)
    {
        using (var memory = new MemoryStream()) using (var writer = new BinaryWriter(memory))
        {
            writer.Write(Encoding.ASCII.GetBytes("CDW1")); writer.Write(360); writer.Write(181); writer.Write(level);
            writer.Write((CycleDate(cycle) - Epoch).TotalMilliseconds); writer.Write((CycleDate(cycle).AddHours(hour) - Epoch).TotalMilliseconds);
            writer.Write((DateTime.UtcNow - Epoch).TotalMilliseconds);
            foreach (float[] values in new[] { u, v, temperature }) for (int i = 0; i < WorldWindGrib.Count; i++)
            {
                float value = values[i]; bool masked = level != 10 && (pressure == null || Single.IsNaN(pressure[i]) || pressure[i] < level * 100);
                if (values == temperature) value -= 273.15f;
                if (masked || Single.IsInfinity(value) || (values == temperature ? value < -120 || value > 70 : Math.Abs(value) > 200)) value = Single.NaN;
                writer.Write(value);
            }
            return memory.ToArray();
        }
    }
    internal static bool ValidFrame(byte[] data, string cycle, int hour, int level)
    {
        return data != null && data.Length == FrameBytes && Encoding.ASCII.GetString(data, 0, 4) == "CDW1"
            && BitConverter.ToInt32(data, 4) == 360 && BitConverter.ToInt32(data, 8) == 181 && BitConverter.ToInt32(data, 12) == level
            && BitConverter.ToDouble(data, 16) == (CycleDate(cycle) - Epoch).TotalMilliseconds
            && BitConverter.ToDouble(data, 24) == (CycleDate(cycle).AddHours(hour) - Epoch).TotalMilliseconds;
    }
    internal byte[] Frame(string cycle, int hour, int level, out bool cached)
    {
        DateTime run = CycleDate(cycle), now = DateTime.UtcNow;
        SourceUrl(cycle, hour);
        if (!(level == 10 || level == 850 || level == 500 || level == 250) || run > now || now - run >= TimeSpan.FromHours(48)) throw new ArgumentException("world-wind-query");
        lock (gate)
        {
            string key = cycle + "-" + hour.ToString("000") + "-" + level, file = Path.Combine(cache, key + ".bin");
            cached = false;
            try {
                if (File.Exists(file) && new FileInfo(file).Length == FrameBytes)
                { byte[] data = File.ReadAllBytes(file); if (ValidFrame(data, cycle, hour, level)) { cached = true; return data; } }
            } catch (IOException) { } catch (UnauthorizedAccessException) { }
            DateTime retry; if (failures.TryGetValue(key, out retry) && now < retry) throw new IOException("world-wind-retry");
            try
            {
                var records = ReadIndex(Index(cycle, hour), cycle); string at = level == 10 ? "10 m above ground" : level + " mb";
                var u = FetchField(records, cycle, hour, "UGRD", at); var v = FetchField(records, cycle, hour, "VGRD", at);
                var t = FetchField(records, cycle, hour, "TMP", level == 10 ? "2 m above ground" : at);
                var pressure = level == 10 ? null : FetchField(records, cycle, hour, "PRES", "surface");
                byte[] data = Pack(cycle, hour, level, u.Values, v.Values, t.Values, pressure == null ? null : pressure.Values);
                Save(file, data); Sweep(); failures.Remove(key); return data;
            }
            catch { if (failures.Count > 256) failures.Clear(); failures[key] = now.AddMinutes(5); throw; }
        }
    }
}
