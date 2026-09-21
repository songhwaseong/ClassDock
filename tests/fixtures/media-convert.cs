using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;

static class MediaConvertTest
{
    static void Require(bool ok, string message) { if (!ok) throw new Exception(message); }
    static ClassDockLauncher.MediaInputInfo Input(string video, string audio)
    {
        return ClassDockLauncher.ParseMediaInputInfo("  Duration: 00:00:02.00, start: 0.000\n"
            + "  Stream #0:0(eng): Video: " + video + "\n  Stream #0:1: Audio: " + audio);
    }
    static bool Run(string ffmpeg, string args)
    {
        return (bool)typeof(ClassDockLauncher).GetMethod("RunFfmpeg", BindingFlags.Static | BindingFlags.NonPublic)
            .Invoke(null, new object[] { ffmpeg, args, 20000 });
    }
    static string Hash(string ffmpeg, string file, string stream)
    {
        string hash = file + "." + stream + ".hash";
        Require(Run(ffmpeg, "-y -v error -i \"" + file + "\" -map 0:" + stream + ":0 -c copy -f hash \"" + hash + "\""), "hash failed");
        return File.ReadAllText(hash);
    }
    static void Main(string[] args)
    {
        var compatible = Input("h264 (High), yuv420p(tv, bt709), 128x128", "aac (LC), 48000 Hz, stereo");
        Require(compatible.CopyVideo && compatible.CopyAudio && compatible.DurationUs == 2000000, "compatible stream detection");
        Require(!Input("hevc (Rext), yuv444p10le, 1920x1080", "flac, 48000 Hz").CopyVideo, "HEVC 10-bit 4:4:4 must encode");
        Require(!Input("hevc (Main), yuv420p, 128x128", "ac3, 48000 Hz").CopyVideo, "HEVC must not be blindly remuxed");
        Require(!Input("mpeg4 (Simple Profile), yuv420p, 128x128", "aac (LC)").CopyVideo, "MP4 container support is not browser support");
        Require(!Input("h264 (High 10), yuv420p10le, 128x128", "aac (LC)").CopyVideo, "10-bit must encode");
        Require(!Input("h264 (High), yuv444p, 128x128", "aac (LC)").CopyVideo, "4:4:4 must encode");
        Require(!Input("h264 (High), yuv420p, 128x128 (attached pic)", "aac (LC)").CopyVideo, "cover art must not be blindly remuxed");
        Require(!ClassDockLauncher.ParseMediaInputInfo("unrecognized metadata").CopyVideo, "unknown must encode");
        var first = ClassDockLauncher.ParseMediaInputInfo("Stream #0:0[0x1](eng): Video: hevc (Main), yuv420p\nStream #0:1: Video: h264 (High), yuv420p\nStream #0:2: Audio: ac3\nStream #0:3: Audio: aac (LC)");
        Require(!first.CopyVideo && !first.CopyAudio, "must inspect first mapped streams only");
        Require(ClassDockLauncher.MediaConvertPlan(compatible)[0].Stage == "remux", "prefer lossless copy");
        var sound = Input("h264 (Main), yuv420p, 128x128", "ac3, 48000 Hz");
        Require(ClassDockLauncher.MediaConvertPlan(sound)[0].Stage == "copy", "audio-only conversion first");
        var incompatible = Input("mpeg4 (Simple Profile), yuv420p, 128x128", "aac (LC)");
        var attempts = new List<string>();
        bool ok = ClassDockLauncher.ExecuteMediaPlan(incompatible, delegate(string encoder) { return true; },
            delegate(ClassDockLauncher.MediaConvertAttempt attempt) {
                attempts.Add(attempt.Encoder);
                return attempt.Encoder == "libx264";
            }, delegate { return false; });
        Require(ok && attempts[0] == "h264_nvenc" && attempts[attempts.Count - 1] == "libx264", "GPU failure must reach CPU");
        attempts.Clear();
        ok = ClassDockLauncher.ExecuteMediaPlan(incompatible, delegate(string encoder) { return false; },
            delegate(ClassDockLauncher.MediaConvertAttempt attempt) { attempts.Add(attempt.Encoder); return true; }, delegate { return false; });
        Require(ok && attempts.Count == 1 && attempts[0] == "libx264", "unsupported GPU must be skipped");
        int runs = 0;
        ok = ClassDockLauncher.ExecuteMediaPlan(compatible, delegate(string encoder) { throw new Exception("unnecessary GPU probe"); },
            delegate(ClassDockLauncher.MediaConvertAttempt attempt) {
                runs++;
                Require(attempt.Encoder == "copy", "audio failure must preserve video");
                return !attempt.CopyAudio;
            }, delegate { return false; });
        Require(ok && runs == 2, "AAC copy failure must retry only audio");
        bool cancelled = false;
        runs = 0;
        ok = ClassDockLauncher.ExecuteMediaPlan(incompatible, delegate(string encoder) { return true; },
            delegate(ClassDockLauncher.MediaConvertAttempt attempt) { runs++; cancelled = true; return false; }, delegate { return cancelled; });
        Require(!ok && runs == 1, "cancel must prevent fallback");
        string command = ClassDockLauncher.MediaConvertArgs("in.mkv", "out.part", ClassDockLauncher.MediaConvertPlan(compatible)[0]);
        Require(command.Contains("-c:v copy") && command.Contains("-c:a copy") && command.Contains("-f mp4"), "remux command");

        if (args.Length > 0 && File.Exists(args[0]))
        {
            string ffmpeg = args[0];
            string folder = args[1];
            // Force unsupported GPUs to verify actual CPU fallback on every test machine.
            var support = (Dictionary<string, bool>)typeof(ClassDockLauncher).GetField("MediaHardwareSupport", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            foreach (string encoder in new string[] { "h264_nvenc", "h264_qsv", "h264_amf" })
                support[ffmpeg + "|" + encoder + "|" + File.GetLastWriteTimeUtc(ffmpeg).Ticks] = false;
            foreach (string kind in new string[] { "remux", "audio", "encode", "force" })
            {
                string input = Path.Combine(folder, kind + " 한글.mkv");
                string output = input + ".mp4.part";
                string videoCodec = kind == "encode" ? "mpeg4" : "libx264";
                string audioCodec = kind == "audio" ? "ac3" : "aac";
                Require(Run(ffmpeg, "-y -v error -f lavfi -i testsrc2=s=128x128:r=10 -f lavfi -i sine=frequency=440:sample_rate=48000"
                    + " -t 1 -c:v " + videoCodec + " -pix_fmt yuv420p -c:a " + audioCodec + " \"" + input + "\""), "fixture failed: " + kind);
                var job = new MediaConvertJob();
                Require(ClassDockLauncher.ConvertMediaFile(ffmpeg, input, output, job, kind == "force"), "conversion failed: " + kind);
                Require(job.Stage == (kind == "audio" ? "copy" : kind == "force" ? "encode" : kind), "wrong actual stage: " + kind + ": " + job.Stage);
                Require(Run(ffmpeg, "-v error -xerror -i \"" + output + "\" -f null -"), "output must decode: " + kind);
                if (kind != "encode" && kind != "force") Require(Hash(ffmpeg, input, "v") == Hash(ffmpeg, output, "v"), "video packets changed during copy: " + kind);
                if (kind != "audio") Require(Hash(ffmpeg, input, "a") == Hash(ffmpeg, output, "a"), "AAC packets changed during copy: " + kind);
            }

            // 문서에 담을 짧은 영상: 세로 1080x1920 → 긴 변 1280, 앞 2초만, 위치 메타데이터는 지운다.
            string tall = Path.Combine(folder, "세로 영상.mov");
            Require(Run(ffmpeg, "-y -v error -f lavfi -i testsrc2=s=1080x1920:r=30 -f lavfi -i sine=frequency=440:sample_rate=48000"
                + " -t 3 -c:v libx264 -pix_fmt yuv420p -c:a aac -metadata location=+37.5665+126.9780/ -metadata title=secret \"" + tall + "\""), "fixture failed: tall");
            long sourceUs;
            byte[] small = ClassDockLauncher.ShrinkMediaBytes(ffmpeg, File.ReadAllBytes(tall), 1280, 2, out sourceUs);
            Require(sourceUs >= 2900000 && sourceUs <= 3100000, "source duration must be reported: " + sourceUs);
            string shrunk = Path.Combine(folder, "shrunk.mp4");
            File.WriteAllBytes(shrunk, small);
            string info;
            object[] call = new object[] { ffmpeg, "-hide_banner -nostdin -i \"" + shrunk + "\"", 20000, null };
            typeof(ClassDockLauncher).GetMethod("ReadFfmpegInfo", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, call);
            info = (string)call[3];
            var parsed = ClassDockLauncher.ParseMediaInputInfo(info);
            Require(parsed.CopyVideo && parsed.CopyAudio, "shrunk output must be browser H.264/AAC: " + info);
            Require(parsed.DurationUs > 1500000 && parsed.DurationUs <= 2200000, "must be trimmed to 2s: " + parsed.DurationUs);
            Require(info.Contains("720x1280"), "portrait must keep ratio with long side 1280: " + info);
            Require(info.IndexOf("location", StringComparison.OrdinalIgnoreCase) < 0 && info.IndexOf("secret", StringComparison.Ordinal) < 0,
                "metadata (GPS location) must be stripped: " + info);
        }
        string shrinkArgs = ClassDockLauncher.MediaShrinkArgs("in.bin", "out.mp4", "libx264", 99999, 99999);
        Require(shrinkArgs.Contains("min(1280,iw)") && shrinkArgs.Contains("-t 600") && shrinkArgs.Contains("-map_metadata -1"), "shrink limits: " + shrinkArgs);
        Require(ClassDockLauncher.MediaShrinkPlan().TrueForAll(a => a.Encoder != "copy"), "shrink must always re-encode");
        Console.WriteLine("Media conversion checks passed");
    }
}