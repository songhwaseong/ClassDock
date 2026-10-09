"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Compile the actual C# cache/scheduler with a blocked network stub. No app or browser is opened.
test("C# 타일 캐시는 즉시 반환·중복 갱신 방지·실패 대기·비우기를 보장한다", { timeout:30000 }, t => {
  const csc = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
  if (process.platform !== "win32" || !fs.existsSync(csc)){ t.skip("requires the Windows .NET Framework compiler"); return; }
  const source = fs.readFileSync(path.join(__dirname, "../desktop/launcher.cs"), "utf8");
  let cache = source.slice(source.indexOf("    static readonly string[] TileProxyHosts"), source.indexOf("    /* ===== 장소 이름 검색(지오코딩)"));
  cache = cache.replace(/static readonly string TileCacheDir = Path\.Combine\([\s\S]*?\);/, 'static readonly string TileCacheDir = Environment.GetEnvironmentVariable("CLASSDOCK_TILE_TEST_DIR");');
  const proxy = source.slice(source.indexOf("    static bool TryProxyMapTile("), source.indexOf("    static bool TryReadMapTileRemote("));
  const harness = `
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Globalization;
using System.Collections.Generic;
using System.Threading;
class TileCacheTest {
${cache}
${proxy}
    static ManualResetEvent Started = new ManualResetEvent(false);
    static ManualResetEvent Release = new ManualResetEvent(false);
    static int Calls;
    static bool Fail;
    static bool TryReadMapTileRemote(string url, out byte[] data, out string mime) {
        Interlocked.Increment(ref Calls);
        Started.Set();
        Check(Release.WaitOne(5000), "network stub was not released");
        data = new byte[] {9}; mime = "image/png";
        return !Fail;
    }
    static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
    static void Idle() {
        Check(SpinWait.SpinUntil(delegate { lock (TileRefreshLock) return TileRefreshPending.Count == 0; }, 3000), "refresh did not finish");
    }
    static void Seed(string url) {
        WriteCachedTile(url, new byte[] {1,2}, "image/webp");
        File.SetLastWriteTimeUtc(TileCacheFile(TileCacheKey(url), ".webp"), DateTime.UtcNow.AddDays(-8));
        lock (TileCacheLock) TileCache.Clear();
        Started.Reset(); Release.Reset(); Calls = 0; Fail = false;
    }
    static void ReadOld(string url) {
        byte[] data; string mime;
        Check(TryProxyMapTile(url, out data, out mime) && data.SequenceEqual(new byte[] {1,2}) && mime == "image/webp", "stored tile or MIME was lost");
        Check(TileProxyMaxAge(url, data) == 0, "stale response must not stay fresh in the browser");
    }
    static void Main() {
        string url = "https://tile.waymarkedtrails.org/cycling/13/1/2.png";
        Seed(url);
        DateTime begin = DateTime.UtcNow;
        ReadOld(url);
        Check((DateTime.UtcNow - begin).TotalMilliseconds < 1000, "stored tile waited for the network");
        Check(Started.WaitOne(1000), "refresh did not start");
        for (int i = 0; i < 20; i++) ReadOld(url);
        Check(Calls == 1, "refresh was not deduplicated");
        Release.Set(); Idle();
        byte[] data; string mime;
        Check(TryProxyMapTile(url, out data, out mime) && data[0] == 9 && mime == "image/png", "refresh not saved");
        Check(Calls == 1 && TileProxyMaxAge(url, data) == 600, "fresh cache requested the network");
        Console.WriteLine("PASS immediate cache, one refresh, MIME and browser cache age");

        Seed(url); Fail = true; Release.Set();
        ReadOld(url); Idle();
        for (int i = 0; i < 20; i++) ReadOld(url);
        Check(Calls == 1, "failed refresh did not wait before retry");
        DateTime stamp;
        Check(TryReadCachedTile(url, out data, out mime, out stamp) && !IsTileCacheFresh(stamp), "failed refresh changed cache age");
        Console.WriteLine("PASS failed refresh retains cache and pauses retries");

        lock (TileRefreshLock) TileRefreshAfter.Clear();
        Seed(url); ReadOld(url);
        Check(Started.WaitOne(1000), "refresh did not start before clear");
        Check(ClearTileCache(), "cache clear failed");
        Release.Set(); Idle();
        Check(!TryReadCachedTile(url, out data, out mime, out stamp) && TileCache.Count == 0, "old refresh restored a cleared cache");
        Check(!TryProxyMapTile("https://untrusted.example/tile.png", out data, out mime), "untrusted host allowed");
        Console.WriteLine("PASS in-flight refresh cannot undo cache clear");
    }
}`;
  const tempRoot = path.resolve(__dirname, "../.tmp");
  fs.mkdirSync(tempRoot, { recursive:true });
  const dir = fs.mkdtempSync(path.join(tempRoot, "classdock-tile-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), tempRoot);
    fs.rmSync(dir, { recursive:true, force:true });
  });
  const code = path.join(dir, "cache.cs"), exe = path.join(dir, "cache.exe");
  fs.writeFileSync(code, harness, "utf8");
  const compile = spawnSync(csc, ["/nologo", "/target:exe", "/out:" + exe, code], { encoding:"utf8", windowsHide:true, timeout:15000 });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  const run = spawnSync(exe, [], { encoding:"utf8", windowsHide:true, timeout:15000, env:{ ...process.env, CLASSDOCK_TILE_TEST_DIR:path.join(dir, "tiles") } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal((run.stdout.match(/PASS /g) || []).length, 3);
});
