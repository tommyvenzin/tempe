// Tempe Order Check 1.4.0, built into the COSTAR helper since helper 2.0.0.
// Reads COSTAR Work-in-Progress through Microsoft Active Accessibility (MSAA).
// It never types into COSTAR. The only action it takes is pressing the WIP
// "Search" button (optional) so the list is fresh before each read.
// Rows are served to the Order Check board on http://127.0.0.1:8795 (this PC only).
// C# 5 only: compiled on the RDP PC with .NET Framework csc /langversion:5.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Accessibility;

namespace TempeOrderCheck {

    internal static class AppInfo {
        internal const string Version = "1.4.0";
        internal const string Title = "Tempe Order Check";
        internal const int Port = 8795;
        internal static string DataFolder() {
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TempeOrderCheck");
            Directory.CreateDirectory(folder);
            return folder;
        }
        internal static string Stamp(DateTime t) { return t.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture); }
        internal static string Short(Exception e) {
            string m = e.Message;
            if (string.IsNullOrEmpty(m)) m = e.GetType().Name;
            return m.Length > 220 ? m.Substring(0, 220) : m;
        }
    }

    // Since COSTAR helper 2.0.0 Order Check runs inside the helper, in its "Order Check"
    // tab: one app, one build, one start. There is no separate Order Check program any more.
    internal static class Hosting {
        static Mutex held;
        // The helper reads Order Check's data directly (no web call to itself).
        internal static Store Store;
        // True while the helper is typing into COSTAR: Order Check does not read then.
        internal static Func<bool> Hold;
        // The online orders the helper entered today and yesterday, as JSON (for the Tempe
        // Orders page's COSTAR check, before Order Check's next Work-in-Progress read).
        internal static Func<string> Entered;
        // The process ID of the COSTAR the helper types into (0 if none). Order Check never
        // reads that one: its reads would compete with entry on the same screen thread.
        internal static Func<int> EntryPid;
        // The separate Order Check app (1.4.0 and earlier) holds this mutex while it runs.
        // Holding it here also stops an old copy from starting a second reader.
        internal static bool Claim() {
            if (held != null) return true;
            bool created;
            var m = new Mutex(false, @"Local\TempeOrderCheck_v1", out created);
            if (!created) { m.Dispose(); return false; }
            held = m;
            return true;
        }
        // The board: board-url.txt (your GitHub page) when it holds a link, else the local copy.
        internal static string BoardAddress(string websiteFolder) {
            try {
                string urlFile = Path.Combine(websiteFolder, "board-url.txt");
                if (File.Exists(urlFile)) {
                    string url = File.ReadAllText(urlFile).Trim();
                    if (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return url;
                }
            } catch (Exception) { }
            return Path.Combine(websiteFolder, "Order_Check.html");
        }
    }

    // ---------------------------------------------------------------- Win32

    internal static class Win {
        internal delegate bool EnumProc(IntPtr h, IntPtr arg);
        [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll")] internal static extern bool EnumWindows(EnumProc fn, IntPtr arg);
        [DllImport("user32.dll")] internal static extern bool EnumChildWindows(IntPtr h, EnumProc fn, IntPtr arg);
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] internal static extern IntPtr GetParent(IntPtr h);
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr h, out Rect r);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClassName(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode)]
        internal static extern IntPtr SendText(IntPtr h, uint msg, UIntPtr w, StringBuilder s, uint flags, uint timeout, out UIntPtr result);
        [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW")]
        internal static extern IntPtr SendNull(IntPtr h, uint msg, UIntPtr w, IntPtr l, uint flags, uint timeout, out UIntPtr result);

        internal static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
        internal static string Class(IntPtr h) { var b = new StringBuilder(256); GetClassName(h, b, b.Capacity); return b.ToString(); }
        internal static string Caption(IntPtr h) { var b = new StringBuilder(512); GetWindowText(h, b, b.Capacity); return b.ToString(); }
        // WM_NULL with SMTO_ABORTIFHUNG: true when COSTAR's UI thread answers in time.
        internal static bool Responsive(IntPtr h, uint timeoutMs) {
            UIntPtr r;
            return SendNull(h, 0, UIntPtr.Zero, IntPtr.Zero, 0x0002, timeoutMs, out r) != IntPtr.Zero;
        }
        // WM_GETTEXT works for controls in another process (GetWindowText does not).
        internal static string Text(IntPtr h) {
            var b = new StringBuilder(1024); UIntPtr r;
            if (SendText(h, 0x000D, new UIntPtr((uint)b.Capacity), b, 0x0003, 500, out r) == IntPtr.Zero) return null;
            return b.ToString();
        }
        internal static List<IntPtr> Children(IntPtr parent) {
            var list = new List<IntPtr>();
            EnumChildWindows(parent, delegate(IntPtr h, IntPtr a) { list.Add(h); return true; }, IntPtr.Zero);
            return list;
        }
    }

    // ---------------------------------------------------------------- MSAA

    internal static class Msaa {
        [DllImport("oleacc.dll")]
        static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object acc);
        [DllImport("oleacc.dll")]
        static extern int AccessibleChildren(IAccessible parent, int start, int count, [Out] object[] children, out int obtained);

        internal const int RoleTable = 24, RoleRow = 28;
        static int calls;
        internal static int Calls { get { return calls; } }

        internal static IAccessible FromWindow(IntPtr h) {
            Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
            object acc;
            Interlocked.Increment(ref calls);
            int hr = AccessibleObjectFromWindow(h, 0xFFFFFFFC, ref iid, out acc);
            if (hr != 0 || acc == null) throw new InvalidOperationException("COSTAR did not answer the accessibility request (code 0x" + hr.ToString("X8") + ").");
            return (IAccessible)acc;
        }
        internal static IAccessible Child(IAccessible parent, int oneBased) {
            Interlocked.Increment(ref calls);
            object o = parent.get_accChild(oneBased);
            return o as IAccessible;
        }
        internal static int Count(IAccessible a) { Interlocked.Increment(ref calls); return a.accChildCount; }
        internal static int Role(IAccessible a) {
            Interlocked.Increment(ref calls);
            object r = a.get_accRole(0);
            return r is int ? (int)r : -1;
        }
        internal static string Name(IAccessible a) { Interlocked.Increment(ref calls); return a.get_accName(0) ?? ""; }
        internal static string Value(IAccessible a) { Interlocked.Increment(ref calls); return a.get_accValue(0) ?? ""; }
        internal static void DoDefault(IAccessible a) { Interlocked.Increment(ref calls); a.accDoDefaultAction(0); }
        internal static List<object> All(IAccessible parent, int count) {
            var list = new List<object>();
            if (count <= 0) return list;
            var items = new object[count]; int got;
            Interlocked.Increment(ref calls);
            int hr = AccessibleChildren(parent, 0, count, items, out got);
            if (hr < 0) return list;
            for (int i = 0; i < got; i++) list.Add(items[i]);
            return list;
        }
        internal static void Release(object o) {
            if (o != null && Marshal.IsComObject(o)) { try { Marshal.ReleaseComObject(o); } catch (Exception) { } }
        }
    }

    // ---------------------------------------------------------------- COSTAR windows

    internal sealed class CostarTarget {
        internal int Pid;
        internal IntPtr Main;
        internal DateTime Started;
        internal string Title;
        internal bool OnWip;
        internal string Key { get { return Pid.ToString(CultureInfo.InvariantCulture) + "@" + Started.Ticks.ToString(CultureInfo.InvariantCulture); } }
        internal string Describe() { return "PID " + Pid + ", opened " + Started.ToString("ddd HH:mm", CultureInfo.InvariantCulture); }
        public override string ToString() { return "Tempe COSTAR, " + Describe() + (OnWip ? ", on Work-in-Progress" : ", not on Work-in-Progress"); }
    }

    internal static class Costar {
        static readonly Regex MainTitle = new Regex(@"^COSTAR:\s*11\s+Tempe\s+Tyres\s+Tempe(?:\s|$)", RegexOptions.IgnoreCase);
        internal static bool IsTempeTitle(string t) { return MainTitle.IsMatch(t ?? ""); }

        internal static List<CostarTarget> Find() {
            var windows = new List<IntPtr>();
            Win.EnumWindows(delegate(IntPtr h, IntPtr a) {
                if (Win.IsWindowVisible(h) && IsTempeTitle(Win.Caption(h))) windows.Add(h);
                return true;
            }, IntPtr.Zero);
            var result = new List<CostarTarget>();
            int session;
            using (Process self = Process.GetCurrentProcess()) session = self.SessionId;
            foreach (IntPtr h in windows) {
                int pid = (int)Win.Pid(h);
                try {
                    using (Process p = Process.GetProcessById(pid)) {
                        if (!string.Equals(p.ProcessName, "COSTAR", StringComparison.OrdinalIgnoreCase) || p.SessionId != session) continue;
                        var t = new CostarTarget();
                        t.Pid = pid; t.Main = h; t.Started = p.StartTime; t.Title = Win.Caption(h);
                        t.OnWip = WipScreen.Locate(h) != null;
                        result.Add(t);
                    }
                } catch (Exception) { }
            }
            result.Sort(delegate(CostarTarget x, CostarTarget y) { return x.Started.CompareTo(y.Started); });
            return result;
        }

        internal static bool StillValid(CostarTarget t) {
            if (t == null || !Win.IsWindow(t.Main) || Win.Pid(t.Main) != (uint)t.Pid || !IsTempeTitle(Win.Caption(t.Main))) return false;
            try { using (Process p = Process.GetProcessById(t.Pid)) return p.StartTime == t.Started; }
            catch (Exception) { return false; }
        }

        internal static bool OrderWindowOpen(int pid) {
            bool open = false;
            Win.EnumWindows(delegate(IntPtr h, IntPtr a) {
                if (Win.Pid(h) == (uint)pid && Win.IsWindowVisible(h) && Win.Caption(h).StartsWith("RepairOrder", StringComparison.OrdinalIgnoreCase)) { open = true; return false; }
                return true;
            }, IntPtr.Zero);
            return open;
        }
    }

    internal sealed class WipHandles {
        internal IntPtr Pane, Grid, Search;
        internal bool Valid() {
            return Win.IsWindow(Grid) && Win.IsWindowVisible(Grid) && Win.IsWindow(Pane) && Win.GetParent(Grid) == Pane;
        }
    }

    internal sealed class Box {
        internal string Text;
        internal Win.Rect Rect;
        internal Box(string text, Win.Rect rect) { Text = text; Rect = rect; }
    }

    internal static class WipScreen {
        internal static WipHandles Locate(IntPtr main) {
            IntPtr label = IntPtr.Zero;
            foreach (IntPtr h in Win.Children(main)) {
                if (!Win.IsWindowVisible(h) || Win.Class(h).IndexOf("STATIC", StringComparison.OrdinalIgnoreCase) < 0) continue;
                string t = Win.Text(h);
                if (t != null && t.Trim() == "Work-in-Progress") { label = h; break; }
            }
            if (label == IntPtr.Zero) return null;
            var found = new WipHandles();
            found.Pane = Win.GetParent(label);
            long bestArea = 0; int searchButtons = 0;
            foreach (IntPtr h in Win.Children(found.Pane)) {
                if (!Win.IsWindowVisible(h)) continue;
                string cls = Win.Class(h);
                if (cls.IndexOf("BUTTON", StringComparison.OrdinalIgnoreCase) >= 0) {
                    if (Text.Norm(Win.Text(h)) == "SEARCH") { found.Search = h; searchButtons++; }
                    continue;
                }
                if (Win.GetParent(h) != found.Pane || cls.IndexOf(".Window.", StringComparison.OrdinalIgnoreCase) < 0) continue;
                Win.Rect r;
                if (!Win.GetWindowRect(h, out r)) continue;
                long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
                if (area > bestArea) { bestArea = area; found.Grid = h; }
            }
            if (searchButtons != 1) found.Search = IntPtr.Zero;
            return found.Grid == IntPtr.Zero ? null : found;
        }

        // "Written By = MOR" when a WIP search box is filled in, otherwise "".
        internal static string FilterText(WipHandles h) {
            var labels = new List<Box>(); var edits = new List<Box>();
            foreach (IntPtr c in Win.Children(h.Pane)) {
                if (!Win.IsWindowVisible(c)) continue;
                string cls = Win.Class(c);
                bool isEdit = cls.IndexOf(".EDIT.", StringComparison.OrdinalIgnoreCase) >= 0;
                bool isLabel = cls.IndexOf(".STATIC.", StringComparison.OrdinalIgnoreCase) >= 0;
                if (!isEdit && !isLabel) continue;
                string t = Win.Text(c); Win.Rect r;
                if (t == null || !Win.GetWindowRect(c, out r)) continue;
                if (isEdit) edits.Add(new Box(t, r)); else labels.Add(new Box(t, r));
            }
            return Describe(labels, edits);
        }

        internal static string Describe(List<Box> labels, List<Box> edits) {
            var parts = new List<string>();
            foreach (Box e in edits) {
                string value = (e.Text ?? "").Trim();
                if (value.Length == 0) continue;
                int mid = (e.Rect.Top + e.Rect.Bottom) / 2; string name = "A search box"; int best = int.MaxValue;
                foreach (Box l in labels) {
                    int lmid = (l.Rect.Top + l.Rect.Bottom) / 2; int gap = Math.Abs(lmid - mid);
                    if (gap <= 10 && l.Rect.Right <= e.Rect.Left + 8 && gap < best && (l.Text ?? "").Trim().Length > 0) { best = gap; name = l.Text.Trim(); }
                }
                parts.Add(name + " = " + value);
            }
            return string.Join(", ", parts.ToArray());
        }
    }

    // ---------------------------------------------------------------- rows

    internal static class Text {
        internal static string Norm(string s) { return Regex.Replace((s ?? "").Replace("&", ""), @"\s+", " ").Trim().ToUpperInvariant(); }
        internal static string Clean(string s) { return Regex.Replace(s ?? "", @"\s+", " ").Trim(); }
        internal static bool TryTotal(string s, out decimal total) {
            total = 0m;
            string t = Regex.Replace(s ?? "", @"[^0-9.\-]", "");
            if (t.Length == 0) return false;
            return decimal.TryParse(t, NumberStyles.Number, CultureInfo.InvariantCulture, out total);
        }
        internal static string IsoDate(string s) {
            DateTime d;
            string[] formats = { "dd MMM yyyy", "d MMM yyyy", "dd/MM/yyyy", "d/MM/yyyy", "d/M/yyyy", "dd/MM/yy" };
            if (DateTime.TryParseExact(Clean(s), formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out d)) return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            return "";
        }
        internal static string Signature(WipRow r) {
            string raw = Norm(r.ShipVia) + "|" + r.OrderDateIso + "|" + r.Total.ToString("F2", CultureInfo.InvariantCulture) + "|" + Norm(r.Comment) + "|" + Norm(r.By);
            using (SHA1 sha = SHA1.Create()) {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(raw));
                return BitConverter.ToString(hash, 0, 6).Replace("-", "").ToLowerInvariant();
            }
        }
        internal static bool InShopHours(DateTime t) {
            if (t.DayOfWeek == DayOfWeek.Sunday) return false;
            int m = t.Hour * 60 + t.Minute;
            return m >= 7 * 60 && m <= 18 * 60 + 30;
        }
    }

    internal sealed class WipRow {
        internal string Doc = "", OrderDateText = "", OrderDateIso = "", Name = "", ShipVia = "", Comment = "", By = "", Status = "", Completed = "", Po = "";
        internal decimal Total; internal bool HasTotal;
        internal string Sig = "", FirstSeen = "", ChangedAt = "";

        static string Get(Dictionary<string, string> v, string key) { string s; return v.TryGetValue(key, out s) ? s : ""; }
        internal static WipRow From(Dictionary<string, string> v) {
            var r = new WipRow();
            r.Doc = Text.Clean(Get(v, "Document #"));
            r.OrderDateText = Text.Clean(Get(v, "Order Date"));
            r.OrderDateIso = Text.IsoDate(r.OrderDateText);
            r.Name = Text.Clean(Get(v, "Name"));
            r.Po = Text.Clean(Get(v, "PO"));
            decimal t; r.HasTotal = Text.TryTotal(Get(v, "Doc Total"), out t); r.Total = r.HasTotal ? t : 0m;
            r.ShipVia = Text.Clean(Get(v, "Ship Via"));
            r.Comment = Text.Clean(Get(v, "Comment"));
            r.By = Text.Clean(Get(v, "Written By"));
            r.Status = Text.Clean(Get(v, "Status"));
            r.Completed = Text.Clean(Get(v, "Completed"));
            return r;
        }
    }

    // Reads only the columns the board needs. The column map is built once and
    // re-checked cheaply on the first row of every read.
    internal sealed class GridReader {
        internal static readonly string[] Wanted = { "Document #", "Order Date", "Name", "Doc Total", "Ship Via", "Comment", "Written By", "Status", "Completed" };
        internal static readonly string[] Required = { "Document #", "Order Date", "Doc Total", "Ship Via", "Written By", "Comment" };
        // COSTAR's PO column holds the COSTAR helper's TTW (online) or MJC (mobile) reference.
        // Optional: without it Order Check works as before and shows no helper tags.
        static readonly string[] PoNames = { "PO", "PO#", "PONO", "PONUMBER", "CUSTOMERPO", "CUSTOMERPO#", "CUSTPO", "CUSTPO#", "PURCHASEORDER", "PURCHASEORDERNO" };
        internal string PoColumn = "";
        internal List<string> Columns = new List<string>();
        internal static string FindPoColumn(IEnumerable<string> names) {
            foreach (string n in names) {
                string k = Regex.Replace((n ?? "").ToUpperInvariant(), "[^A-Z0-9#]", "");
                if (Array.IndexOf(PoNames, k) >= 0) return n;
            }
            return "";
        }
        Dictionary<string, int> map;
        int mapCells;
        bool enumerate;

        internal int TableRowCount(IntPtr grid) {
            IAccessible client = null, table = null;
            try {
                client = Msaa.FromWindow(grid);
                table = FindTable(client);
                return table == null ? -1 : Msaa.Count(table);
            } finally { Msaa.Release(table); Msaa.Release(client); }
        }

        internal List<WipRow> Read(IntPtr grid) {
            var rows = new List<WipRow>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            IAccessible client = null, table = null;
            try {
                client = Msaa.FromWindow(grid);
                table = FindTable(client);
                if (table == null) throw new InvalidOperationException("The WIP list isn't showing a table. Press Search in the WIP COSTAR window.");
                int count = Msaa.Count(table);
                bool mapped = false;
                IAccessible probe = count > 0 ? Msaa.Child(table, 1) : null;
                if (probe != null || count == 0) {
                    Msaa.Release(probe);
                    for (int i = 1; i <= count; i++) {
                        IAccessible row = Msaa.Child(table, i);
                        if (row == null) continue;
                        try { Take(row, rows, seen, ref mapped); } finally { Msaa.Release(row); }
                        if (i % 20 == 0) Thread.Sleep(2);
                    }
                } else {
                    List<object> all = Msaa.All(table, count);
                    try {
                        foreach (object o in all) { IAccessible row = o as IAccessible; if (row != null) Take(row, rows, seen, ref mapped); }
                    } finally { foreach (object o in all) Msaa.Release(o); }
                }
            } finally { Msaa.Release(table); Msaa.Release(client); }
            return rows;
        }

        void Take(IAccessible row, List<WipRow> rows, HashSet<string> seen, ref bool mapped) {
            if (Msaa.Role(row) != Msaa.RoleRow) return;
            if (!mapped) { EnsureMap(row); mapped = true; }
            WipRow r = ReadRow(row);
            if (r.Doc.Length > 0 && seen.Add(r.Doc)) rows.Add(r);
        }

        static IAccessible FindTable(IAccessible client) {
            int n = Math.Min(Msaa.Count(client), 8);
            for (int i = 1; i <= n; i++) {
                IAccessible c = Msaa.Child(client, i);
                if (c == null) continue;
                if (Msaa.Role(c) == Msaa.RoleTable) return c;
                Msaa.Release(c);
            }
            IAccessible found = null;
            foreach (object o in Msaa.All(client, n)) {
                IAccessible a = o as IAccessible;
                if (found == null && a != null && Msaa.Role(a) == Msaa.RoleTable) found = a; else Msaa.Release(o);
            }
            return found;
        }

        void EnsureMap(IAccessible row) {
            int cells = Msaa.Count(row);
            if (map != null && cells == mapCells && MapStillValid(row)) return;
            map = null; mapCells = cells; enumerate = false;
            var fresh = new Dictionary<string, int>(StringComparer.Ordinal);
            IAccessible first = cells > 0 ? Msaa.Child(row, 1) : null;
            if (first == null) {
                enumerate = true;
                List<object> all = Msaa.All(row, cells);
                for (int j = 0; j < all.Count; j++) {
                    IAccessible c = all[j] as IAccessible;
                    if (c != null) { string n = Msaa.Name(c).Trim(); if (!fresh.ContainsKey(n)) fresh[n] = j + 1; }
                    Msaa.Release(all[j]);
                }
            } else {
                Msaa.Release(first);
                for (int j = 1; j <= cells; j++) {
                    IAccessible c = Msaa.Child(row, j);
                    if (c == null) continue;
                    try { string n = Msaa.Name(c).Trim(); if (!fresh.ContainsKey(n)) fresh[n] = j; } finally { Msaa.Release(c); }
                }
            }
            foreach (string need in Required)
                if (!fresh.ContainsKey(need)) throw new InvalidOperationException("The WIP list has no \"" + need + "\" column. Restore COSTAR's standard WIP columns.");
            map = fresh;
            PoColumn = FindPoColumn(fresh.Keys);
            Columns = new List<string>(fresh.Keys);
        }

        bool MapStillValid(IAccessible row) {
            if (enumerate) return true;
            foreach (string need in Required) {
                IAccessible c = Msaa.Child(row, map[need]);
                if (c == null) return false;
                try { if (Msaa.Name(c).Trim() != need) return false; } finally { Msaa.Release(c); }
            }
            return true;
        }

        WipRow ReadRow(IAccessible row) {
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            if (enumerate) {
                List<object> all = Msaa.All(row, mapCells);
                try {
                    foreach (string col in Wanted) {
                        int idx;
                        if (!map.TryGetValue(col, out idx) || idx - 1 >= all.Count) continue;
                        IAccessible c = all[idx - 1] as IAccessible;
                        values[col] = c == null ? "" : Msaa.Value(c);
                    }
                    int po;
                    if (PoColumn.Length > 0 && map.TryGetValue(PoColumn, out po) && po - 1 < all.Count) {
                        IAccessible pc = all[po - 1] as IAccessible;
                        values["PO"] = pc == null ? "" : Msaa.Value(pc);
                    }
                } finally { foreach (object o in all) Msaa.Release(o); }
            } else {
                foreach (string col in Wanted) {
                    int idx;
                    if (!map.TryGetValue(col, out idx)) continue;
                    IAccessible c = Msaa.Child(row, idx);
                    if (c == null) { values[col] = ""; continue; }
                    try { values[col] = Msaa.Value(c); } finally { Msaa.Release(c); }
                }
                int po;
                if (PoColumn.Length > 0 && map.TryGetValue(PoColumn, out po)) {
                    IAccessible pc = Msaa.Child(row, po);
                    if (pc != null) { try { values["PO"] = Msaa.Value(pc); } finally { Msaa.Release(pc); } }
                }
            }
            return WipRow.From(values);
        }
    }

    // ---------------------------------------------------------------- state

    internal static class Json {
        internal static JavaScriptSerializer Serializer() { var s = new JavaScriptSerializer(); s.MaxJsonLength = 16 * 1024 * 1024; return s; }
        internal static Dictionary<string, object> Parse(string text) {
            try { return Serializer().DeserializeObject(text) as Dictionary<string, object>; } catch (Exception) { return null; }
        }
        internal static Dictionary<string, object> Obj(Dictionary<string, object> d, string k) {
            object o; return d != null && d.TryGetValue(k, out o) ? o as Dictionary<string, object> : null;
        }
        internal static string Str(Dictionary<string, object> d, string k) {
            object o; return d != null && d.TryGetValue(k, out o) && o != null ? Convert.ToString(o, CultureInfo.InvariantCulture) : "";
        }
        internal static int Int(Dictionary<string, object> d, string k, int fallback) {
            object o;
            if (d != null && d.TryGetValue(k, out o) && o != null) { try { return Convert.ToInt32(o, CultureInfo.InvariantCulture); } catch (Exception) { } }
            return fallback;
        }
        internal static bool Bool(Dictionary<string, object> d, string k, bool fallback) {
            object o; return d != null && d.TryGetValue(k, out o) && o is bool ? (bool)o : fallback;
        }
        internal static void WriteAtomic(string path, string text) {
            string temp = path + ".tmp";
            File.WriteAllText(temp, text, new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
        }
    }

    internal sealed class Settings {
        internal int IntervalSeconds = 120;
        internal bool ShopHoursOnly = true, ClickSearch = true;
        internal string TargetKey = "";
        static string FilePath() { return Path.Combine(AppInfo.DataFolder(), "settings.json"); }
        internal static Settings Load() {
            var s = new Settings();
            try {
                if (File.Exists(FilePath())) {
                    Dictionary<string, object> d = Json.Parse(File.ReadAllText(FilePath(), Encoding.UTF8));
                    s.IntervalSeconds = Json.Int(d, "intervalSeconds", 120);
                    s.ShopHoursOnly = Json.Bool(d, "shopHoursOnly", true);
                    s.ClickSearch = Json.Bool(d, "clickSearch", true);
                    s.TargetKey = Json.Str(d, "targetKey");
                }
            } catch (Exception) { }
            if (s.IntervalSeconds != 60 && s.IntervalSeconds != 120 && s.IntervalSeconds != 180 && s.IntervalSeconds != 300) s.IntervalSeconds = 120;
            return s;
        }
        internal void Save() {
            try {
                var d = new Dictionary<string, object>();
                d["intervalSeconds"] = IntervalSeconds; d["shopHoursOnly"] = ShopHoursOnly; d["clickSearch"] = ClickSearch; d["targetKey"] = TargetKey;
                Json.WriteAtomic(FilePath(), Json.Serializer().Serialize(d));
            } catch (Exception) { }
        }
    }

    internal sealed class DocState { internal string FirstSeen = "", Sig = "", ChangedAt = "", LastSeen = ""; }
    internal sealed class AckInfo { internal string Sig = "", By = "", At = ""; }

    // Keeps the last read, first-seen / changed times, and "OK, not needed" marks.
    // The JSON served to the board is rebuilt only when something changes.
    internal sealed class Store {
        readonly object gate = new object();
        readonly string path;
        readonly Dictionary<string, DocState> docs = new Dictionary<string, DocState>(StringComparer.Ordinal);
        readonly Dictionary<string, AckInfo> acks = new Dictionary<string, AckInfo>(StringComparer.Ordinal);
        bool hadState;
        string poColumn = "";
        List<string> columns = new List<string>();
        internal void SetColumns(string po, List<string> names) { lock (gate) { poColumn = po ?? ""; columns = names == null ? new List<string>() : new List<string>(names); } }
        internal string PoColumn { get { lock (gate) return poColumn; } }
        List<WipRow> rows = new List<WipRow>();
        string state = "starting", message = "Starting", readAt = "", filter = "", note = "", target = "";
        long readMs; int intervalSeconds = 120;
        byte[] snapshot = new byte[0];

        internal Store(string folder) { path = Path.Combine(folder, "state.json"); Load(); Rebuild(); }

        internal byte[] Snapshot() { lock (gate) return snapshot; }
        internal string State { get { lock (gate) return state; } }
        internal string Message { get { lock (gate) return message; } }
        internal string Summary() {
            lock (gate) {
                if (readAt.Length == 0) return "No read yet.";
                DateTimeOffset at; string time = DateTimeOffset.TryParse(readAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out at) ? at.ToString("HH:mm:ss", CultureInfo.InvariantCulture) : readAt;
                return "Last read " + time + ": " + rows.Count + " jobs in " + (readMs / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s." + (filter.Length > 0 ? " Filtered: " + filter + "." : "");
            }
        }

        internal void SetState(string newState, string newMessage) {
            lock (gate) {
                if (state == newState && message == newMessage) return;
                state = newState; message = newMessage; Rebuild();
            }
        }
        internal void SetMeta(string targetText, int interval) {
            lock (gate) { target = targetText ?? ""; intervalSeconds = interval; Rebuild(); }
        }

        internal void Update(List<WipRow> fresh, string filterText, long ms, DateTime now, string readNote) {
            lock (gate) {
                string stamp = AppInfo.Stamp(now);
                bool bootstrap = !hadState && docs.Count == 0;
                foreach (WipRow r in fresh) {
                    r.Sig = Text.Signature(r);
                    DocState d;
                    if (!docs.TryGetValue(r.Doc, out d)) {
                        d = new DocState(); d.FirstSeen = stamp; d.ChangedAt = bootstrap ? "" : stamp; d.Sig = r.Sig; docs[r.Doc] = d;
                    } else if (d.Sig != r.Sig) { d.Sig = r.Sig; d.ChangedAt = stamp; }
                    d.LastSeen = stamp; r.FirstSeen = d.FirstSeen; r.ChangedAt = d.ChangedAt;
                }
                Prune(now);
                rows = fresh; readAt = stamp; readMs = ms; filter = filterText ?? ""; note = readNote ?? "";
                state = "ok";
                message = filter.Length > 0 ? "WIP is filtered (" + filter + "). Clear the WIP search boxes and press Search to see every salesperson." : (note.Length > 0 ? note : "Reading normally.");
                hadState = true;
                Save(); Rebuild();
            }
        }

        internal bool Ack(string doc, string sig, string by, DateTime now) {
            lock (gate) {
                if (string.IsNullOrEmpty(doc) || !docs.ContainsKey(doc)) return false;
                var a = new AckInfo(); a.Sig = sig ?? ""; a.By = CleanBy(by); a.At = AppInfo.Stamp(now);
                acks[doc] = a; Save(); Rebuild(); return true;
            }
        }
        internal bool Unack(string doc) {
            lock (gate) {
                bool removed = acks.Remove(doc ?? "");
                if (removed) { Save(); Rebuild(); }
                return removed;
            }
        }
        internal static string CleanBy(string by) {
            string s = Regex.Replace(by ?? "", @"[^A-Za-z0-9 ]", "").Trim().ToUpperInvariant();
            if (s.Length > 12) s = s.Substring(0, 12);
            return s.Length == 0 ? "?" : s;
        }

        void Prune(DateTime now) {
            var gone = new List<string>();
            foreach (KeyValuePair<string, DocState> kv in docs) {
                DateTimeOffset seen;
                if (!DateTimeOffset.TryParse(kv.Value.LastSeen, CultureInfo.InvariantCulture, DateTimeStyles.None, out seen) || (now - seen.LocalDateTime).TotalDays > 30) gone.Add(kv.Key);
            }
            foreach (string k in gone) docs.Remove(k);
            var stale = new List<string>();
            foreach (string k in acks.Keys) if (!docs.ContainsKey(k)) stale.Add(k);
            foreach (string k in stale) acks.Remove(k);
        }

        void Load() {
            try {
                if (!File.Exists(path)) return;
                Dictionary<string, object> root = Json.Parse(File.ReadAllText(path, Encoding.UTF8));
                if (root == null) { File.Copy(path, path + ".bad", true); return; }
                hadState = true;
                Dictionary<string, object> d = Json.Obj(root, "docs");
                if (d != null) foreach (KeyValuePair<string, object> kv in d) {
                    var o = kv.Value as Dictionary<string, object>; if (o == null) continue;
                    var s = new DocState(); s.FirstSeen = Json.Str(o, "firstSeen"); s.Sig = Json.Str(o, "sig"); s.ChangedAt = Json.Str(o, "changedAt"); s.LastSeen = Json.Str(o, "lastSeen");
                    docs[kv.Key] = s;
                }
                Dictionary<string, object> a = Json.Obj(root, "acks");
                if (a != null) foreach (KeyValuePair<string, object> kv in a) {
                    var o = kv.Value as Dictionary<string, object>; if (o == null) continue;
                    var s = new AckInfo(); s.Sig = Json.Str(o, "sig"); s.By = Json.Str(o, "by"); s.At = Json.Str(o, "at");
                    acks[kv.Key] = s;
                }
            } catch (Exception) { }
        }

        void Save() {
            try {
                var d = new Dictionary<string, object>();
                foreach (KeyValuePair<string, DocState> kv in docs) {
                    var o = new Dictionary<string, object>();
                    o["firstSeen"] = kv.Value.FirstSeen; o["sig"] = kv.Value.Sig; o["changedAt"] = kv.Value.ChangedAt; o["lastSeen"] = kv.Value.LastSeen;
                    d[kv.Key] = o;
                }
                var root = new Dictionary<string, object>();
                root["version"] = AppInfo.Version; root["docs"] = d; root["acks"] = AckMap();
                Json.WriteAtomic(path, Json.Serializer().Serialize(root));
            } catch (Exception) { }
        }

        Dictionary<string, object> AckMap() {
            var map = new Dictionary<string, object>();
            foreach (KeyValuePair<string, AckInfo> kv in acks) {
                var o = new Dictionary<string, object>(); o["sig"] = kv.Value.Sig; o["by"] = kv.Value.By; o["at"] = kv.Value.At;
                map[kv.Key] = o;
            }
            return map;
        }

        void Rebuild() {
            var root = new Dictionary<string, object>();
            root["app"] = AppInfo.Title; root["version"] = AppInfo.Version;
            root["state"] = state; root["message"] = message;
            root["readAt"] = readAt; root["readMs"] = readMs; root["jobs"] = rows.Count;
            root["filter"] = filter; root["target"] = target; root["intervalSeconds"] = intervalSeconds;
            root["poColumn"] = poColumn; root["columns"] = columns;
            var list = new List<object>();
            foreach (WipRow r in rows) {
                var o = new Dictionary<string, object>();
                o["doc"] = r.Doc; o["orderDate"] = r.OrderDateIso; o["orderDateText"] = r.OrderDateText; o["name"] = r.Name;
                o["total"] = r.Total; o["hasTotal"] = r.HasTotal; o["shipVia"] = r.ShipVia; o["comment"] = r.Comment; o["by"] = r.By;
                o["status"] = r.Status; o["completed"] = r.Completed; o["sig"] = r.Sig; o["firstSeen"] = r.FirstSeen; o["changedAt"] = r.ChangedAt;
                o["po"] = r.Po;
                list.Add(o);
            }
            root["rows"] = list;
            root["acks"] = AckMap();
            snapshot = Encoding.UTF8.GetBytes(Json.Serializer().Serialize(root));
        }
    }

    // ---------------------------------------------------------------- reader loop

    internal sealed class Poller {
        readonly Store store;
        readonly GridReader reader = new GridReader();
        readonly AutoResetEvent wake = new AutoResetEvent(false);
        readonly object gate = new object();
        CostarTarget target; WipHandles handles;
        Thread worker, clickThread;
        volatile string clickError;
        volatile bool stopping, paused, readRequested;
        int intervalSeconds = 120; bool shopHoursOnly = true, clickSearch = true;
        DateTime nextDue = DateTime.MinValue, lastManual = DateTime.MinValue;
        bool hasRead;   // the first read happens even outside shop hours, so a restart always has data

        internal Poller(Store store) { this.store = store; }

        internal void Configure(int interval, bool shopHours, bool click) {
            lock (gate) { intervalSeconds = Math.Max(60, interval); shopHoursOnly = shopHours; clickSearch = click; nextDue = DateTime.MinValue; }
            wake.Set();
        }
        internal void SetTarget(CostarTarget t) {
            lock (gate) { target = t; handles = null; nextDue = DateTime.MinValue; }
            wake.Set();
        }
        internal CostarTarget Target { get { lock (gate) return target; } }
        internal bool Paused { get { return paused; } set { paused = value; lock (gate) nextDue = DateTime.MinValue; wake.Set(); } }
        internal bool RequestRead() {
            lock (gate) {
                if ((DateTime.Now - lastManual).TotalSeconds < 15) return false;
                lastManual = DateTime.Now;
            }
            readRequested = true; wake.Set(); return true;
        }
        internal void Start() {
            worker = new Thread(Loop);
            worker.IsBackground = true; worker.Priority = ThreadPriority.BelowNormal; worker.Name = "WIP reader";
            worker.SetApartmentState(ApartmentState.MTA);
            worker.Start();
        }
        internal void Stop() { stopping = true; wake.Set(); }

        void Loop() {
            int wait = 2;
            while (!stopping) {
                wake.WaitOne(TimeSpan.FromSeconds(wait));
                if (stopping) break;
                try { wait = Cycle(); }
                catch (Exception e) {
                    lock (gate) { handles = null; nextDue = DateTime.Now.AddSeconds(30); }
                    store.SetState("error", AppInfo.Short(e));
                    wait = 30;
                }
            }
        }

        int Wait(string state, string message, int seconds) {
            store.SetState(state, message);
            lock (gate) nextDue = DateTime.Now.AddSeconds(seconds);
            return seconds;
        }

        int Cycle() {
            CostarTarget t; WipHandles h; int interval; bool shopHours, click; DateTime due;
            lock (gate) { t = target; h = handles; interval = intervalSeconds; shopHours = shopHoursOnly; click = clickSearch; due = nextDue; }
            bool manual = readRequested; readRequested = false;
            DateTime now = DateTime.Now;
            if (paused && !manual) { store.SetState("paused", "Paused. Press Resume in Order Check."); return 3600; }
            if (!manual && now < due) return Math.Max(1, (int)Math.Ceiling((due - now).TotalSeconds));
            if (shopHours && !manual && hasRead && !Text.InShopHours(now)) return Wait("sleeping", "Outside shop hours (Monday to Saturday, 7:00 to 18:30). Press Read now to read anyway.", 300);
            if (t == null) return Wait("setup", "Choose the WIP COSTAR window in Order Check.", 10);
            Func<int> entryPid = Hosting.EntryPid;
            if (entryPid != null && entryPid() == t.Pid) return Wait("setup", "That is the COSTAR the helper types into. Choose a second Tempe COSTAR for Order Check.", 30);
            Func<bool> hold = Hosting.Hold;
            if (hold != null && hold()) return Wait("waiting", "The helper is entering an order, so reading waits until it finishes.", 10);
            if (!Costar.StillValid(t)) {
                lock (gate) { if (target == t) { target = null; handles = null; } }
                return Wait("setup", "The chosen COSTAR window was closed. Choose the WIP COSTAR window again in Order Check.", 10);
            }
            if (Costar.OrderWindowOpen(t.Pid)) return Wait("waiting", "A Repair Order is open in the WIP COSTAR, so reading waits until it closes.", 30);
            if (Win.Pid(Win.GetForegroundWindow()) == (uint)t.Pid) return Wait("waiting", "You're using the WIP COSTAR window. Reading resumes when you switch away.", 15);
            if (h == null || !h.Valid()) {
                h = WipScreen.Locate(t.Main);
                lock (gate) handles = h;
                if (h == null) return Wait("setup", "Open Work-in-Progress in the chosen COSTAR window.", 15);
            }
            if (!Win.Responsive(h.Grid, 2000)) return Wait("waiting", "COSTAR is busy. Trying again shortly.", 15);
            string filterText = WipScreen.FilterText(h);
            string note = "";
            if (click) {
                if (h.Search == IntPtr.Zero) note = "Search button not found, so the list was read as shown.";
                else {
                    string problem = PressSearch(h.Search);
                    if (problem != null) return Wait("waiting", problem, 30);
                    WaitForGrid(h.Grid);
                }
            }
            var timer = Stopwatch.StartNew();
            List<WipRow> rows = reader.Read(h.Grid);
            timer.Stop();
            store.SetColumns(reader.PoColumn, reader.Columns);
            store.Update(rows, filterText, timer.ElapsedMilliseconds, DateTime.Now, note);
            hasRead = true;
            lock (gate) nextDue = DateTime.Now.AddSeconds(interval);
            return interval;
        }

        string PressSearch(IntPtr button) {
            Thread pending;
            lock (gate) pending = clickThread;
            if (pending != null && pending.IsAlive) return "COSTAR is still finishing the last search. Is a popup open in the WIP window?";
            clickError = null;
            var th = new Thread(delegate() {
                IAccessible b = null;
                try { b = Msaa.FromWindow(button); Msaa.DoDefault(b); }
                catch (Exception e) { clickError = AppInfo.Short(e); }
                finally { Msaa.Release(b); }
            });
            th.IsBackground = true; th.Priority = ThreadPriority.BelowNormal; th.Name = "WIP search";
            th.SetApartmentState(ApartmentState.MTA);
            lock (gate) clickThread = th;
            th.Start();
            if (!th.Join(20000)) return "COSTAR didn't finish searching within 20 s. Is a popup open in the WIP window?";
            if (clickError != null) return "Couldn't press Search: " + clickError;
            return null;
        }

        void WaitForGrid(IntPtr grid) {
            var timer = Stopwatch.StartNew(); int last = -2;
            while (timer.ElapsedMilliseconds < 8000 && !stopping) {
                Thread.Sleep(400);
                if (!Win.Responsive(grid, 2000)) continue;
                int count = reader.TableRowCount(grid);
                if (count >= 0 && count == last) return;
                last = count;
            }
        }
    }

    // ---------------------------------------------------------------- loopback server

    internal sealed class HttpRequest {
        internal string Method = "", Path = "", Query = "";
        internal Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        internal byte[] Body = new byte[0];
        internal string Header(string name) { string v; return Headers.TryGetValue(name, out v) ? v : null; }
    }

    internal sealed class HttpResponse {
        internal int Code = 200; internal string Reason = "OK";
        internal string ContentType = "application/json; charset=utf-8";
        internal byte[] Body = new byte[0];
        internal Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }

    internal static class Http {
        internal const int MaxHead = 16384, MaxBody = 65536;

        internal static HttpRequest ParseHead(string head) {
            string[] lines = head.Split(new string[] { "\r\n" }, StringSplitOptions.None);
            if (lines.Length == 0) return null;
            string[] first = lines[0].Split(' ');
            if (first.Length != 3 || !first[2].StartsWith("HTTP/1.", StringComparison.Ordinal) || first[1].Length == 0 || first[1][0] != '/') return null;
            var r = new HttpRequest();
            r.Method = first[0].ToUpperInvariant();
            int q = first[1].IndexOf('?');
            r.Path = q >= 0 ? first[1].Substring(0, q) : first[1];
            r.Query = q >= 0 ? first[1].Substring(q + 1) : "";
            for (int i = 1; i < lines.Length; i++) {
                string line = lines[i];
                if (line.Length == 0) break;
                int c = line.IndexOf(':');
                if (c <= 0) return null;
                r.Headers[line.Substring(0, c).Trim()] = line.Substring(c + 1).Trim();
            }
            return r;
        }

        static int Find(byte[] data, int length) {
            for (int i = 0; i + 3 < length; i++) if (data[i] == 13 && data[i + 1] == 10 && data[i + 2] == 13 && data[i + 3] == 10) return i;
            return -1;
        }

        internal static HttpRequest Read(Stream s) {
            var buffer = new byte[MaxHead]; int filled = 0, end = -1;
            while (filled < buffer.Length) {
                int n = s.Read(buffer, filled, buffer.Length - filled);
                if (n <= 0) break;
                filled += n;
                end = Find(buffer, filled);
                if (end >= 0) break;
            }
            if (end < 0) return null;
            HttpRequest r = ParseHead(Encoding.ASCII.GetString(buffer, 0, end));
            if (r == null) return null;
            int length = 0; string declared = r.Header("Content-Length");
            if (declared != null && (!int.TryParse(declared, NumberStyles.None, CultureInfo.InvariantCulture, out length) || length > MaxBody)) return null;
            var body = new byte[length];
            int have = Math.Min(length, filled - (end + 4));
            if (have > 0) Buffer.BlockCopy(buffer, end + 4, body, 0, have);
            while (have < length) { int n = s.Read(body, have, length - have); if (n <= 0) return null; have += n; }
            r.Body = body;
            return r;
        }

        internal static bool HostAllowed(string host, int port) {
            if (host == null) return false;
            string h = host.Trim().ToLowerInvariant(); string p = ":" + port.ToString(CultureInfo.InvariantCulture);
            return h == "127.0.0.1" + p || h == "localhost" + p;
        }
        internal static bool OriginAllowed(string origin) {
            if (origin == null) return true;
            string o = origin.Trim();
            return o == "null" || o.StartsWith("chrome-extension://", StringComparison.Ordinal) || string.Equals(o, "https://tommyvenzin.github.io", StringComparison.OrdinalIgnoreCase);
        }

        internal static byte[] Serialize(HttpResponse r) {
            var head = new StringBuilder();
            head.Append("HTTP/1.1 ").Append(r.Code.ToString(CultureInfo.InvariantCulture)).Append(' ').Append(r.Reason).Append("\r\n");
            if (r.Body.Length > 0 || r.Code != 204) head.Append("Content-Type: ").Append(r.ContentType).Append("\r\n");
            head.Append("Content-Length: ").Append(r.Body.Length.ToString(CultureInfo.InvariantCulture)).Append("\r\n");
            head.Append("Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n");
            foreach (KeyValuePair<string, string> kv in r.Headers) head.Append(kv.Key).Append(": ").Append(kv.Value).Append("\r\n");
            head.Append("\r\n");
            byte[] h = Encoding.ASCII.GetBytes(head.ToString());
            var all = new byte[h.Length + r.Body.Length];
            Buffer.BlockCopy(h, 0, all, 0, h.Length);
            Buffer.BlockCopy(r.Body, 0, all, h.Length, r.Body.Length);
            return all;
        }

        internal static HttpResponse Json(int code, string reason, byte[] body) {
            var r = new HttpResponse(); r.Code = code; r.Reason = reason; r.Body = body; return r;
        }
        internal static HttpResponse Error(int code, string reason, string message) {
            var d = new Dictionary<string, object>(); d["ok"] = false; d["error"] = message;
            return Json(code, reason, Encoding.UTF8.GetBytes(TempeOrderCheck.Json.Serializer().Serialize(d)));
        }
    }

    internal sealed class HttpServer {
        readonly Store store; readonly Poller poller; readonly int port;
        TcpListener listener; Thread thread; volatile bool stopping;
        internal string Problem = "";
        // The port actually served: 8795, or the next free one up to 8804 when another Order
        // Check holds 8795 (on a shared RDP server that can be a copy left running in another
        // Windows session; 127.0.0.1 ports are shared by every session).
        internal int Port;
        readonly int session;

        internal HttpServer(Store store, Poller poller, int port) {
            this.store = store; this.poller = poller; this.port = port; Port = port;
            try { using (Process self = Process.GetCurrentProcess()) session = self.SessionId; } catch (Exception) { session = -1; }
        }

        internal bool Start() {
            Exception first = null;
            for (int candidate = port; candidate < port + 10 && listener == null; candidate++) {
                TcpListener attempt = null;
                try {
                    attempt = new TcpListener(IPAddress.Loopback, candidate);
                    attempt.ExclusiveAddressUse = true;
                    attempt.Start(16);
                    listener = attempt; Port = candidate;
                } catch (Exception e) {
                    if (first == null) first = e;
                    try { if (attempt != null) attempt.Stop(); } catch (Exception) { }
                }
            }
            if (listener == null) {
                Problem = "Ports " + port + "-" + (port + 9) + " are all in use, so the boards can't connect (" + AppInfo.Short(first) + ").";
                return false;
            }
            if (Port != port) Problem = "Port " + port + " is held by " + Occupant(port) + ", so this Order Check serves the boards on port " + Port +
                " (Open board and the Tempe Orders page find it). Close the other copy (Task Manager, Users tab) to use " + port + " again.";
            thread = new Thread(AcceptLoop);
            thread.IsBackground = true; thread.Name = "Board server";
            thread.Start();
            return true;
        }
        internal void Stop() {
            stopping = true;
            try { if (listener != null) listener.Stop(); } catch (Exception) { }
        }

        void AcceptLoop() {
            while (!stopping) {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch (Exception) { if (stopping) break; Thread.Sleep(200); continue; }
                ThreadPool.QueueUserWorkItem(Serve, client);
            }
        }

        void Serve(object state) {
            var client = (TcpClient)state;
            try {
                using (client) {
                    client.ReceiveTimeout = 3000; client.SendTimeout = 3000;
                    NetworkStream s = client.GetStream();
                    HttpRequest req = Http.Read(s);
                    HttpResponse resp = req == null ? Http.Error(400, "Bad Request", "Bad request") : Route(req);
                    byte[] bytes = Http.Serialize(resp);
                    s.Write(bytes, 0, bytes.Length);
                }
            } catch (Exception) { }
        }

        // Who this is: lets a page tell several Order Checks on one RDP server apart.
        string Health() {
            var o = new Dictionary<string, object>();
            o["ok"] = true; o["app"] = "Tempe Order Check"; o["version"] = AppInfo.Version; o["port"] = Port;
            o["state"] = store.State; o["session"] = session; o["user"] = Environment.UserName;
            return new JavaScriptSerializer().Serialize(o);
        }
        // What answers on a busy port: another Order Check (with its version and state) or not.
        static string Occupant(int busyPort) {
            try {
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + busyPort + "/health");
                request.Timeout = 1500; request.ReadWriteTimeout = 1500; request.Proxy = null;
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) {
                    string text = reader.ReadToEnd();
                    if (text.IndexOf("Tempe Order Check", StringComparison.Ordinal) < 0) return "another program";
                    var parts = new List<string>();
                    foreach (string key in new string[] { "version", "state", "user" }) {
                        Match m = Regex.Match(text, "\"" + key + "\":\"([^\"]{1,40})\"");
                        if (m.Success) parts.Add(key + " " + m.Groups[1].Value);
                    }
                    Match s = Regex.Match(text, "\"session\":(\\d+)");
                    if (s.Success) parts.Add("Windows session " + s.Groups[1].Value);
                    return "another Order Check (" + string.Join(", ", parts.ToArray()) + "), probably an old copy in another Windows session";
                }
            } catch (Exception) { }
            return "another program or an Order Check that does not answer";
        }
        internal HttpResponse Route(HttpRequest req) {
            if (!Http.HostAllowed(req.Header("Host"), Port)) return Http.Error(403, "Forbidden", "Host not allowed");
            string origin = req.Header("Origin");
            if (!Http.OriginAllowed(origin)) return Http.Error(403, "Forbidden", "Origin not allowed");
            HttpResponse resp;
            if (req.Method == "OPTIONS") {
                resp = Http.Json(204, "No Content", new byte[0]);
                resp.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
                resp.Headers["Access-Control-Allow-Headers"] = "Content-Type, X-Order-Check";
                resp.Headers["Access-Control-Allow-Private-Network"] = "true";
                resp.Headers["Access-Control-Max-Age"] = "600";
            } else if (req.Method == "GET" && req.Path == "/wip.json") {
                resp = Http.Json(200, "OK", store.Snapshot());
            } else if (req.Method == "GET" && req.Path == "/entered.json") {
                Func<string> entered = Hosting.Entered;
                resp = Http.Json(200, "OK", Encoding.UTF8.GetBytes(entered != null ? entered() : "{\"entered\":[]}"));
            } else if (req.Method == "GET" && req.Path == "/health") {
                resp = Http.Json(200, "OK", Encoding.UTF8.GetBytes(Health()));
            } else if (req.Method == "POST" && (req.Path == "/ack" || req.Path == "/unack" || req.Path == "/refresh")) {
                if (req.Header("X-Order-Check") != "1") return Http.Error(403, "Forbidden", "Missing X-Order-Check header");
                resp = Post(req);
            } else {
                resp = Http.Error(404, "Not Found", "Unknown path");
            }
            if (origin != null) { resp.Headers["Access-Control-Allow-Origin"] = origin; resp.Headers["Vary"] = "Origin"; }
            return resp;
        }

        HttpResponse Post(HttpRequest req) {
            if (req.Path == "/refresh") {
                bool started = poller.RequestRead();
                return Http.Json(202, "Accepted", Encoding.UTF8.GetBytes(started ? "{\"ok\":true}" : "{\"ok\":true,\"note\":\"A read was requested less than 15 s ago.\"}"));
            }
            Dictionary<string, object> body = Json.Parse(Encoding.UTF8.GetString(req.Body));
            if (body == null) return Http.Error(400, "Bad Request", "Send JSON");
            string doc = Json.Str(body, "doc");
            bool ok = req.Path == "/ack" ? store.Ack(doc, Json.Str(body, "sig"), Json.Str(body, "by"), DateTime.Now) : store.Unack(doc);
            if (!ok) return Http.Error(404, "Not Found", "That document isn't in the current WIP list");
            return Http.Json(200, "OK", store.Snapshot());
        }
    }

    // ---------------------------------------------------------------- window and tray

    internal sealed class MainForm : Form {
        readonly Settings settings;
        readonly Store store;
        readonly Poller poller;
        readonly HttpServer server;
        readonly string boardPath;
        readonly Label status = new Label();
        readonly ComboBox targets = new ComboBox();
        readonly ComboBox interval = new ComboBox();
        readonly CheckBox shopHours = new CheckBox();
        readonly CheckBox clickSearch = new CheckBox();
        readonly Button refreshTargets = new Button(), readNow = new Button(), openBoard = new Button(), pause = new Button(), exit = new Button();
        readonly NotifyIcon tray = new NotifyIcon();
        readonly System.Windows.Forms.Timer uiTimer = new System.Windows.Forms.Timer();
        bool loading, exiting, toldAboutTray;
        int targetRefreshTicks;
        readonly bool hosted;
        // Called after the WIP window is chosen, so the helper can pick the other COSTAR.
        internal Action TargetChanged;

        internal MainForm(string board, bool hostedInHelper) {
            hosted = hostedInHelper;
            boardPath = board;
            settings = Settings.Load();
            store = new Store(AppInfo.DataFolder());
            if (hosted) Hosting.Store = store;
            poller = new Poller(store);
            server = new HttpServer(store, poller, AppInfo.Port);
            BuildUi();
            loading = true;
            interval.SelectedIndex = settings.IntervalSeconds == 60 ? 0 : settings.IntervalSeconds == 180 ? 2 : settings.IntervalSeconds == 300 ? 3 : 1;
            shopHours.Checked = settings.ShopHoursOnly;
            clickSearch.Checked = settings.ClickSearch;
            loading = false;
            poller.Configure(settings.IntervalSeconds, settings.ShopHoursOnly, settings.ClickSearch);
            store.SetMeta("", settings.IntervalSeconds);
            if (!server.Start()) store.SetState("error", server.Problem);
            LoadTargets();
            poller.Start();
            uiTimer.Interval = 2000;
            uiTimer.Tick += delegate { RefreshStatus(); };
            uiTimer.Start();
            RefreshStatus();
        }

        void BuildUi() {
            Text = AppInfo.Title + " " + AppInfo.Version;
            Font = new Font("Segoe UI", 9f);
            AutoScaleMode = AutoScaleMode.Font;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(620, 318);
            Icon = SystemIcons.Application;

            var intro = new Label();
            intro.Text = "Checks every job in COSTAR Work-in-Progress against the retail picking slips.";
            intro.SetBounds(16, 12, 588, 20);
            status.SetBounds(16, 36, 588, 70);
            status.BorderStyle = BorderStyle.FixedSingle;
            status.BackColor = Color.White;
            status.Padding = new Padding(6);
            var targetLabel = new Label(); targetLabel.Text = "WIP COSTAR window"; targetLabel.SetBounds(16, 116, 200, 18);
            targets.DropDownStyle = ComboBoxStyle.DropDownList; targets.SetBounds(16, 136, 486, 24);
            refreshTargets.Text = "Refresh list"; refreshTargets.SetBounds(510, 135, 94, 26);
            var hint = new Label();
            hint.Text = "Use a second Tempe COSTAR left on Work-in-Progress with empty search boxes, not the one the mobile helper types into.";
            hint.ForeColor = Color.DimGray; hint.SetBounds(16, 164, 588, 32);
            var intervalLabel = new Label(); intervalLabel.Text = "Read every"; intervalLabel.SetBounds(16, 204, 70, 20);
            interval.DropDownStyle = ComboBoxStyle.DropDownList;
            interval.Items.AddRange(new object[] { "1 minute", "2 minutes", "3 minutes", "5 minutes" });
            interval.SetBounds(88, 201, 100, 24);
            shopHours.Text = "Shop hours only (Monday to Saturday, 7:00 to 18:30)"; shopHours.SetBounds(206, 202, 400, 22);
            clickSearch.Text = "Press Search before each read so the list is fresh"; clickSearch.SetBounds(206, 226, 400, 22);
            readNow.Text = "Read now"; readNow.SetBounds(16, 270, 100, 30);
            openBoard.Text = "Open board"; openBoard.SetBounds(124, 270, 100, 30);
            pause.Text = "Pause"; pause.SetBounds(232, 270, 100, 30);
            exit.Text = "Exit"; exit.SetBounds(504, 270, 100, 30);
            Controls.AddRange(new Control[] { intro, status, targetLabel, targets, refreshTargets, hint, intervalLabel, interval, shopHours, clickSearch, readNow, openBoard, pause, exit });
            exit.Visible = !hosted; // Closing the helper stops Order Check.

            targets.SelectedIndexChanged += delegate { TargetChosen(); };
            refreshTargets.Click += delegate { LoadTargets(); };
            interval.SelectedIndexChanged += delegate { SettingsChanged(); };
            shopHours.CheckedChanged += delegate { SettingsChanged(); };
            clickSearch.CheckedChanged += delegate { SettingsChanged(); };
            readNow.Click += delegate { if (!poller.RequestRead()) store.SetState(store.State, "A read was requested less than 15 s ago."); };
            openBoard.Click += delegate { OpenBoard(); };
            pause.Click += delegate { poller.Paused = !poller.Paused; RefreshStatus(); };
            exit.Click += delegate { ExitApp(); };

            if (hosted) return; // The helper is the app: no tray icon of its own.
            var menu = new ContextMenuStrip();
            menu.Items.Add("Show Order Check", null, delegate { ShowFromTray(); });
            menu.Items.Add("Read now", null, delegate { poller.RequestRead(); });
            menu.Items.Add("Open board", null, delegate { OpenBoard(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit", null, delegate { ExitApp(); });
            tray.ContextMenuStrip = menu;
            tray.Icon = SystemIcons.Application;
            tray.Text = AppInfo.Title;
            tray.Visible = true;
            tray.DoubleClick += delegate { ShowFromTray(); };
            Resize += delegate { if (WindowState == FormWindowState.Minimized) HideToTray(); };
        }

        void HideToTray() {
            Hide();
            if (!toldAboutTray) { toldAboutTray = true; tray.ShowBalloonTip(3000, AppInfo.Title, "Still checking in the background. Double-click this icon to open it.", ToolTipIcon.Info); }
        }
        void ShowFromTray() { Show(); WindowState = FormWindowState.Normal; Activate(); }

        protected override void OnFormClosing(FormClosingEventArgs e) {
            if (!hosted && !exiting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; HideToTray(); return; }
            Shutdown();
            base.OnFormClosing(e);
        }
        // Stops reading and the board server. The helper calls this when it closes.
        internal void Shutdown() {
            if (exiting) return;
            exiting = true;
            uiTimer.Stop(); poller.Stop(); server.Stop();
            tray.Visible = false; tray.Dispose();
        }
        void ExitApp() {
            Shutdown();
            Close();
        }

        void SettingsChanged() {
            if (loading) return;
            int[] seconds = { 60, 120, 180, 300 };
            settings.IntervalSeconds = seconds[Math.Max(0, interval.SelectedIndex)];
            settings.ShopHoursOnly = shopHours.Checked;
            settings.ClickSearch = clickSearch.Checked;
            settings.Save();
            poller.Configure(settings.IntervalSeconds, settings.ShopHoursOnly, settings.ClickSearch);
            CostarTarget t = poller.Target;
            store.SetMeta(t == null ? "" : t.Describe(), settings.IntervalSeconds);
        }

        void LoadTargets() {
            loading = true;
            try {
                List<CostarTarget> list = Costar.Find();
                CostarTarget current = poller.Target;
                targets.Items.Clear();
                int select = -1;
                for (int i = 0; i < list.Count; i++) {
                    targets.Items.Add(list[i]);
                    if (list[i].Key == settings.TargetKey || (current != null && list[i].Key == current.Key)) select = i;
                }
                if (select >= 0) targets.SelectedIndex = select;
                CostarTarget chosen = select >= 0 ? list[select] : null;
                if (chosen == null || current == null || chosen.Key != current.Key) poller.SetTarget(chosen);
                store.SetMeta(chosen == null ? "" : chosen.Describe(), settings.IntervalSeconds);
                if (list.Count == 0) store.SetState("setup", "No Tempe COSTAR window found in this session. Open one on Work-in-Progress, then press Refresh list.");
            } catch (Exception e) {
                store.SetState("error", AppInfo.Short(e));
            } finally { loading = false; }
        }

        void TargetChosen() {
            if (loading) return;
            var t = targets.SelectedItem as CostarTarget;
            if (t == null) return;
            settings.TargetKey = t.Key; settings.Save();
            poller.SetTarget(t);
            store.SetMeta(t.Describe(), settings.IntervalSeconds);
            Action changed = TargetChanged;
            if (changed != null) changed();
        }

        void RefreshStatus() {
            string state = store.State;
            string heading = state == "ok" ? "Reading normally" : state == "waiting" ? "Waiting" : state == "setup" ? "Needs setup" : state == "sleeping" ? "Sleeping" : state == "paused" ? "Paused" : state == "error" ? "Problem" : "Starting";
            string po = store.PoColumn;
            status.Text = heading + "\r\n" + store.Message + "\r\n" + store.Summary() + " Board data: http://127.0.0.1:" + server.Port + "/wip.json" +
                (server.Problem.Length > 0 ? " " + server.Problem : "") +
                (po.Length > 0 ? " Helper tags use the \"" + po + "\" column." : " Helper tags off: no PO column in the WIP list.");
            status.ForeColor = state == "error" || state == "setup" ? Color.FromArgb(160, 20, 20) : Color.FromArgb(30, 34, 38);
            pause.Text = poller.Paused ? "Resume" : "Pause";
            string tip = AppInfo.Title + ": " + heading;
            tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            if (poller.Target == null && ++targetRefreshTicks >= 30) { targetRefreshTicks = 0; if (Visible && targets.DroppedDown == false) LoadTargets(); }
        }

        void OpenBoard() {
            string url;
            if (boardPath.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) url = boardPath;
            else {
                if (string.IsNullOrEmpty(boardPath) || !File.Exists(boardPath)) {
                    MessageBox.Show("The board file wasn't found. Open Board\\Order_Check.html from the Order Check folder in Chrome.", AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                url = new Uri(boardPath).AbsoluteUri;
            }
            if (server.Port != AppInfo.Port) url += (url.IndexOf('?') >= 0 ? "&" : "?") + "reader=" + Uri.EscapeDataString("http://127.0.0.1:" + server.Port);
            string chrome = FindChrome();
            try {
                if (chrome != null) Process.Start(chrome, "\"" + url + "\""); else Process.Start(url);
            } catch (Exception e) {
                MessageBox.Show("Couldn't open the board: " + AppInfo.Short(e), AppInfo.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
        static string FindChrome() {
            string[] candidates = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
            };
            foreach (string c in candidates) if (File.Exists(c)) return c;
            return null;
        }
    }

    // ---------------------------------------------------------------- self-tests (never touch COSTAR)

    internal static class SelfTests {
        static int passed, failed;
        static StringBuilder log;

        internal static int Run(string reportPath) {
            passed = 0; failed = 0; log = new StringBuilder();
            log.AppendLine(AppInfo.Title + " " + AppInfo.Version + " self-tests");
            Group("Branch 11 window title", TitleTest);
            Group("Button text normalising", NormTest);
            Group("Doc totals", TotalTest);
            Group("Order dates", DateTest);
            Group("Row from grid cells", RowTest);
            Group("Change signature", SignatureTest);
            Group("First-seen, changed and OK marks", StoreTest);
            Group("HTTP request parsing", ParseTest);
            Group("HTTP body reading", ReadTest);
            Group("Host and origin checks", AccessTest);
            Group("Server routes", RouteTest);
            Group("WIP filter description", FilterTest);
            Group("Shop hours", HoursTest);
            Group("HTTP response format", ResponseTest);
            Group("PO column for COSTAR helper tags", PoTest);
            Group("Server moves aside when its port is taken", PortTest);
            log.AppendLine(passed + " test groups passed, " + failed + " failed.");
            try { File.WriteAllText(reportPath, log.ToString(), new UTF8Encoding(false)); } catch (Exception) { return 2; }
            return failed == 0 ? 0 : 1;
        }

        static void Group(string name, Action test) {
            try { test(); passed++; log.AppendLine("PASS " + name); }
            catch (Exception e) { failed++; log.AppendLine("FAIL " + name + ": " + e.Message); }
        }
        static void PortTest() {
            string folder = Path.Combine(Path.GetTempPath(), "TempeOrderCheckPort-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
            TcpListener busy = null; HttpServer server = null; int taken = 0;
            try {
                for (int tries = 0; tries < 8 && (busy == null || taken > 65000); tries++) {
                    if (busy != null) busy.Stop();
                    busy = new TcpListener(IPAddress.Loopback, 0); busy.Start();
                    taken = ((IPEndPoint)busy.LocalEndpoint).Port;
                }
                var store = new Store(folder);
                server = new HttpServer(store, new Poller(store), taken);
                Check(server.Start(), "started on a free port");
                Check(server.Port > taken && server.Port < taken + 10, "moved past the busy port");
                Check(server.Problem.IndexOf("Port " + taken, StringComparison.Ordinal) >= 0, "the busy port is reported");
                Check(server.Route(Http.ParseHead("GET /health HTTP/1.1\r\nHost: 127.0.0.1:" + server.Port)).Code == 200, "answers on its own port");
                Check(server.Route(Http.ParseHead("GET /health HTTP/1.1\r\nHost: 127.0.0.1:" + taken)).Code == 403, "refuses requests addressed to the busy port");
            } finally {
                if (server != null) server.Stop();
                if (busy != null) busy.Stop();
                try { Directory.Delete(folder, true); } catch (Exception) { }
            }
        }
        static void PoTest() {
            Check(GridReader.FindPoColumn(new string[] { "Document #", "PO #", "Name" }) == "PO #", "PO # found");
            Check(GridReader.FindPoColumn(new string[] { "Document #", "Customer PO" }) == "Customer PO", "Customer PO found");
            Check(GridReader.FindPoColumn(new string[] { "Document #", "Post Code", "Name" }) == "", "no PO column");
            var v = new Dictionary<string, string>(); v["Document #"] = "0745042"; v["PO"] = " TTW1730377 ";
            Check(WipRow.From(v).Po == "TTW1730377", "PO value cleaned");
            var noPo = new Dictionary<string, string>(); noPo["Document #"] = "0745043";
            Check(WipRow.From(noPo).Po == "", "missing PO is empty");
        }
        static void Check(bool ok, string what) { if (!ok) throw new Exception(what); }

        static void TitleTest() {
            Check(Costar.IsTempeTitle("COSTAR:  11 Tempe Tyres Tempe                   v5.7.6.0  (sql-Server:Tempe)"), "Tempe title");
            Check(!Costar.IsTempeTitle("COSTAR:  2 Sydney Tyres Sydney   v5.7.6.0"), "Sydney rejected");
            Check(!Costar.IsTempeTitle("RepairOrder Branch 11"), "RO rejected");
            Check(!Costar.IsTempeTitle("COSTAR:  110 Tempe Tyres Tempe"), "branch 110 rejected");
        }
        static void NormTest() {
            Check(Text.Norm("&Search") == "SEARCH", "&Search");
            Check(Text.Norm("  Add  new ") == "ADD NEW", "spaces");
            Check(Text.Norm(null) == "", "null");
        }
        static void TotalTest() {
            decimal t;
            Check(Text.TryTotal("1260.00", out t) && t == 1260m, "1260.00");
            Check(Text.TryTotal("1,330.00", out t) && t == 1330m, "1,330.00");
            Check(Text.TryTotal("0.00", out t) && t == 0m, "0.00");
            Check(Text.TryTotal("-50.00", out t) && t == -50m, "-50.00");
            Check(!Text.TryTotal("", out t), "empty");
        }
        static void DateTest() {
            Check(Text.IsoDate("02 Oct 2026") == "2026-10-02", "02 Oct 2026");
            Check(Text.IsoDate("25 Feb 2026") == "2026-02-25", "25 Feb 2026");
            Check(Text.IsoDate(" 5 Oct 2026 ") == "2026-10-05", "5 Oct");
            Check(Text.IsoDate("01 Jan 1900") == "1900-01-01", "1900");
            Check(Text.IsoDate("soon") == "", "bad date");
        }
        static Dictionary<string, string> Cells(string doc, string date, string total, string via, string comment, string by) {
            var v = new Dictionary<string, string>();
            v["Document #"] = doc; v["Order Date"] = date; v["Name"] = "TEST  CUSTOMER"; v["Doc Total"] = total; v["Ship Via"] = via;
            v["Comment"] = comment; v["Written By"] = by; v["Status"] = "InProgress"; v["Completed"] = "No";
            return v;
        }
        static void RowTest() {
            WipRow r = WipRow.From(Cells("07450421", "02 Oct 2026", "1260.00", "SHOP", " R28688 ", "MOR"));
            Check(r.Doc == "07450421" && r.OrderDateIso == "2026-10-02" && r.Total == 1260m && r.HasTotal, "core fields");
            Check(r.Name == "TEST CUSTOMER" && r.Comment == "R28688" && r.By == "MOR" && r.ShipVia == "SHOP", "text fields");
            WipRow blank = WipRow.From(new Dictionary<string, string>());
            Check(blank.Doc == "" && !blank.HasTotal && blank.OrderDateIso == "", "missing cells");
        }
        static void SignatureTest() {
            WipRow a = WipRow.From(Cells("07450421", "02 Oct 2026", "1260.00", "", "R28688", "MOR"));
            WipRow b = WipRow.From(Cells("07450421", "02 Oct 2026", "1260.00", "", "R28688", "MOR"));
            WipRow c = WipRow.From(Cells("07450421", "02 Oct 2026", "1260.00", "SHOP", "R28688", "MOR"));
            WipRow d = WipRow.From(Cells("07450421", "02 Oct 2026", "1260.00", "", "R28688", "MOR")); d.Name = "OTHER NAME";
            Check(Text.Signature(a) == Text.Signature(b), "stable");
            Check(Text.Signature(a) != Text.Signature(c), "ship via change detected");
            Check(Text.Signature(a) == Text.Signature(d), "name change ignored");
            Check(Text.Signature(a).Length == 12, "12 hex characters");
        }
        static void StoreTest() {
            string folder = Path.Combine(Path.GetTempPath(), "TempeOrderCheckTest-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
            try {
                var store = new Store(folder);
                DateTime t0 = new DateTime(2026, 10, 2, 9, 0, 0);
                var first = new List<WipRow>();
                first.Add(WipRow.From(Cells("07450421", "02 Oct 2026", "1260.00", "SHOP", "R28688", "MOR")));
                store.Update(first, "", 1200, t0, "");
                Check(first[0].ChangedAt == "" && first[0].FirstSeen.Length > 0, "first ever read has no change time");
                var second = new List<WipRow>();
                second.Add(WipRow.From(Cells("07450421", "02 Oct 2026", "1260.00", "SHOP", "R28688", "MOR")));
                second.Add(WipRow.From(Cells("07450999", "02 Oct 2026", "500.00", "", "", "DB")));
                store.Update(second, "", 900, t0.AddMinutes(2), "");
                Check(second[0].ChangedAt == "" && second[1].ChangedAt == AppInfo.Stamp(t0.AddMinutes(2)), "new job gets a change time");
                var third = new List<WipRow>();
                third.Add(WipRow.From(Cells("07450421", "02 Oct 2026", "1260.00", "SHOP", "R28688", "MOR")));
                third.Add(WipRow.From(Cells("07450999", "02 Oct 2026", "500.00", "SHOP", "", "DB")));
                store.Update(third, "Written By = DB", 900, t0.AddMinutes(4), "");
                Check(third[1].ChangedAt == AppInfo.Stamp(t0.AddMinutes(4)), "ship via change updates the change time");
                Check(store.Ack("07450999", third[1].Sig, "mor!", t0.AddMinutes(5)), "ack accepted");
                Check(!store.Ack("09999999", "x", "MOR", t0), "unknown doc rejected");
                string json = Encoding.UTF8.GetString(store.Snapshot());
                Check(json.Contains("\"07450999\":{\"sig\":\"" + third[1].Sig + "\",\"by\":\"MOR\""), "ack in snapshot: " + json);
                Check(json.Contains("\"filter\":\"Written By = DB\"") && json.Contains("\"state\":\"ok\""), "filter and state in snapshot");
                var reloaded = new Store(folder);
                Check(Encoding.UTF8.GetString(reloaded.Snapshot()).Contains("\"07450999\":{\"sig\""), "acks survive a restart");
                Check(reloaded.Unack("07450999") && !Encoding.UTF8.GetString(reloaded.Snapshot()).Contains("\"by\":\"MOR\""), "unack");
            } finally {
                try { Directory.Delete(folder, true); } catch (Exception) { }
            }
        }
        static void ParseTest() {
            HttpRequest r = Http.ParseHead("GET /wip.json?x=1 HTTP/1.1\r\nHost: 127.0.0.1:8795\r\nOrigin: null");
            Check(r != null && r.Method == "GET" && r.Path == "/wip.json" && r.Query == "x=1" && r.Header("host") == "127.0.0.1:8795" && r.Header("ORIGIN") == "null", "GET parsed");
            Check(Http.ParseHead("garbage") == null, "garbage rejected");
            Check(Http.ParseHead("GET wip.json HTTP/1.1") == null, "relative path rejected");
            Check(Http.ParseHead("GET / HTTP/1.1\r\nBadHeader") == null, "bad header rejected");
        }
        static void ReadTest() {
            byte[] raw = Encoding.ASCII.GetBytes("POST /ack HTTP/1.1\r\nHost: 127.0.0.1:8795\r\nContent-Length: 17\r\n\r\n{\"doc\":\"0745042\"}");
            HttpRequest r = Http.Read(new MemoryStream(raw));
            Check(r != null && r.Method == "POST" && Encoding.UTF8.GetString(r.Body) == "{\"doc\":\"0745042\"}", "body read");
            byte[] big = Encoding.ASCII.GetBytes("POST /ack HTTP/1.1\r\nHost: 127.0.0.1:8795\r\nContent-Length: 999999\r\n\r\n{}");
            Check(Http.Read(new MemoryStream(big)) == null, "oversized body rejected");
            byte[] cut = Encoding.ASCII.GetBytes("POST /ack HTTP/1.1\r\nHost: 127.0.0.1:8795\r\nContent-Length: 10\r\n\r\n{}");
            Check(Http.Read(new MemoryStream(cut)) == null, "short body rejected");
        }
        static void AccessTest() {
            Check(Http.HostAllowed("127.0.0.1:8795", 8795) && Http.HostAllowed("LOCALHOST:8795", 8795), "loopback hosts");
            Check(!Http.HostAllowed("evil.example:8795", 8795) && !Http.HostAllowed(null, 8795) && !Http.HostAllowed("127.0.0.1", 8795), "rebinding hosts rejected");
            Check(Http.OriginAllowed(null) && Http.OriginAllowed("null") && Http.OriginAllowed("chrome-extension://abc") && Http.OriginAllowed("https://tommyvenzin.github.io"), "allowed origins");
            Check(!Http.OriginAllowed("https://evil.example") && !Http.OriginAllowed("https://tommyvenzin.github.io.evil.example"), "other origins rejected");
        }
        static void RouteTest() {
            string folder = Path.Combine(Path.GetTempPath(), "TempeOrderCheckTest-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
            try {
                var store = new Store(folder);
                var server = new HttpServer(store, new Poller(store), 8795);
                HttpRequest get = Http.ParseHead("GET /wip.json HTTP/1.1\r\nHost: 127.0.0.1:8795\r\nOrigin: null");
                HttpResponse resp = server.Route(get);
                Check(resp.Code == 200 && resp.Headers["Access-Control-Allow-Origin"] == "null" && Encoding.UTF8.GetString(resp.Body).Contains("\"rows\":[]"), "wip.json served");
                Check(server.Route(Http.ParseHead("GET /wip.json HTTP/1.1\r\nHost: evil.example:8795")).Code == 403, "bad host blocked");
                Check(server.Route(Http.ParseHead("POST /refresh HTTP/1.1\r\nHost: 127.0.0.1:8795")).Code == 403, "post without header blocked");
                Check(server.Route(Http.ParseHead("OPTIONS /ack HTTP/1.1\r\nHost: 127.0.0.1:8795\r\nOrigin: null")).Headers["Access-Control-Allow-Private-Network"] == "true", "preflight");
                Check(server.Route(Http.ParseHead("GET /nope HTTP/1.1\r\nHost: localhost:8795")).Code == 404, "unknown path");
            } finally {
                try { Directory.Delete(folder, true); } catch (Exception) { }
            }
        }
        static Win.Rect R(int left, int top, int right, int bottom) { var r = new Win.Rect(); r.Left = left; r.Top = top; r.Right = right; r.Bottom = bottom; return r; }
        static void FilterTest() {
            var labels = new List<Box>();
            labels.Add(new Box("Cust/Contact", R(187, 101, 422, 120)));
            labels.Add(new Box("Written By", R(187, 191, 422, 209)));
            var edits = new List<Box>();
            edits.Add(new Box("", R(426, 99, 552, 120)));
            edits.Add(new Box("MOR", R(426, 189, 552, 210)));
            Check(WipScreen.Describe(labels, edits) == "Written By = MOR", "Written By detected: " + WipScreen.Describe(labels, edits));
            edits[1] = new Box("  ", edits[1].Rect);
            Check(WipScreen.Describe(labels, edits) == "", "empty boxes mean no filter");
        }
        static void HoursTest() {
            Check(!Text.InShopHours(new DateTime(2026, 10, 4, 10, 0, 0)), "Sunday");
            Check(!Text.InShopHours(new DateTime(2026, 10, 5, 6, 59, 0)), "Monday 6:59");
            Check(Text.InShopHours(new DateTime(2026, 10, 5, 7, 0, 0)), "Monday 7:00");
            Check(Text.InShopHours(new DateTime(2026, 10, 3, 18, 30, 0)), "Saturday 18:30");
            Check(!Text.InShopHours(new DateTime(2026, 10, 3, 18, 31, 0)), "Saturday 18:31");
        }
        static void ResponseTest() {
            HttpResponse r = Http.Json(200, "OK", Encoding.UTF8.GetBytes("{\"a\":1}"));
            r.Headers["Vary"] = "Origin";
            string text = Encoding.ASCII.GetString(Http.Serialize(r));
            Check(text.StartsWith("HTTP/1.1 200 OK\r\n", StringComparison.Ordinal) && text.Contains("Content-Length: 7\r\n") && text.Contains("Vary: Origin\r\n") && text.EndsWith("\r\n\r\n{\"a\":1}", StringComparison.Ordinal), "response bytes");
        }
    }
}
