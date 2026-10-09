// Shareable run diagnostics for improving entry speed and reliability.
// Records timings, counts, control classes/positions, known COSTAR labels and
// masked step messages. It never records customer values typed into or read
// from COSTAR fields. Observation only: it does not click, type or change COSTAR.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace TempeCostar {
    public sealed class StageStat {
        public string Stage;
        public long StartMs, EndMs, DurationMs;
        public bool Completed;
        public int FullSnapshots, GridSnapshots, PopupSnapshots, TextReads;
        public int Clicks, Keys, Writes, FocusWaits, ReadyWaits, IdleWaits, Persists;
        public long SnapshotMs, PauseMs, FocusWaitMs, CommitWaitMs, SetTextMs, ReadBackMs, ReadyWaitMs, IdleWaitMs, PersistMs;
        public long CostarBusyMs, CostarBusyMaxMs;
    }

    public sealed class WaitStat {
        public string Name, Stage, Result;
        public long AtMs, Ms;
        public int Iterations;
    }

    public sealed class DiagEvent {
        public long AtMs, CostarBusyMs;
        public string Kind, Stage, Detail;
    }

    public sealed class LabelPosition {
        public string Label;
        public int X, Y, W, H;
    }

    public sealed class BusyPeriod {
        public long AtMs, Ms;
    }

    public sealed class ProbeStats {
        public int Samples, Timeouts, Under5Ms, Under50Ms, Under200Ms, Under1000Ms, Over1000Ms;
        public long MaxMs, TotalMs;
        public List<BusyPeriod> BusyPeriods = new List<BusyPeriod>();
    }

    public sealed class RunReport {
        public int Schema;
        public string Version, RunId, Kind, OrderRef, StartedLocal, Outcome, Category, StopMessage, StopStage, LayoutHash;
        public long TotalMs, OpenNewMs, BetweenStagesMs;
        public int Writes, Snapshots, GridSnapshots, TextReads, SkippedQuantities;
        public int SkippedReads, LateReads, HeaderReads, HeaderHits, SaveCount;
        public long SaveCopyMs, SaveJsonMs, SaveProtectMs, SaveWriteMs, SaveReplaceMs;
        public StageStat BetweenStages;
        public long SnapshotMs;
        public List<StageStat> Stages = new List<StageStat>();
        public List<WaitStat> Waits = new List<WaitStat>();
        public List<DiagEvent> Events = new List<DiagEvent>();
        public List<LabelPosition> Layout = new List<LabelPosition>();
        public Dictionary<string, string> Env = new Dictionary<string, string>();
        public ProbeStats Probe = new ProbeStats();
    }

    // Masks phone-like numbers and email addresses in free text. Order IDs
    // (TTW + 7 digits), MJC references and SKUs are kept.
    internal static class Sanitize {
        static readonly Regex Email = new Regex(@"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}");
        static readonly Regex Number = new Regex(@"\+?\d[\d ()-]{6,}\d");
        static readonly Regex ControlChars = new Regex(@"[\x00-\x1f\x7f]");
        // Window titles of other applications (browser tabs, email) can name customers.
        static readonly Regex OtherWindowTitle = new Regex(@"Blocking/foreground window: .*? \(PID");
        internal static string Text(string value, int limit) {
            if (String.IsNullOrEmpty(value)) return "";
            string text = ControlChars.Replace(value, " ");
            text = OtherWindowTitle.Replace(text, "Blocking/foreground window: [title removed] (PID");
            text = Email.Replace(text, "[email]");
            text = Number.Replace(text, "[number]");
            return text.Length > limit ? text.Substring(0, limit) + "..." : text;
        }
    }

    internal static class StopCategory {
        internal static string Of(string message, bool cancelled) {
            if (cancelled) return "user_stop";
            string m = (message ?? "").ToUpperInvariant();
            if (m.Contains("STOPPED BY YOU")) return "user_stop";
            if (m.Contains("LOST FOCUS OR OPENED ANOTHER SCREEN") || m.Contains("OPENED ANOTHER SCREEN OR LOST FOCUS")) return "focus_stolen";
            if (m.Contains("DID NOT FOCUS THE EXPECTED FIELD") || m.Contains("DID NOT KEEP FOCUS")) return "focus_failed";
            if (m.Contains("DID NOT COMMIT THE FIELD") || m.Contains("LOST FOCUS BEFORE VALIDATION")) return "commit_failed";
            if (m.Contains("EMPTY REPAIR ORDER") || m.Contains("DIRECT ENTRY MUST START") || m.Contains("ALREADY CONTAIN")) return "repair_order_not_empty";
            if (m.Contains("CUSTOMER") && (m.Contains("POPUP") || m.Contains("LOOKUP") || m.Contains("SEARCH"))) return "customer_lookup";
            if (m.Contains("DID NOT FINISH LOADING")) return "item_load";
            if (m.Contains("DET ")) return "det_template";
            if (m.Contains("VERIFICATION FAILED") || m.Contains("DID NOT SETTLE") || m.Contains("NO LONGER MATCHES") || m.Contains("WAS EDITED BETWEEN")) return "verification";
            if (m.Contains("FINAL")) return "final_check";
            if (m.Contains("LAYOUT IS UNFAMILIAR") || m.Contains("COULD NOT UNIQUELY LOCATE")) return "layout";
            if (m.Contains("DID NOT BECOME READY") || m.Contains("STILL BUSY") || m.Contains("STILL LOADING") || m.Contains("DID NOT FINISH OPENING")) return "costar_busy";
            if (m.Contains("REPAIR ORDER") && (m.Contains("CLOSED") || m.Contains("CHANGED"))) return "repair_order_changed";
            return "other";
        }
    }

    // Sends WM_NULL (a no-op message) to the Repair Order window about every
    // 50 ms on a separate thread and measures how long COSTAR's UI thread takes
    // to answer. It never blocks or delays the entry thread.
    internal sealed class IdleProber {
        [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", SetLastError = true)]
        static extern IntPtr SendNull(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
        readonly object gate = new object();
        readonly IntPtr target;
        readonly Stopwatch clock;
        readonly ProbeStats stats = new ProbeStats();
        volatile bool stop;
        long outstandingSince = -1;

        internal IdleProber(IntPtr window, Stopwatch runClock) {
            target = window;
            clock = runClock;
            var thread = new Thread(Loop);
            thread.IsBackground = true;
            thread.Name = "COSTAR responsiveness probe";
            thread.Start();
        }

        void Loop() {
            try {
                while (!stop && Native.IsWindow(target)) {
                    long start = clock.ElapsedMilliseconds;
                    lock (gate) outstandingSince = start;
                    UIntPtr result;
                    IntPtr answered = SendNull(target, 0, UIntPtr.Zero, IntPtr.Zero, 0x0002, 2000, out result); // SMTO_ABORTIFHUNG
                    long ms = clock.ElapsedMilliseconds - start;
                    lock (gate) {
                        outstandingSince = -1;
                        if (stop) return;
                        stats.Samples++;
                        stats.TotalMs += ms;
                        if (ms > stats.MaxMs) stats.MaxMs = ms;
                        if (answered == IntPtr.Zero) stats.Timeouts++;
                        if (ms < 5) stats.Under5Ms++;
                        else if (ms < 50) stats.Under50Ms++;
                        else if (ms < 200) stats.Under200Ms++;
                        else if (ms < 1000) stats.Under1000Ms++;
                        else stats.Over1000Ms++;
                        if (ms >= 100 && stats.BusyPeriods.Count < 500) stats.BusyPeriods.Add(new BusyPeriod { AtMs = start, Ms = ms });
                    }
                    Thread.Sleep(50);
                }
            } catch {
                // Diagnostics must never affect entry.
            }
        }

        internal long OutstandingMs(long now) {
            lock (gate) return outstandingSince < 0 ? 0 : Math.Max(0, now - outstandingSince);
        }

        internal ProbeStats StopAndRead() {
            lock (gate) {
                stop = true;
                return stats;
            }
        }
    }

    internal sealed class WaitTimer {
        readonly RunDiagnostics owner;
        readonly string name;
        readonly long start;
        int iterations;
        string result = "stopped";
        internal WaitTimer(RunDiagnostics diagnostics, string waitName) {
            owner = diagnostics;
            name = waitName;
            start = diagnostics.Now;
        }
        internal void Tick() { iterations++; }
        internal void Done(string outcome) { result = outcome; }
        internal void End() { owner.AddWait(name, start, iterations, result); }
    }

    internal sealed class RunDiagnostics {
        internal const int Schema = 1;
        [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr window);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref uint size);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

        internal static string Root {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TempeCostarAutofill", "Diagnostics"); }
        }

        readonly Stopwatch clock = Stopwatch.StartNew();
        readonly RunReport report = new RunReport();
        readonly StageStat outside = new StageStat { Stage = "(outside named stages)" };
        readonly IntPtr root;
        readonly uint pid;
        readonly IdleProber prober;
        StageStat stage;
        bool finished;
        IntPtr lastLostFront = IntPtr.Zero;
        long lastLostAt = -10000;
        int lostEvents;

        internal RunDiagnostics(string runId, string orderRef, IntPtr window, uint processId) {
            root = window;
            pid = processId;
            report.Schema = Schema;
            report.Version = AutofillForm.Version;
            report.RunId = runId;
            report.OrderRef = Sanitize.Text(orderRef, 40);
            report.StartedLocal = DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture);
            report.Kind = "unknown";
            report.Outcome = "running";
            report.OpenNewMs = -1;
            CaptureEnvironment();
            prober = new IdleProber(window, clock);
        }

        internal long Now { get { return clock.ElapsedMilliseconds; } }
        internal RunReport Report { get { return report; } }
        internal string Kind { set { report.Kind = value; } }
        internal string RunId { get { return report.RunId; } }
        internal long OpenNewMs { set { report.OpenNewMs = value; } }
        StageStat Current { get { return stage ?? outside; } }

        internal void BeginStage(string name) {
            EndStage(false);
            stage = new StageStat { Stage = Sanitize.Text(name, 80), StartMs = Now };
        }

        internal void EndStage(bool completed) {
            if (stage == null) return;
            stage.EndMs = Now;
            stage.DurationMs = stage.EndMs - stage.StartMs;
            stage.Completed = completed;
            if (report.Stages.Count < 300) report.Stages.Add(stage);
            stage = null;
        }

        internal void Snapshot(string kind, long ms, int reads) {
            var s = Current;
            if (kind == "grid") s.GridSnapshots++;
            else if (kind == "popup") s.PopupSnapshots++;
            else s.FullSnapshots++;
            s.SnapshotMs += ms;
            s.TextReads += reads;
        }

        internal void Pause(long ms) { Current.PauseMs += ms; }
        internal void Click() { Current.Clicks++; }
        internal void Key() { Current.Keys++; }

        internal void Write(long setMs, long readBackMs) {
            var s = Current;
            s.Writes++;
            s.SetTextMs += setMs;
            s.ReadBackMs += readBackMs;
        }

        internal void FocusWait(long ms) {
            var s = Current;
            s.FocusWaits++;
            s.FocusWaitMs += ms;
        }

        internal void IdleWait(long ms) {
            var s = Current;
            s.IdleWaits++;
            s.IdleWaitMs += ms;
        }

        internal void Persist(long ms) {
            var s = Current;
            s.Persists++;
            s.PersistMs += ms;
        }

        internal void ReadyWait(long ms) {
            var s = Current;
            s.ReadyWaits++;
            s.ReadyWaitMs += ms;
        }

        internal void Commit(long ms, string result) {
            Current.CommitWaitMs += ms;
            if (result != "moved") EventRaw("commit_" + result, ms + " ms after Tab");
        }

        internal WaitTimer Wait(string name) { return new WaitTimer(this, name); }

        internal void AddWait(string name, long startMs, int iterations, string result) {
            if (report.Waits.Count >= 1000) return;
            report.Waits.Add(new WaitStat { Name = name, Stage = Current.Stage, AtMs = startMs, Ms = Now - startMs, Iterations = iterations, Result = result });
        }

        // Free text from step messages: masked.
        internal void Step(string text) { Add("step", Sanitize.Text(text, 240)); }

        // Text built by this program from codes, handles and positions only.
        internal void EventRaw(string kind, string detail) { Add(kind, detail ?? ""); }

        void Add(string kind, string detail) {
            if (report.Events.Count >= 800) return;
            report.Events.Add(new DiagEvent { AtMs = Now, Kind = kind, Stage = Current.Stage, Detail = detail.Length > 600 ? detail.Substring(0, 600) + "..." : detail, CostarBusyMs = prober.OutstandingMs(Now) });
        }

        internal void FocusFailed(string expected, List<string> trace) {
            EventRaw("focus_failed", "expected " + expected + " | focus seen: " + (trace.Count == 0 ? "(no change)" : String.Join(" ; ", trace)));
        }

        internal void ForegroundLost(IntPtr front, bool repairOrderEnabled) {
            try {
                long now = Now;
                if (lostEvents >= 30 || (front == lastLostFront && now - lastLostAt < 1000)) return;
                lastLostFront = front;
                lastLostAt = now;
                lostEvents++;
                string detail;
                if (front == IntPtr.Zero) detail = "no foreground window";
                else {
                    uint frontPid = Native.Pid(front);
                    ProcessIdentity identity;
                    string process = LocalProcess.TryRead((int)frontPid, out identity) ? identity.Name : "other-session-or-protected";
                    bool costar = frontPid == pid;
                    detail = "process=" + process + " class=" + Native.Class(front) +
                        (costar ? " title=" + Sanitize.Text(Native.Caption(front), 60) : "") +
                        " ownedByRepairOrder=" + OwnedBy(front, root) + " repairOrderEnabled=" + repairOrderEnabled;
                }
                EventRaw("foreground_lost", detail);
            } catch (Exception e) {
                EventRaw("foreground_lost", "unreadable: " + e.GetType().Name);
            }
        }

        static bool OwnedBy(IntPtr window, IntPtr owner) {
            var current = window;
            for (int i = 0; i < 16 && current != IntPtr.Zero; i++) {
                current = Native.GetWindow(current, 4); // GW_OWNER
                if (current == owner) return true;
            }
            return false;
        }

        // Popups are summarised. Label text is kept only for message-box-like
        // windows (two labels or fewer); numbers and emails are masked.
        internal void Popup(IntPtr window, List<ControlInfo> controls) {
            try {
                var buttons = controls.Where(c => c.Visible && c.TextState == "read" && c.Class.IndexOf("BUTTON", StringComparison.OrdinalIgnoreCase) >= 0)
                    .Select(c => Sanitize.Text(c.Text, 30)).Take(8).ToList();
                var labels = controls.Where(c => c.Static && c.TextState == "read" && !String.IsNullOrWhiteSpace(c.Text)).ToList();
                string text = labels.Count <= 2 ? String.Join(" | ", labels.Select(c => Sanitize.Text(c.Text, 100))) : labels.Count + " labels (not recorded)";
                EventRaw("popup", "class=" + Native.Class(window) + " title=" + Sanitize.Text(Native.Caption(window), 60) +
                    " controls=" + controls.Count + " buttons=[" + String.Join("|", buttons) + "] text=[" + text + "]");
                // Shape only: control kind, position, size and enabled state. Enough to build
                // a recogniser for an unfamiliar popup (for example a two-account list).
                var shape = controls.Where(c => c.RelativeBounds != null).OrderBy(c => c.Y).ThenBy(c => c.X).Take(28)
                    .Select(c => ShapeCode(c.Class) + c.X + "," + c.Y + "," + c.W + "x" + c.H + (c.Enabled ? "" : "-"));
                EventRaw("popup_layout", String.Join(";", shape));
            } catch {
                // Diagnostics must not hide the original stop reason.
            }
        }

        // Records where known COSTAR labels sit and a structural hash of the
        // first full snapshot. No field values are included.
        // A plain environment detail for the run report (for example the COSTAR branch).
        internal void SetEnv(string key, string value) { try { report.Env[key] = value ?? ""; } catch (Exception) { } }
        internal void Layout(List<ControlInfo> snapshot) {
            try {
                if (snapshot == null || report.LayoutHash != null) return;
                string[] known = { "MOBILE PH", "EMAIL", "PO#", "COMMENT", "ITEM", "DESCRIPTION", "QTY OR HRS", "NET", "LIST", "TAX IN", "SHIP VIA", "CONTACT", "BUS PH", "SHIPPING INSTRUCTIONS" };
                var structure = new StringBuilder();
                foreach (var c in snapshot.OrderBy(x => x.Y).ThenBy(x => x.X)) {
                    if (!c.Static || c.TextState != "read") continue;
                    string label = Order.Norm(c.Text);
                    bool account = label.StartsWith("ACCOUNT#", StringComparison.Ordinal) && label.EndsWith("NAME", StringComparison.Ordinal);
                    if ((account || known.Contains(label)) && report.Layout.Count < 40) {
                        report.Layout.Add(new LabelPosition { Label = account ? "ACCOUNT#/NAME" : label, X = c.X, Y = c.Y, W = c.W, H = c.H });
                        structure.Append(account ? "ACCOUNT#/NAME" : label).Append('@').Append(c.X).Append(',').Append(c.Y).Append(';');
                    }
                }
                report.LayoutHash = Wire.Hash(Encoding.UTF8.GetBytes(structure.ToString())).Substring(0, 16);
                report.Env["controlsAtStart"] = snapshot.Count.ToString(CultureInfo.InvariantCulture);
                var classes = snapshot.Select(c => c.Class).Distinct().OrderBy(c => c).Take(12);
                report.Env["controlClasses"] = String.Join(" ", classes);
            } catch {
                // Diagnostics must not affect entry.
            }
        }

        static string ShapeCode(string windowClass) {
            string c = windowClass ?? "";
            if (c.IndexOf("EDIT", StringComparison.OrdinalIgnoreCase) >= 0) return "E";
            if (c.IndexOf("STATIC", StringComparison.OrdinalIgnoreCase) >= 0) return "S";
            if (c.IndexOf("BUTTON", StringComparison.OrdinalIgnoreCase) >= 0) return "B";
            if (c.IndexOf("LIST", StringComparison.OrdinalIgnoreCase) >= 0) return "L";
            if (c.IndexOf("SCROLLBAR", StringComparison.OrdinalIgnoreCase) >= 0) return "V";
            if (c.IndexOf("COMBO", StringComparison.OrdinalIgnoreCase) >= 0) return "C";
            return "W";
        }

        internal static string KindOf(string windowClass) {
            string c = windowClass ?? "";
            if (c.IndexOf("EDIT", StringComparison.OrdinalIgnoreCase) >= 0) return "EDIT";
            if (c.IndexOf("STATIC", StringComparison.OrdinalIgnoreCase) >= 0) return "STATIC";
            if (c.IndexOf("BUTTON", StringComparison.OrdinalIgnoreCase) >= 0) return "BUTTON";
            return "OTHER";
        }

        // Read-plan counters: text reads avoided, reads the plan missed (fetched late),
        // and header-cache use. LateReads should stay at or near zero.
        internal void Reads(int skipped, int late, int headerReads, int headerHits) {
            report.SkippedReads = skipped; report.LateReads = late; report.HeaderReads = headerReads; report.HeaderHits = headerHits;
        }

        // Where checkpoint saves spend their time: copying the checkpoint, turning the
        // journal into JSON, encrypting it (DPAPI), writing the temp file, replacing the file.
        internal void SaveParts(long copy, long json, long protect, long write, long replace) {
            report.SaveCount++; report.SaveCopyMs += copy; report.SaveJsonMs += json; report.SaveProtectMs += protect;
            report.SaveWriteMs += write; report.SaveReplaceMs += replace;
        }

        internal void Completed() {
            if (report.Outcome == "running") {
                report.Outcome = "completed";
                report.Category = "ok";
            }
        }

        internal void Stopped(Exception error) {
            if (report.Outcome != "running" || error == null) return;
            bool cancelled = error is OperationCanceledException;
            // Trying an open Repair Order that turns out to hold another job is a check, not a
            // failure: the fill then opens a fresh order. Counted separately.
            report.Outcome = cancelled ? "cancelled" : error is RepairOrderInUseException ? "probe" : "stopped";
            report.StopMessage = Sanitize.Text(error.Message, 300);
            // A timed stage closes in its own finally block before the error reaches
            // the run's handler, so use the last unfinished stage when one exists.
            var last = report.Stages.Count > 0 ? report.Stages[report.Stages.Count - 1] : null;
            report.StopStage = stage != null ? stage.Stage : (last != null && !last.Completed ? last.Stage : outside.Stage);
            report.Category = StopCategory.Of(error.Message, cancelled);
        }

        internal void Finish(long totalMs, int writes, int snapshots, int gridSnapshots, int textReads, int skippedQuantities, long snapshotMs) {
            if (finished) return;
            finished = true;
            EndStage(report.Outcome == "completed");
            if (report.Outcome == "running") {
                report.Outcome = "not-completed";
                report.Category = "not_started_or_unknown";
            }
            report.TotalMs = totalMs;
            report.Writes = writes;
            report.Snapshots = snapshots;
            report.GridSnapshots = gridSnapshots;
            report.TextReads = textReads;
            report.SkippedQuantities = skippedQuantities;
            report.SnapshotMs = snapshotMs;
            report.BetweenStages = outside;
            report.BetweenStagesMs = Math.Max(0, totalMs - report.Stages.Sum(s => s.DurationMs));
            report.Probe = prober.StopAndRead();
            foreach (var s in report.Stages) {
                long busy = 0, max = 0;
                foreach (var b in report.Probe.BusyPeriods) {
                    long overlapStart = Math.Max(s.StartMs, b.AtMs), overlapEnd = Math.Min(s.EndMs, b.AtMs + b.Ms);
                    if (overlapEnd > overlapStart) {
                        busy += overlapEnd - overlapStart;
                        if (b.Ms > max) max = b.Ms;
                    }
                }
                s.CostarBusyMs = busy;
                s.CostarBusyMaxMs = max;
            }
        }

        // Writes diagnostics.json beside the full local report and a copy to
        // the shareable Diagnostics folder used by Save diagnostics.
        internal void Save(string folder) {
            string json = Wire.Json(report);
            File.WriteAllText(Path.Combine(folder, "diagnostics.json"), json, new UTF8Encoding(false));
            Directory.CreateDirectory(Root);
            File.WriteAllText(Path.Combine(Root, report.RunId + ".json"), json, new UTF8Encoding(false));
        }

        void CaptureEnvironment() {
            var e = report.Env;
            Try(e, "os", delegate { return Environment.OSVersion.VersionString; });
            Try(e, "helper64Bit", delegate { return Environment.Is64BitProcess.ToString(); });
            Try(e, "remoteSession", delegate { return SystemInformation.TerminalServerSession.ToString(); });
            Try(e, "primaryScreen", delegate { var b = Screen.PrimaryScreen.Bounds; return b.Width + "x" + b.Height; });
            Try(e, "virtualScreen", delegate { var b = SystemInformation.VirtualScreen; return b.Width + "x" + b.Height; });
            Try(e, "dpi", delegate { using (var g = Graphics.FromHwnd(IntPtr.Zero)) return g.DpiX.ToString(CultureInfo.InvariantCulture); });
            Try(e, "repairOrderWindow", delegate {
                Native.Rect r;
                return Native.GetWindowRect(root, out r) ? (r.Right - r.Left) + "x" + (r.Bottom - r.Top) + " at " + r.Left + "," + r.Top : "unreadable";
            });
            Try(e, "repairOrderMaximized", delegate { return IsZoomed(root).ToString(); });
            Try(e, "costarVersion", CostarVersion);
        }

        static void Try(Dictionary<string, string> target, string key, Func<string> read) {
            try { target[key] = read(); }
            catch (Exception ex) { target[key] = "unreadable: " + ex.GetType().Name; }
        }

        string CostarVersion() {
            IntPtr handle = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
            if (handle == IntPtr.Zero) return "unreadable";
            try {
                var path = new StringBuilder(2048);
                uint size = (uint)path.Capacity;
                if (!QueryFullProcessImageName(handle, 0, path, ref size)) return "unreadable";
                var info = FileVersionInfo.GetVersionInfo(path.ToString());
                return (info.FileVersion ?? "") + " / " + (info.ProductVersion ?? "") + " / " +
                    File.GetLastWriteTimeUtc(path.ToString()).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            } finally {
                CloseHandle(handle);
            }
        }
    }

    // Day log: what happens outside a single entry run. Orders loaded, refused or queued,
    // fills started and finished, mobile jobs picked up and finished, desk connection
    // drops, stops, crashes, memory after each job, and notes you type. One masked JSON
    // line per event, one file per day, next to the run diagnostics. Never throws.
    // The helper's own memory and CPU. Sampled every 5 s for the window's status line and
    // written to the day log every 5 minutes and after each job, so lag and memory growth
    // show up in the end-of-day report as numbers.
    internal static class PerfMonitor {
        [DllImport("user32.dll")] static extern int GetGuiResources(IntPtr process, int flags);
        static TimeSpan lastCpu, loggedCpu;
        static DateTime lastAt = DateTime.MinValue, loggedAt = DateTime.MinValue;
        internal static volatile string Line = "";
        static string Read(out double cpuNow, bool forLog, ref double cpuSinceLog) {
            cpuNow = 0;
            using (var p = Process.GetCurrentProcess()) {
                DateTime now = DateTime.UtcNow; TimeSpan cpu = p.TotalProcessorTime;
                double cores = Math.Max(1, Environment.ProcessorCount);
                if (lastAt != DateTime.MinValue) cpuNow = (cpu - lastCpu).TotalMilliseconds / Math.Max(1, (now - lastAt).TotalMilliseconds) / cores * 100;
                if (forLog && loggedAt != DateTime.MinValue) cpuSinceLog = (cpu - loggedCpu).TotalMilliseconds / Math.Max(1, (now - loggedAt).TotalMilliseconds) / cores * 100;
                lastCpu = cpu; lastAt = now;
                if (forLog) { loggedCpu = cpu; loggedAt = now; }
                long ws = p.WorkingSet64 / 1048576, priv = p.PrivateMemorySize64 / 1048576, heap = GC.GetTotalMemory(false) / 1048576;
                int gdi = 0, user = 0;
                try { gdi = GetGuiResources(p.Handle, 0); user = GetGuiResources(p.Handle, 1); } catch (Exception) { }
                return "ws=" + ws + " private=" + priv + " heap=" + heap + " handles=" + p.HandleCount + " gdi=" + gdi + " user=" + user + " threads=" + p.Threads.Count;
            }
        }
        internal static void Sample() {
            try {
                double cpuNow, cpuSinceLog = 0;
                bool log = (DateTime.UtcNow - loggedAt).TotalMinutes >= 5;
                string detail = Read(out cpuNow, log, ref cpuSinceLog);
                using (var p = Process.GetCurrentProcess()) Line = "Helper " + (p.WorkingSet64 / 1048576) + " MB, CPU " + cpuNow.ToString("0.0", CultureInfo.InvariantCulture) + "%";
                if (log) AppLog.Note("perf", detail + " cpu=" + cpuSinceLog.ToString("0.0", CultureInfo.InvariantCulture));
            } catch (Exception) { }
        }
        // After each job: memory and handles right after the work (CPU is in the 5-minute samples).
        internal static void AfterJob(string run) {
            try { double cpuNow, ignored = 0; AppLog.Note("perf_after_job", "run=" + run + " " + Read(out cpuNow, false, ref ignored)); } catch (Exception) { }
        }
    }

    // Time saved, for the boss (2.2.0). Counts the orders the helper finished, from the day
    // logs, and multiplies by the minutes the same order takes by hand. Those minutes are an
    // estimate you can change in time-saved.json (Diagnostics folder). No customer data.
    internal static class TimeSaved {
        internal sealed class Settings { public double onlineMinutes = 4, mobileMinutes = 4; }
        internal sealed class Day { public DateTime Date; public int Online, Mobile, Stopped; public double HelperSeconds; }
        internal static string SettingsPath { get { return Path.Combine(RunDiagnostics.Root, "time-saved.json"); } }
        internal static Settings Load() {
            try {
                if (File.Exists(SettingsPath)) {
                    var s = Wire.Read<Settings>(File.ReadAllText(SettingsPath, Encoding.UTF8));
                    if (s != null && s.onlineMinutes > 0 && s.onlineMinutes < 120 && s.mobileMinutes > 0 && s.mobileMinutes < 120) return s;
                }
            } catch (Exception) { }
            return new Settings();
        }
        // Writes the default minutes once, so they can be edited (only when a report is made).
        static void EnsureSettingsFile() {
            try { if (!File.Exists(SettingsPath)) { Directory.CreateDirectory(RunDiagnostics.Root); File.WriteAllText(SettingsPath, Wire.Json(new Settings()), new UTF8Encoding(false)); } } catch (Exception) { }
        }
        static readonly Regex Seconds = new Regex(@"\bin (\d+(?:\.\d+)?) s\b");
        internal static Day Count(DateTime date, IEnumerable<Dictionary<string, object>> events) {
            var d = new Day { Date = date.Date };
            foreach (var e in events) {
                object k, v; string kind = e.TryGetValue("Kind", out k) && k != null ? k.ToString() : "";
                string detail = e.TryGetValue("Detail", out v) && v != null ? v.ToString() : "";
                bool online = kind == "online_fill_ok", mobile = kind == "mobile_job_ready";
                if (online) d.Online++;
                if (mobile) d.Mobile++;
                if (kind == "online_fill_stopped" || kind == "mobile_job_failed") d.Stopped++;
                if (online || mobile) {
                    var m = Seconds.Match(detail); double sec;
                    if (m.Success && Double.TryParse(m.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out sec)) d.HelperSeconds += sec;
                }
            }
            return d;
        }
        internal static double MinutesSaved(Day d, Settings s) { return d.Online * s.onlineMinutes + d.Mobile * s.mobileMinutes; }
        static List<Dictionary<string, object>> ReadDay(DateTime date) {
            var list = new List<Dictionary<string, object>>();
            try {
                string path = AppLog.FileFor(date);
                if (!File.Exists(path)) return list;
                foreach (var line in File.ReadAllLines(path)) {
                    if (line.Trim().Length == 0) continue;
                    try { list.Add(Wire.Read<Dictionary<string, object>>(line)); } catch (Exception) { }
                }
            } catch (Exception) { }
            return list;
        }
        internal static List<Day> Days(int count) {
            var days = new List<Day>();
            for (int i = count - 1; i >= 0; i--) { var date = DateTime.Today.AddDays(-i); days.Add(Count(date, ReadDay(date))); }
            return days;
        }
        static string todayLine = ""; static DateTime todayAt = DateTime.MinValue;
        // For the status line; read at most once a minute.
        internal static string TodayLine() {
            if (DateTime.UtcNow - todayAt < TimeSpan.FromMinutes(1)) return todayLine;
            todayAt = DateTime.UtcNow;
            try {
                var d = Count(DateTime.Today, ReadDay(DateTime.Today)); int n = d.Online + d.Mobile;
                todayLine = n == 0 ? "" : "Today " + n + " order" + (n == 1 ? "" : "s") + " by the helper, about " + Minutes(MinutesSaved(d, Load())) + " saved";
            } catch (Exception) { todayLine = ""; }
            return todayLine;
        }
        internal static string Minutes(double minutes) {
            if (minutes < 90) return Math.Round(minutes).ToString(CultureInfo.InvariantCulture) + " min";
            return (minutes / 60).ToString("0.0", CultureInfo.InvariantCulture) + " hours";
        }
        static string Esc(string s) { return System.Net.WebUtility.HtmlEncode(s ?? ""); }
        // A one-page report: today, the last 7 days, the last 30 days, and a day-by-day table.
        internal static string Html(List<Day> days, Settings s, string version) {
            Func<IEnumerable<Day>, int> orders = delegate(IEnumerable<Day> set) { return set.Sum(x => x.Online + x.Mobile); };
            Func<IEnumerable<Day>, double> saved = delegate(IEnumerable<Day> set) { return set.Sum(x => MinutesSaved(x, s)); };
            var today = days.Where(x => x.Date == DateTime.Today).ToList();
            var week = days.Where(x => x.Date > DateTime.Today.AddDays(-7)).ToList();
            var b = new StringBuilder();
            b.Append("<!doctype html><html><head><meta charset=\"utf-8\"><title>Tempe COSTAR Helper - time saved</title><style>");
            b.Append("body{font-family:Segoe UI,Arial,sans-serif;margin:32px;color:#1d2733}h1{margin:0 0 4px;font-size:24px}.sub{color:#5b6773;margin-bottom:24px}");
            b.Append(".cards{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:28px}.card{border:1px solid #d6dde4;border-radius:10px;padding:16px 20px;min-width:190px}");
            b.Append(".big{font-size:30px;font-weight:700}.label{color:#5b6773;font-size:13px;text-transform:uppercase;letter-spacing:.04em}");
            b.Append("table{border-collapse:collapse;width:100%;max-width:760px}th,td{padding:7px 10px;border-bottom:1px solid #e3e8ed;text-align:right}th:first-child,td:first-child{text-align:left}");
            b.Append("th{color:#5b6773;font-weight:600;font-size:13px}.note{color:#5b6773;font-size:13px;margin-top:20px;max-width:760px}</style></head><body>");
            b.Append("<h1>Tempe COSTAR Helper: time saved</h1><div class=\"sub\">Tempe Tyres &middot; generated " + Esc(DateTime.Now.ToString("d MMM yyyy, h:mm tt", CultureInfo.InvariantCulture)) + " &middot; helper " + Esc(version) + "</div><div class=\"cards\">");
            foreach (var card in new[] { new { Label = "Today", Set = (IEnumerable<Day>)today }, new { Label = "Last 7 days", Set = (IEnumerable<Day>)week }, new { Label = "Last 30 days", Set = (IEnumerable<Day>)days } })
                b.Append("<div class=\"card\"><div class=\"label\">" + card.Label + "</div><div class=\"big\">" + Esc(Minutes(saved(card.Set))) + "</div><div>" + orders(card.Set) + " orders entered</div></div>");
            b.Append("</div><table><tr><th>Day</th><th>Online orders</th><th>Mobile jobs</th><th>Needed a hand</th><th>Helper time per order</th><th>Typing saved</th></tr>");
            foreach (var d in days.Where(x => x.Online + x.Mobile + x.Stopped > 0).OrderByDescending(x => x.Date)) {
                int n = d.Online + d.Mobile;
                b.Append("<tr><td>" + Esc(d.Date.ToString("ddd d MMM", CultureInfo.InvariantCulture)) + "</td><td>" + d.Online + "</td><td>" + d.Mobile + "</td><td>" + d.Stopped + "</td><td>" +
                    (n > 0 ? (d.HelperSeconds / n).ToString("0", CultureInfo.InvariantCulture) + " s" : "-") + "</td><td>" + Esc(Minutes(MinutesSaved(d, s))) + "</td></tr>");
            }
            b.Append("</table><p class=\"note\">Typing saved = orders entered by the helper &times; minutes the same order takes by hand (online " + s.onlineMinutes.ToString("0.#", CultureInfo.InvariantCulture) +
                " min, mobile job " + s.mobileMinutes.ToString("0.#", CultureInfo.InvariantCulture) + " min; change them in time-saved.json in the helper's Diagnostics folder). The helper types while staff do other work. " +
                "&ldquo;Needed a hand&rdquo; counts entries that stopped and were finished or retried by staff.</p></body></html>");
            return b.ToString();
        }
        internal static string SaveReport() {
            EnsureSettingsFile();
            var s = Load(); var days = Days(30);
            string folder = Path.Combine(Path.GetDirectoryName(RunDiagnostics.Root), "Reports");
            Directory.CreateDirectory(folder);
            string path = Path.Combine(folder, "time-saved-" + DateTime.Now.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture) + ".html");
            File.WriteAllText(path, Html(days, s, AutofillForm.Version), new UTF8Encoding(false));
            return path;
        }
    }

    // The online orders the helper finished today and yesterday (from the day log), for the
    // Tempe Orders page's COSTAR check. Order numbers and times only.
    internal static class EnteredOrders {
        static string cached = "{\"entered\":[]}"; static DateTime cachedAt = DateTime.MinValue;
        static readonly Regex OrderId = new Regex(@"^(TTW\d{4,})\b", RegexOptions.IgnoreCase);
        internal static string Json() {
            if (DateTime.UtcNow - cachedAt < TimeSpan.FromSeconds(15)) return cached;
            var list = new List<Dictionary<string, object>>();
            foreach (var day in new[] { DateTime.Today.AddDays(-1), DateTime.Today }) {
                try {
                    string path = AppLog.FileFor(day);
                    if (!File.Exists(path)) continue;
                    foreach (var line in File.ReadAllLines(path)) {
                        if (line.IndexOf("online_fill_ok", StringComparison.Ordinal) < 0) continue;
                        Dictionary<string, object> e;
                        try { e = Wire.Read<Dictionary<string, object>>(line); } catch (Exception) { continue; }
                        object kind, detail, at;
                        if (!e.TryGetValue("Kind", out kind) || (kind ?? "").ToString() != "online_fill_ok") continue;
                        var m = OrderId.Match(e.TryGetValue("Detail", out detail) && detail != null ? detail.ToString() : "");
                        if (!m.Success) continue;
                        list.Add(new Dictionary<string, object> { { "orderId", m.Groups[1].Value.ToUpperInvariant() }, { "at", e.TryGetValue("At", out at) && at != null ? at.ToString() : "" } });
                    }
                } catch (Exception) { }
            }
            cached = Wire.Json(new Dictionary<string, object> { { "version", AutofillForm.Version }, { "entered", list } });
            cachedAt = DateTime.UtcNow;
            return cached;
        }
    }

    internal static class AppLog {
        static readonly object gate = new object();
        static string mode = "app";
        static int pollErrors;
        internal static string FileFor(DateTime day) {
            return Path.Combine(RunDiagnostics.Root, "events-" + day.ToString("yyyyMMdd", CultureInfo.InvariantCulture) + ".jsonl");
        }
        internal static void Start(string appMode) {
            mode = appMode ?? "app";
            try {
                AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e) { Crash("unhandled", e.ExceptionObject as Exception); };
            } catch { }
            Note("app_start", "mode=" + mode + " os=" + Environment.OSVersion.VersionString + " 64bit=" + Environment.Is64BitProcess +
                " screen=" + SystemInformation.VirtualScreen.Width + "x" + SystemInformation.VirtualScreen.Height + " remote=" + SystemInformation.TerminalServerSession);
        }
        internal static void Note(string kind, string detail) {
            try {
                var line = new Dictionary<string, object> {
                    { "At", DateTimeOffset.Now.ToString("o", CultureInfo.InvariantCulture) },
                    { "Version", AutofillForm.Version }, { "Mode", mode }, { "Kind", kind ?? "" },
                    { "Detail", Sanitize.Text(detail ?? "", 400) }, { "MemoryMb", Environment.WorkingSet / 1048576 }
                };
                string json = Wire.Json(line);
                lock (gate) {
                    Directory.CreateDirectory(RunDiagnostics.Root);
                    File.AppendAllText(FileFor(DateTime.Now), json + "\n", new UTF8Encoding(false));
                }
            } catch {
                // The day log must never affect entry or the UI.
            }
        }
        internal static void Crash(string where, Exception e) {
            if (e == null) { Note("crash", where); return; }
            string frames = String.Join(" / ", (e.StackTrace ?? "").Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).Take(4));
            Note("crash", where + ": " + e.GetType().Name + ": " + e.Message + " | " + frames);
        }
        // Desk connection errors: noted when they start, every 20th repeat, and on recovery.
        internal static void PollError(string message) {
            int n; lock (gate) { n = ++pollErrors; }
            if (n == 1 || n % 20 == 0) Note("connection_error", "failed polls=" + n + " " + message);
        }
        internal static void PollOk() {
            int n; lock (gate) { n = pollErrors; pollErrors = 0; }
            if (n > 0) Note("connection_ok", "recovered after " + n + " failed polls");
        }
        internal static List<Dictionary<string, object>> ReadRecent(int days) {
            var result = new List<Dictionary<string, object>>();
            try {
                var folder = new DirectoryInfo(RunDiagnostics.Root);
                if (!folder.Exists) return result;
                DateTime since = DateTime.UtcNow.AddDays(-days);
                foreach (var f in folder.GetFiles("events-*.jsonl").Where(x => x.LastWriteTimeUtc >= since).OrderBy(x => x.Name)) {
                    string[] lines;
                    lock (gate) { lines = File.ReadAllLines(f.FullName); }
                    foreach (var l in lines) {
                        if (l.Trim().Length == 0) continue;
                        try { result.Add(Wire.Read<Dictionary<string, object>>(l)); } catch { }
                    }
                }
            } catch { }
            return result;
        }
    }

    // Keeps full local reports (which contain customer details) for 30 days and
    // the masked diagnostics for 180 days. Only run-named entries are removed.
    internal static class ReportRetention {
        internal const int ReportDays = 30, DiagnosticDays = 180;
        static readonly Regex RunName = new Regex(@"^\d{8}-\d{6}-");
        static DateTime lastRun = DateTime.MinValue;

        internal static void Prune() {
            try {
                if (DateTime.UtcNow - lastRun < TimeSpan.FromHours(1)) return;
                lastRun = DateTime.UtcNow;
                DateTime reportCutoff = DateTime.UtcNow.AddDays(-ReportDays), diagnosticCutoff = DateTime.UtcNow.AddDays(-DiagnosticDays);
                var reports = new DirectoryInfo(Runner.ReportsRoot);
                if (reports.Exists) {
                    foreach (var f in reports.GetFiles("*.zip"))
                        if (RunName.IsMatch(f.Name) && f.LastWriteTimeUtc < reportCutoff) TryDelete(delegate { f.Delete(); });
                    foreach (var d in reports.GetDirectories())
                        if (RunName.IsMatch(d.Name) && d.LastWriteTimeUtc < reportCutoff) TryDelete(delegate { d.Delete(true); });
                }
                var diagnostics = new DirectoryInfo(RunDiagnostics.Root);
                if (diagnostics.Exists) {
                    foreach (var f in diagnostics.GetFiles("*.json"))
                        if (RunName.IsMatch(f.Name) && f.LastWriteTimeUtc < diagnosticCutoff) TryDelete(delegate { f.Delete(); });
                    foreach (var f in diagnostics.GetFiles("events-*.jsonl"))
                        if (f.LastWriteTimeUtc < diagnosticCutoff) TryDelete(delegate { f.Delete(); });
                    if (diagnostics.Parent != null)
                        foreach (var f in diagnostics.Parent.GetFiles("Tempe-COSTAR-Diagnostics-*.zip"))
                            if (f.LastWriteTimeUtc < reportCutoff) TryDelete(delegate { f.Delete(); });
                }
            } catch {
                // Retention is housekeeping; it must never stop entry.
            }
        }

        static void TryDelete(Action delete) {
            try { delete(); } catch { }
        }
    }

    // Builds one shareable ZIP from the masked per-run diagnostics.
    internal static class DiagnosticsBundle {
        internal static string Save() {
            var folder = new DirectoryInfo(RunDiagnostics.Root);
            Order.Require(folder.Exists, "No diagnostics yet. Process at least one order with version 1.5.5 or later first.");
            var files = folder.GetFiles("*.json").Where(f => f.Extension.Equals(".json", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(f => f.LastWriteTimeUtc).Take(300).ToList();
            var dayLogs = folder.GetFiles("events-*.jsonl").Where(f => f.LastWriteTimeUtc >= DateTime.UtcNow.AddDays(-14)).ToList();
            Order.Require(files.Count > 0 || dayLogs.Count > 0, "No diagnostics yet. Process at least one order with version 1.5.5 or later first.");
            var events = AppLog.ReadRecent(14);
            var reports = new List<RunReport>();
            foreach (var f in files) {
                try { reports.Add(Wire.Read<RunReport>(File.ReadAllText(f.FullName))); } catch { }
            }
            string target = Path.Combine(folder.Parent.FullName, "Tempe-COSTAR-Diagnostics-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + ".zip");
            using (var zip = ZipFile.Open(target, ZipArchiveMode.Create)) {
                WriteEntry(zip, "summary.txt", Summary(reports, events));
                WriteEntry(zip, "runs.csv", Csv(reports));
                foreach (var f in files) zip.CreateEntryFromFile(f.FullName, "runs/" + f.Name, CompressionLevel.Optimal);
                foreach (var f in dayLogs) zip.CreateEntryFromFile(f.FullName, "day-log/" + f.Name, CompressionLevel.Optimal);
            }
            return target;
        }

        static void WriteEntry(ZipArchive zip, string name, string text) {
            var entry = zip.CreateEntry(name);
            using (var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false))) writer.Write(text);
        }

        static readonly Regex CodeStage = new Regex(@"^(Add tyre|Add wheel|Quantity for|Item) (.+)$");

        internal static string StageGroup(string stage) {
            var m = CodeStage.Match(stage ?? "");
            if (!m.Success) return stage ?? "";
            string code = m.Groups[2].Value;
            if (code == "M FB" || code == "WA" || code == "WAFR" || code == "F" || code == "DET") return stage;
            return m.Groups[1].Value + " *";
        }

        static long Median(List<long> values) {
            if (values.Count == 0) return 0;
            var sorted = values.OrderBy(v => v).ToList();
            int mid = sorted.Count / 2;
            return sorted.Count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        }

        static string Seconds(double ms) { return (ms / 1000.0).ToString("0.00", CultureInfo.InvariantCulture) + " s"; }

        static string ProcessName(DiagEvent e) {
            var m = Regex.Match(e.Detail ?? "", @"process=(\S+)");
            return m.Success ? m.Groups[1].Value : "unknown";
        }

        // "ws=48 private=61 heap=12 cpu=0.4" -> numbers by name.
        internal static Dictionary<string, double> PerfValues(string detail) {
            var values = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (Match m in Regex.Matches(detail ?? "", @"(\w+)=(-?\d+(?:\.\d+)?)")) {
                double v; if (Double.TryParse(m.Groups[2].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out v)) values[m.Groups[1].Value] = v;
            }
            return values;
        }
        static double Pv(Dictionary<string, double> v, string key) { double x; return v.TryGetValue(key, out x) ? x : 0; }
        // An open-order check: trying a Repair Order that already holds another job, after which
        // the fill opens a fresh one. 2.0.3 marks these "probe"; earlier versions logged them
        // as quick online "not empty" stops at the empty-order check.
        internal static bool IsProbe(RunReport r) {
            return r.Outcome == "probe" || (r.Outcome == "stopped" && r.Category == "repair_order_not_empty" && (r.Kind ?? "").StartsWith("online") &&
                r.TotalMs < 1000 && (r.StopStage ?? "").StartsWith("Startup: verify empty"));
        }
        static string Val(Dictionary<string, object> e, string key) {
            object v; return e != null && e.TryGetValue(key, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : "";
        }
        // The first page of the report: today at a glance, speed by version, and a short
        // list of what to look at first. Built from run files plus the day log.
        internal static string EndOfDay(List<RunReport> reports, List<Dictionary<string, object>> events, DateTime now) {
            var b = new StringBuilder();
            string today = now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var allToday = reports.Where(r => (r.StartedLocal ?? "").StartsWith(today, StringComparison.Ordinal)).ToList();
            var runs = allToday.Where(r => !IsProbe(r)).ToList();
            int probes = allToday.Count - runs.Count;
            var day = events.Where(e => Val(e, "At").StartsWith(today, StringComparison.Ordinal)).ToList();
            Func<string, int> count = k => day.Count(e => Val(e, "Kind") == k);
            b.AppendLine("END OF DAY " + today + "   (helper " + AutofillForm.Version + ")");
            b.AppendLine("Masked: no customer names, phones, addresses or emails. Upload this ZIP to Claude.");
            b.AppendLine();
            int done = runs.Count(r => r.Outcome == "completed");
            b.AppendLine("TODAY");
            b.AppendLine("  Entry runs: " + runs.Count + ", completed without help: " + done + (runs.Count > 0 ? " (" + (100 * done / runs.Count) + "%)" : ""));
            foreach (var kind in runs.Where(r => r.Outcome == "completed").GroupBy(r => r.Kind).OrderBy(g => g.Key)) {
                var times = kind.Select(r => r.TotalMs).ToList();
                b.AppendLine("    " + kind.Key + ": " + times.Count + " done, median " + Seconds(Median(times)) + ", fastest " + Seconds(times.Min()) + ", slowest " + Seconds(times.Max()));
            }
            b.AppendLine("  Online orders: loaded " + count("online_loaded") + ", filled " + count("online_fill_ok") + ", stopped " + count("online_fill_stopped") +
                ", could not start " + count("online_fill_refused") + ", failed to load " + count("online_load_failed") +
                ", duplicates refused " + (count("online_refused") + count("online_queue_entered") + count("online_queue_duplicate")) +
                ", already in COSTAR (Order Check) " + count("online_duplicate_blocked") +
                ", queued " + count("online_queue_queued") + ", queue paused " + count("online_queue_paused"));
            b.AppendLine("  Fresh Repair Orders opened beside an order in use: " + count("online_ro_in_use") + "; previous order's Repair Order skipped: " + count("online_skip_review_ro") +
                "; open-order checks (not counted as runs): " + probes);
            b.AppendLine("  Mobile jobs: started " + count("mobile_job_start") + ", ready " + count("mobile_job_ready") + ", failed " + count("mobile_job_failed") +
                ", closed " + count("mobile_close_ok") + ", unstarted jobs reset " + count("mobile_reset_unstarted"));
            var savedToday = TimeSaved.Count(now.Date, day); var timeSettings = TimeSaved.Load();
            if (savedToday.Online + savedToday.Mobile > 0)
                b.AppendLine("  Time saved: about " + TimeSaved.Minutes(TimeSaved.MinutesSaved(savedToday, timeSettings)) + " (" + savedToday.Online + " online x " + timeSettings.onlineMinutes.ToString("0.#", CultureInfo.InvariantCulture) +
                    " min + " + savedToday.Mobile + " mobile x " + timeSettings.mobileMinutes.ToString("0.#", CultureInfo.InvariantCulture) + " min by hand)");
            b.AppendLine("  Stops pressed: " + count("stop_pressed") + ". Desk connection drops: " + count("connection_error") + ". Crashes: " + count("crash") + ". App starts: " + count("app_start") + ".");
            var perf = day.Where(e => Val(e, "Kind") == "perf").Select(e => PerfValues(Val(e, "Detail"))).Where(v => v.ContainsKey("ws")).ToList();
            if (perf.Count > 0) {
                var first = perf[0]; var last = perf[perf.Count - 1];
                b.AppendLine("  Helper memory (every 5 min): start " + first["ws"] + " MB, peak " + perf.Max(v => v["ws"]) + " MB, now " + last["ws"] + " MB" +
                    (last.ContainsKey("private") ? " (private " + last["private"] + " MB, managed " + Pv(last, "heap") + " MB)" : ""));
                b.AppendLine("  Helper CPU: average " + perf.Average(v => Pv(v, "cpu")).ToString("0.0", CultureInfo.InvariantCulture) + "%, peak " + perf.Max(v => Pv(v, "cpu")).ToString("0.0", CultureInfo.InvariantCulture) +
                    "%. Handles " + Pv(first, "handles") + " -> " + Pv(last, "handles") + ", GDI " + Pv(first, "gdi") + " -> " + Pv(last, "gdi") + ", USER " + Pv(first, "user") + " -> " + Pv(last, "user") + ", threads " + Pv(last, "threads"));
            }
            var notes = day.Where(e => Val(e, "Kind") == "user_note").ToList();
            if (notes.Count > 0) {
                b.AppendLine("  Your notes:");
                foreach (var n in notes) { string at = Val(n, "At"); b.AppendLine("    " + (at.Length >= 16 ? at.Substring(11, 5) : at) + "  " + Val(n, "Detail")); }
            }
            b.AppendLine();

            b.AppendLine("SPEED BY VERSION (completed runs, median)");
            foreach (var version in reports.Where(r => r.Outcome == "completed").GroupBy(r => r.Version ?? "?").OrderBy(g => g.Key)) {
                var parts = version.GroupBy(r => r.Kind).OrderBy(g => g.Key).Select(g => g.Key + " " + Seconds(Median(g.Select(r => r.TotalMs).ToList())) + " (" + g.Count() + ")");
                b.AppendLine("  " + version.Key + ": " + String.Join(", ", parts));
            }
            b.AppendLine();

            var look = new List<string>();
            foreach (var c in day.Where(e => Val(e, "Kind") == "crash").Take(3)) look.Add("Crash at " + Val(c, "At") + ": " + Val(c, "Detail"));
            int late = runs.Sum(r => r.LateReads), lateRuns = runs.Count(r => r.LateReads > 0);
            if (late > 0) look.Add("The read plan missed " + late + " field read(s) in " + lateRuns + " run(s). Correct either way; the plan can be tightened.");
            int resets = runs.Sum(r => r.Events.Count(e => e.Kind == "grid_read_plan_reset"));
            if (resets > 0) look.Add("The item-grid read plan had to relearn the column labels " + resets + " time(s).");
            int lists = runs.Sum(r => r.Events.Count(e => e.Kind == "account_chooser"));
            if (lists > 0) look.Add("Two-account selection list seen " + lists + " time(s): " + runs.Count(r => r.Waits.Any(w => w.Result == "existing-customer-first-of-several")) +
                " run(s) took the first account. The list layouts are in the run files (popup_layout).");
            foreach (var stopGroup in runs.Where(r => r.Outcome != "completed").GroupBy(r => r.Category ?? "unknown").OrderByDescending(x => x.Count()).Take(3))
                look.Add("Stopped " + stopGroup.Count() + "x: " + stopGroup.Key + " (e.g. stage \"" + stopGroup.First().StopStage + "\": " + stopGroup.First().StopMessage + ")");
            foreach (var failGroup in day.Where(e => Val(e, "Kind") == "online_load_failed" || Val(e, "Kind") == "online_fill_refused").GroupBy(e => Val(e, "Detail")).OrderByDescending(x => x.Count()).Take(3))
                look.Add("Online order not filled " + failGroup.Count() + "x: " + failGroup.Key);
            if (count("connection_error") > 0) look.Add("The worker lost the desk receiver " + count("connection_error") + " time(s) (see day-log).");
            foreach (var kindGroup in runs.Where(r => r.Outcome == "completed").GroupBy(r => r.Kind)) {
                var sameKind = kindGroup.ToList();
                long median = Median(sameKind.Select(r => r.TotalMs).ToList());
                if (sameKind.Count < 3) continue;
                foreach (var run in sameKind.Where(r => r.TotalMs > median * 16 / 10).Take(3)) {
                    var slow = run.Stages.OrderByDescending(st => st.DurationMs).FirstOrDefault();
                    look.Add("Slow " + run.Kind + " run " + run.OrderRef + " " + Seconds(run.TotalMs) + " (median " + Seconds(median) + ")" +
                        (slow == null ? "" : ", slowest stage \"" + slow.Stage + "\" " + Seconds(slow.DurationMs)));
                }
            }
            var slowStages = runs.Where(r => r.Outcome == "completed").SelectMany(r => r.Stages).GroupBy(st => StageGroup(st.Stage))
                .Select(sg => new { Name = sg.Key, Avg = sg.Average(st => (double)st.DurationMs) }).Where(x => x.Avg >= 1500).OrderByDescending(x => x.Avg).Take(3).ToList();
            foreach (var slowStage in slowStages) look.Add("Slow stage today: " + slowStage.Name + " averages " + Seconds(slowStage.Avg));
            var saving = runs.Where(r => r.SaveCount > 0).ToList();
            if (saving.Count > 0) {
                double saveTotal = saving.Sum(r => (double)r.SaveCount);
                look.Add("Checkpoint saves: " + (saveTotal / saving.Count).ToString("0", CultureInfo.InvariantCulture) + " per job; each averages copy " +
                    (saving.Sum(r => r.SaveCopyMs) / saveTotal).ToString("0.0", CultureInfo.InvariantCulture) + " ms, JSON " + (saving.Sum(r => r.SaveJsonMs) / saveTotal).ToString("0.0", CultureInfo.InvariantCulture) +
                    " ms, encrypt " + (saving.Sum(r => r.SaveProtectMs) / saveTotal).ToString("0.0", CultureInfo.InvariantCulture) + " ms, write " + (saving.Sum(r => r.SaveWriteMs) / saveTotal).ToString("0.0", CultureInfo.InvariantCulture) +
                    " ms, replace " + (saving.Sum(r => r.SaveReplaceMs) / saveTotal).ToString("0.0", CultureInfo.InvariantCulture) + " ms.");
            }
            var notFound = day.Where(e => Val(e, "Kind") == "costar_not_found").ToList();
            if (notFound.Count > 0) look.Add("COSTAR was not found " + notFound.Count + " time(s). Last search: " + Val(notFound[notFound.Count - 1], "Detail"));
            if (perf.Count >= 2) {
                var p0 = perf[0]; var pn = perf[perf.Count - 1];
                if (perf.Max(v => v["ws"]) > 300) look.Add("Helper memory peaked at " + perf.Max(v => v["ws"]) + " MB.");
                if (Pv(pn, "handles") > Pv(p0, "handles") + 500) look.Add("Helper handles grew from " + Pv(p0, "handles") + " to " + Pv(pn, "handles") + " (possible leak).");
                if (Pv(pn, "gdi") > Pv(p0, "gdi") + 200 || Pv(pn, "user") > Pv(p0, "user") + 200) look.Add("Helper GDI/USER objects grew (" + Pv(p0, "gdi") + "/" + Pv(p0, "user") + " -> " + Pv(pn, "gdi") + "/" + Pv(pn, "user") + ").");
                if (perf.Average(v => Pv(v, "cpu")) > 5) look.Add("Helper CPU averaged " + perf.Average(v => Pv(v, "cpu")).ToString("0.0", CultureInfo.InvariantCulture) + "% (expected under 1%).");
            }
            b.AppendLine("THINGS TO LOOK AT");
            if (look.Count == 0) b.AppendLine("  Nothing unusual today.");
            foreach (var l in look) b.AppendLine("  - " + l);
            b.AppendLine();
            b.AppendLine("======================================================================");
            b.AppendLine();
            return b.ToString();
        }
        internal static string Summary(List<RunReport> reports) { return Summary(reports, null); }
        internal static string Summary(List<RunReport> reports, List<Dictionary<string, object>> events) {
            return EndOfDay(reports, events ?? new List<Dictionary<string, object>>(), DateTime.Now) + Details(reports);
        }
        internal static string Details(List<RunReport> reports) {
            var b = new StringBuilder();
            b.AppendLine("TEMPE COSTAR DIAGNOSTICS SUMMARY");
            b.AppendLine("Generated " + DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + " from " + reports.Count + " run(s). No customer field values are included.");
            b.AppendLine("Versions: " + String.Join(", ", reports.Select(r => r.Version).Distinct()));
            b.AppendLine();

            int probeCount = reports.Count(r => IsProbe(r));
            var real = reports.Where(r => !IsProbe(r)).ToList();
            int completed = real.Count(r => r.Outcome == "completed");
            b.AppendLine("OUTCOMES");
            b.AppendLine("Completed without help: " + completed + " of " + real.Count + (real.Count > 0 ? " (" + (100 * completed / real.Count) + "%)" : "") +
                (probeCount > 0 ? "   (plus " + probeCount + " open-order check(s), not counted)" : ""));
            foreach (var kind in real.GroupBy(r => r.Kind).OrderBy(g => g.Key))
                b.AppendLine("  " + kind.Key + ": " + kind.Count(r => r.Outcome == "completed") + " of " + kind.Count() + " completed");
            foreach (var category in real.Where(r => r.Outcome != "completed").GroupBy(r => r.Category ?? "unknown").OrderByDescending(g => g.Count()))
                b.AppendLine("  Stopped - " + category.Key + ": " + category.Count());
            b.AppendLine();

            b.AppendLine("TOTAL TIME (completed runs)");
            foreach (var kind in reports.Where(r => r.Outcome == "completed").GroupBy(r => r.Kind).OrderBy(g => g.Key)) {
                var times = kind.Select(r => r.TotalMs).ToList();
                b.AppendLine("  " + kind.Key + ": median " + Seconds(Median(times)) + ", fastest " + Seconds(times.Min()) + ", slowest " + Seconds(times.Max()) + " (" + times.Count + " runs)");
            }
            b.AppendLine();

            b.AppendLine("STAGES (completed runs, average per run; busy = COSTAR UI thread not answering)");
            foreach (var kind in reports.Where(r => r.Outcome == "completed").GroupBy(r => r.Kind).OrderBy(g => g.Key)) {
                b.AppendLine("  [" + kind.Key + "]");
                var rows = kind.SelectMany(r => r.Stages).GroupBy(s => StageGroup(s.Stage))
                    .Select(g => new {
                        Name = g.Key, Count = g.Count(), Avg = g.Average(s => (double)s.DurationMs), Max = g.Max(s => s.DurationMs),
                        Snap = g.Average(s => (double)(s.FullSnapshots + s.GridSnapshots + s.PopupSnapshots)), SnapMs = g.Average(s => (double)s.SnapshotMs),
                        PauseMs = g.Average(s => (double)s.PauseMs), BusyMs = g.Average(s => (double)s.CostarBusyMs)
                    }).OrderByDescending(x => x.Avg);
                foreach (var x in rows)
                    b.AppendLine("    " + x.Name + ": avg " + Seconds(x.Avg) + ", max " + Seconds(x.Max) + " | reads " + x.Snap.ToString("0.0", CultureInfo.InvariantCulture) +
                        " (" + Seconds(x.SnapMs) + ") | sleeping " + Seconds(x.PauseMs) + " | COSTAR busy " + Seconds(x.BusyMs) + " | n=" + x.Count);
            }
            b.AppendLine();

            b.AppendLine("SCREEN READS (average per run)");
            foreach (var kind in reports.GroupBy(r => r.Kind).OrderBy(g => g.Key)) {
                var list = kind.ToList();
                b.AppendLine("  " + kind.Key + ": text reads " + list.Average(r => (double)r.TextReads).ToString("0", CultureInfo.InvariantCulture) +
                    " | skipped by read plan " + list.Average(r => (double)r.SkippedReads).ToString("0", CultureInfo.InvariantCulture) +
                    " | late (plan missed) " + list.Average(r => (double)r.LateReads).ToString("0.0", CultureInfo.InvariantCulture) +
                    " | header cache hits " + list.Average(r => (double)r.HeaderHits).ToString("0.0", CultureInfo.InvariantCulture));
            }
            b.AppendLine();

            b.AppendLine("BETWEEN STEPS AND SAVES (completed runs, average per run)");
            foreach (var kind in reports.Where(r => r.Outcome == "completed").GroupBy(r => r.Kind).OrderBy(g => g.Key)) {
                var list = kind.ToList();
                double between = list.Average(r => (double)r.BetweenStagesMs);
                double saves = list.Average(r => (double)(r.Stages.Sum(s => s.Persists) + (r.BetweenStages == null ? 0 : r.BetweenStages.Persists)));
                double saveMs = list.Average(r => (double)(r.Stages.Sum(s => s.PersistMs) + (r.BetweenStages == null ? 0 : r.BetweenStages.PersistMs)));
                double idleMs = list.Average(r => (double)(r.Stages.Sum(s => s.IdleWaitMs) + (r.BetweenStages == null ? 0 : r.BetweenStages.IdleWaitMs)));
                b.AppendLine("  " + kind.Key + ": between steps " + Seconds(between) + " | checkpoint saves " + saves.ToString("0.0", CultureInfo.InvariantCulture) +
                    " (" + Seconds(saveMs) + ") | waiting for COSTAR to answer " + Seconds(idleMs));
            }
            b.AppendLine();

            b.AppendLine("WAITS (all runs; retried = needed more than one attempt)");
            var waits = reports.SelectMany(r => r.Waits).GroupBy(w => w.Name)
                .Select(g => new { Name = g.Key, Count = g.Count(), Total = g.Sum(w => w.Ms), Avg = g.Average(w => (double)w.Ms), Max = g.Max(w => w.Ms), Loops = g.Average(w => (double)w.Iterations),
                    Retried = g.Count(w => (w.Result ?? "").StartsWith("ok-attempt", StringComparison.Ordinal)), Failed = g.Count(w => !WaitSucceeded(w.Result)) })
                .OrderByDescending(x => x.Total);
            foreach (var x in waits)
                b.AppendLine("  " + x.Name + ": " + x.Count + "x, avg " + Seconds(x.Avg) + ", max " + Seconds(x.Max) + ", avg loops " + x.Loops.ToString("0.0", CultureInfo.InvariantCulture) +
                    ", retried " + x.Retried + ", failed " + x.Failed);
            b.AppendLine();

            b.AppendLine("EVENTS (all runs)");
            foreach (var kind in reports.SelectMany(r => r.Events).Where(e => e.Kind != "step").GroupBy(e => e.Kind).OrderByDescending(g => g.Count()))
                b.AppendLine("  " + kind.Key + ": " + kind.Count());
            var thieves = reports.SelectMany(r => r.Events).Where(e => e.Kind == "foreground_lost").GroupBy(e => ProcessName(e)).OrderByDescending(g => g.Count()).ToList();
            if (thieves.Count > 0) b.AppendLine("  Windows that took focus: " + String.Join(", ", thieves.Select(g => g.Key + " x" + g.Count())));
            b.AppendLine();

            b.AppendLine("COSTAR RESPONSIVENESS");
            if (reports.Count > 0) {
                b.AppendLine("  Longest unanswered probe: " + reports.Max(r => r.Probe == null ? 0 : r.Probe.MaxMs) + " ms");
                b.AppendLine("  Runs with a pause over 1 s: " + reports.Count(r => r.Probe != null && r.Probe.Over1000Ms > 0));
            }
            b.AppendLine();

            b.AppendLine("ENVIRONMENT");
            foreach (string key in new[] { "costarVersion", "remoteSession", "primaryScreen", "dpi", "repairOrderWindow", "repairOrderMaximized", "os" }) {
                var values = reports.Select(r => r.Env != null && r.Env.ContainsKey(key) ? r.Env[key] : "").Where(v => v.Length > 0).Distinct().ToList();
                b.AppendLine("  " + key + ": " + (values.Count == 0 ? "(not recorded)" : String.Join(" || ", values)));
            }
            b.AppendLine("  layout fingerprints: " + reports.Select(r => r.LayoutHash).Where(h => !String.IsNullOrEmpty(h)).Distinct().Count());
            b.AppendLine();

            b.AppendLine("STOPPED RUNS");
            foreach (var r in reports.Where(x => x.Outcome != "completed").OrderBy(x => x.StartedLocal))
                b.AppendLine("  " + r.StartedLocal + " | " + r.Kind + " | " + r.OrderRef + " | " + r.Category + " | stage: " + r.StopStage + " | " + r.StopMessage);
            return b.ToString();
        }

        internal static bool WaitSucceeded(string result) {
            string r = result ?? "";
            return r == "ok" || r.StartsWith("ok-attempt", StringComparison.Ordinal) || r.StartsWith("existing", StringComparison.Ordinal) || r.StartsWith("new-customer", StringComparison.Ordinal);
        }

        static string Field(string value) {
            value = value ?? "";
            return value.IndexOfAny(new[] { ',', '"', '\r', '\n' }) >= 0 ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;
        }

        internal static string Csv(List<RunReport> reports) {
            var b = new StringBuilder();
            b.Append("RunId,Started,Version,Kind,OrderRef,Outcome,Category,StopStage,TotalMs,OpenNewMs,BetweenStepsMs,Saves,SaveMs,IdleWaitMs,Writes,Snapshots,SnapshotMs,TextReads,SkippedReads,LateReads,HeaderHits,SleepMs,ProbeMaxMs,FocusFailures,ForegroundLost,CommitIssues,SlowestStage,SlowestStageMs,LayoutHash\r\n");
            foreach (var r in reports) {
                var slowest = r.Stages.OrderByDescending(s => s.DurationMs).FirstOrDefault();
                var cells = new[] {
                    r.RunId, r.StartedLocal, r.Version, r.Kind, r.OrderRef, r.Outcome, r.Category, r.StopStage,
                    r.TotalMs.ToString(CultureInfo.InvariantCulture), r.OpenNewMs.ToString(CultureInfo.InvariantCulture),
                    r.BetweenStagesMs.ToString(CultureInfo.InvariantCulture),
                    (r.Stages.Sum(s => s.Persists) + (r.BetweenStages == null ? 0 : r.BetweenStages.Persists)).ToString(CultureInfo.InvariantCulture),
                    (r.Stages.Sum(s => s.PersistMs) + (r.BetweenStages == null ? 0 : r.BetweenStages.PersistMs)).ToString(CultureInfo.InvariantCulture),
                    (r.Stages.Sum(s => s.IdleWaitMs) + (r.BetweenStages == null ? 0 : r.BetweenStages.IdleWaitMs)).ToString(CultureInfo.InvariantCulture),
                    r.Writes.ToString(CultureInfo.InvariantCulture), r.Snapshots.ToString(CultureInfo.InvariantCulture),
                    r.SnapshotMs.ToString(CultureInfo.InvariantCulture), r.TextReads.ToString(CultureInfo.InvariantCulture), r.SkippedReads.ToString(CultureInfo.InvariantCulture),
                    r.LateReads.ToString(CultureInfo.InvariantCulture), r.HeaderHits.ToString(CultureInfo.InvariantCulture), r.Stages.Sum(s => s.PauseMs).ToString(CultureInfo.InvariantCulture),
                    (r.Probe == null ? 0 : r.Probe.MaxMs).ToString(CultureInfo.InvariantCulture),
                    r.Events.Count(e => e.Kind == "focus_failed").ToString(CultureInfo.InvariantCulture),
                    r.Events.Count(e => e.Kind == "foreground_lost").ToString(CultureInfo.InvariantCulture),
                    r.Events.Count(e => e.Kind.StartsWith("commit_", StringComparison.Ordinal)).ToString(CultureInfo.InvariantCulture),
                    slowest == null ? "" : slowest.Stage, slowest == null ? "" : slowest.DurationMs.ToString(CultureInfo.InvariantCulture),
                    r.LayoutHash
                };
                b.Append(String.Join(",", cells.Select(c => Field(c)))).Append("\r\n");
            }
            return b.ToString();
        }
    }
}
