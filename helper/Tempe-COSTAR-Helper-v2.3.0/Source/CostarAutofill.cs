// Attended COSTAR 5.7 repair-order entry. No database access or Save/Sell action.
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
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace TempeCostar {
    // Raised before any field is touched when the open Repair Order already holds another
    // job. The online tab then opens a fresh Repair Order and fills that instead.
    internal sealed class RepairOrderInUseException:InvalidOperationException {
        internal RepairOrderInUseException(string message):base(message){}
    }
    // Microsoft Active Accessibility, the way Tempe Order Check reads COSTAR's
    // Infragistics grids (proven on the RDP PC). Used here only to find and highlight
    // the first row of COSTAR's customer list.
    internal static class Msaa {
        [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out object acc);
        [DllImport("oleacc.dll")] static extern int AccessibleChildren(Accessibility.IAccessible parent,int start,int count,[Out] object[] children,out int obtained);
        internal const int RoleTable=24,RoleRow=28;
        internal static Accessibility.IAccessible FromWindow(IntPtr h) {
            Guid iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");object acc;
            int hr=AccessibleObjectFromWindow(h,0xFFFFFFFC,ref iid,out acc);
            if(hr!=0||acc==null) throw new InvalidOperationException("COSTAR did not answer the accessibility request.");
            return (Accessibility.IAccessible)acc;
        }
        internal static Accessibility.IAccessible Child(Accessibility.IAccessible parent,int oneBased) { object o=parent.get_accChild(oneBased); return o as Accessibility.IAccessible; }
        internal static int Count(Accessibility.IAccessible a) { return a.accChildCount; }
        internal static int Role(Accessibility.IAccessible a) { object r=a.get_accRole(0); return r is int?(int)r:-1; }
        internal static bool Location(Accessibility.IAccessible a,out int left,out int top,out int width,out int height) {
            left=0;top=0;width=0;height=0;
            try { a.accLocation(out left,out top,out width,out height,0); return true; } catch(Exception) { return false; }
        }
        internal static List<object> All(Accessibility.IAccessible parent,int count) {
            var list=new List<object>();
            if(count<=0) return list;
            var items=new object[count];int got;
            int hr=AccessibleChildren(parent,0,count,items,out got);
            if(hr<0) return list;
            for(int i=0;i<got;i++) list.Add(items[i]);
            return list;
        }
        internal static void Release(object o) {
            if(o!=null && Marshal.IsComObject(o)) { try { Marshal.ReleaseComObject(o); } catch(Exception) { } }
        }
        // Children of an object: IAccessible objects, or numbered "simple" children (ints).
        internal static List<object> Children(Accessibility.IAccessible parent,int max) {
            int n;
            try { n=Math.Min(Count(parent),max); } catch(Exception) { return new List<object>(); }
            var list=All(parent,n);
            if(list.Count>0 || n==0) return list;
            for(int i=1;i<=n;i++) {
                object o=null;
                try { o=parent.get_accChild(i); } catch(Exception) { o=null; }
                list.Add(o!=null?o:(object)i);
            }
            return list;
        }
        internal static int RoleOf(Accessibility.IAccessible parent,object child) {
            try {
                var a=child as Accessibility.IAccessible;
                object r=a!=null?a.get_accRole(0):parent.get_accRole(child);
                return r is int?(int)r:-1;
            } catch(Exception) { return -1; }
        }
        internal static bool LocationOf(Accessibility.IAccessible parent,object child,out int left,out int top,out int width,out int height) {
            left=0;top=0;width=0;height=0;
            try {
                var a=child as Accessibility.IAccessible;
                if(a!=null) a.accLocation(out left,out top,out width,out height,0);
                else parent.accLocation(out left,out top,out width,out height,child);
                return true;
            } catch(Exception) { return false; }
        }
        internal static void SelectChild(Accessibility.IAccessible parent,object child) {
            try { var a=child as Accessibility.IAccessible; if(a!=null) a.accSelect(3,0); else parent.accSelect(3,child); } // TAKEFOCUS|TAKESELECTION
            catch(Exception) { }
        }
        // A table (role 24) among the children of root, down to "depth" levels.
        internal static Accessibility.IAccessible FindTable(Accessibility.IAccessible root,int depth) {
            if(root==null || depth<=0) return null;
            foreach(object o in Children(root,16)) {
                var a=o as Accessibility.IAccessible;
                if(a==null) continue;
                bool keep=false;
                try {
                    if(Role(a)==RoleTable) { keep=true; return a; }
                    var inner=FindTable(a,depth-1);
                    if(inner!=null) return inner;
                } catch(Exception) {
                } finally { if(!keep) Release(a); }
            }
            return null;
        }
        internal sealed class Row { internal object Child; internal int Left,Top,Width,Height,Order; }
        // The data rows nearest the top of the grid (by screen position: the grid can list
        // its active row twice), skipping a column-header row. At most "take" rows.
        internal static List<Row> TopRows(Accessibility.IAccessible table,int take) {
            var rows=new List<Row>();int order=0;
            foreach(object o in Children(table,300)) {
                order++;
                if(RoleOf(table,o)!=RoleRow || IsHeaderRow(o)) { Release(o); continue; }
                var row=new Row{Child=o,Order=order};int l,t,w,h;
                if(LocationOf(table,o,out l,out t,out w,out h)) { row.Left=l;row.Top=t;row.Width=w;row.Height=h; }
                rows.Add(row);
            }
            var sorted=rows.Where(r=>r.Height>0).OrderBy(r=>r.Top).ThenBy(r=>r.Order).ToList();
            if(sorted.Count==0) sorted=rows.OrderBy(r=>r.Order).ToList();
            var keep=sorted.Take(take).ToList();
            foreach(var r in rows) if(!keep.Contains(r)) Release(r.Child);
            return keep;
        }
        // A header row's first child is a column header (role 25).
        static bool IsHeaderRow(object o) {
            var a=o as Accessibility.IAccessible;
            if(a==null) return false;
            foreach(object c in Children(a,1)) { int r=RoleOf(a,c); Release(c); return r==25; }
            return false;
        }
        // Shape only (roles, counts, positions), never names or values: for the report.
        internal static string Shape(Accessibility.IAccessible a,int maxChildren) {
            var b=new StringBuilder();
            try {
                b.Append("role=").Append(Role(a)).Append(" n=").Append(Count(a)).Append(" [");
                int i=0;
                foreach(object o in Children(a,maxChildren)) {
                    int l,t,w,h;bool placed=LocationOf(a,o,out l,out t,out w,out h);
                    b.Append(i++>0?" ":"").Append((o is Accessibility.IAccessible)?"o":"s").Append(RoleOf(a,o)).Append(placed?"@y"+t+"h"+h:"");
                    Release(o);
                }
                b.Append("]");
            } catch(Exception e) { b.Append(" error ").Append(e.GetType().Name); }
            return b.ToString();
        }
    }
    internal static class Native {
        internal delegate bool EnumProc(IntPtr h, IntPtr arg);
        [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left,Top,Right,Bottom; }
        [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X,Y; }
        [StructLayout(LayoutKind.Sequential)] internal struct GuiInfo { public int size; public uint flags; public IntPtr active,focus,capture,menu,move,caret; public Rect rect; }
        [StructLayout(LayoutKind.Sequential)] internal struct MouseInput { public int dx,dy; public uint data,flags,time; public UIntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] internal struct KeyInput { public ushort key,scan; public uint flags,time; public UIntPtr extra; }
        [StructLayout(LayoutKind.Explicit)] internal struct InputUnion { [FieldOffset(0)] public MouseInput mouse; [FieldOffset(0)] public KeyInput key; }
        [StructLayout(LayoutKind.Sequential)] internal struct Input { public uint type; public InputUnion data; }
        [DllImport("user32.dll")] internal static extern bool EnumWindows(EnumProc fn,IntPtr arg);
        [DllImport("user32.dll")] internal static extern bool EnumChildWindows(IntPtr h,EnumProc fn,IntPtr arg);
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
        [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] internal static extern bool IsWindowEnabled(IntPtr h);
        [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr h,int how);
        [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from,uint to,bool attach);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h,bool altTab);
        [StructLayout(LayoutKind.Sequential)] struct LastInput { public uint cbSize, dwTime; }
        [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput info);
        // Tick of the last click or key this helper sent itself.
        internal static volatile int LastSyntheticTick;
        // Windows only lets the app you are using change the active window. When an order
        // arrives while you work in Chrome, a plain SetForegroundWindow is refused and COSTAR
        // stays behind. Joining the active window's input queue for a moment lifts that limit.
        internal static bool BringToFront(IntPtr h) {
            if(IsIconic(h)) ShowWindow(h,9);
            if(GetForegroundWindow()==h) return true;
            SetForegroundWindow(h);
            if(GetForegroundWindow()==h) return true;
            IntPtr front=GetForegroundWindow();uint unused;
            uint frontThread=front==IntPtr.Zero?0:GetWindowThreadProcessId(front,out unused),me=GetCurrentThreadId();
            bool attached=frontThread!=0&&frontThread!=me&&AttachThreadInput(me,frontThread,true);
            try { BringWindowToTop(h);SetForegroundWindow(h); }
            finally { if(attached) AttachThreadInput(me,frontThread,false); }
            if(GetForegroundWindow()==h) return true;
            SwitchToThisWindow(h,true);
            for(int i=0;i<8 && GetForegroundWindow()!=h;i++) System.Threading.Thread.Sleep(25);
            return GetForegroundWindow()==h;
        }
        // True when a real person pressed a key or moved the mouse within the last ms
        // milliseconds (the helper's own clicks and keys do not count).
        internal static bool UserActiveWithin(int ms) {
            var info=new LastInput{cbSize=(uint)Marshal.SizeOf(typeof(LastInput))};
            if(!GetLastInputInfo(ref info)) return true;
            int last=unchecked((int)info.dwTime),now=Environment.TickCount;
            if(unchecked(last-LastSyntheticTick)<=60) return false;
            return unchecked(now-last)<ms;
        }
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern IntPtr GetParent(IntPtr h);
        [DllImport("user32.dll")] internal static extern IntPtr GetWindow(IntPtr h,uint command);
        [DllImport("user32.dll")] internal static extern IntPtr GetAncestor(IntPtr h,uint flags);
        [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr h,out Rect r);
        [DllImport("user32.dll")] internal static extern IntPtr WindowFromPoint(Point p);
        [DllImport("user32.dll")] internal static extern bool GetGUIThreadInfo(uint id,ref GuiInfo info);
        [DllImport("user32.dll",EntryPoint="GetWindowLongW")] internal static extern int GetWindowLong(IntPtr h,int index);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] internal static extern int GetClassName(IntPtr h,StringBuilder s,int count);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] internal static extern int GetWindowText(IntPtr h,StringBuilder s,int count);
        [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern IntPtr ReadMessage(IntPtr h,uint msg,UIntPtr w,StringBuilder s,uint flags,uint timeout,out UIntPtr result);
        [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern IntPtr WriteMessage(IntPtr h,uint msg,UIntPtr w,string s,uint flags,uint timeout,out UIntPtr result);
        [DllImport("user32.dll",SetLastError=true)] internal static extern uint SendInput(uint count,Input[] inputs,int size);
        [DllImport("user32.dll")] internal static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll")] internal static extern uint GetClipboardSequenceNumber();
        [DllImport("user32.dll")] internal static extern bool RegisterHotKey(IntPtr h,int id,uint modifiers,uint key);
        [DllImport("user32.dll")] internal static extern bool UnregisterHotKey(IntPtr h,int id);
        [DllImport("user32.dll")] internal static extern bool SetProcessDPIAware();
        [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",SetLastError=true)] internal static extern IntPtr SendNull(IntPtr h,uint msg,UIntPtr w,IntPtr l,uint flags,uint timeout,out UIntPtr result);
        // The same Windows calls as 1.6.1 (proven on the RDP PC), with one reusable buffer
        // per thread for each kind of read instead of a new 8 KB buffer for every field.
        [ThreadStatic] static StringBuilder classBuffer,captionBuffer,fieldBuffer;
        [DllImport("winmm.dll")] internal static extern uint timeBeginPeriod(uint period);
        [DllImport("winmm.dll")] internal static extern uint timeEndPeriod(uint period);
        internal static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h,out p); return p; }
        internal static string Class(IntPtr h) { var b=classBuffer??(classBuffer=new StringBuilder(256)); b.Length=0; GetClassName(h,b,256); return b.ToString(); }
        internal static string Caption(IntPtr h) { var b=captionBuffer??(captionBuffer=new StringBuilder(1024)); b.Length=0; GetWindowText(h,b,1024); return b.ToString(); }
        internal static IntPtr Focus(IntPtr root) { uint p; var i=new GuiInfo(); i.size=Marshal.SizeOf(typeof(GuiInfo)); return GetGUIThreadInfo(GetWindowThreadProcessId(root,out p),ref i) ? i.focus : IntPtr.Zero; }
        internal static bool TryText(IntPtr h,out string text) {
            var b=fieldBuffer??(fieldBuffer=new StringBuilder(4096)); b.Length=0; UIntPtr result;
            bool ok=ReadMessage(h,0xD,new UIntPtr(4096),b,3,100,out result)!=IntPtr.Zero && result.ToUInt64()<4095;
            text=ok ? b.ToString() : null; return ok;
        }
        // A held Shift/Ctrl/Alt/Windows key would turn the helper's Tab into Shift+Tab or its
        // click into Ctrl+click. 5 Oct: an order stopped at once because a key was down for
        // a moment (you may be finishing a shortcut in Chrome). Wait up to 3 s for it instead.
        internal static void NoModifiers() {
            var timer=System.Diagnostics.Stopwatch.StartNew();
            while(true) {
                string held=HeldModifier();
                if(held==null) return;
                if(timer.ElapsedMilliseconds>=3000) throw new InvalidOperationException("The "+held+" key is held down. Release it and try again. If nothing is pressed, tap "+held+" once: Remote Desktop can leave it stuck.");
                System.Threading.Thread.Sleep(30);
            }
        }
        static string HeldModifier() {
            if((GetAsyncKeyState(0x10)&0x8000)!=0) return "Shift";
            if((GetAsyncKeyState(0x11)&0x8000)!=0) return "Ctrl";
            if((GetAsyncKeyState(0x12)&0x8000)!=0) return "Alt";
            if((GetAsyncKeyState(0x5B)&0x8000)!=0 || (GetAsyncKeyState(0x5C)&0x8000)!=0) return "Windows";
            return null;
        }
        internal static void Key(ushort key) {
            NoModifiers(); var input=new Input[2];
            input[0].type=1; input[0].data.key.key=key;
            input[1]=input[0]; input[1].data.key.flags=2;
            LastSyntheticTick=Environment.TickCount;
            uint sent=SendInput(2,input,Marshal.SizeOf(typeof(Input)));
            if(sent!=2) { if(sent==1) SendInput(1,new[]{input[1]},Marshal.SizeOf(typeof(Input))); throw new InvalidOperationException("Windows did not accept the navigation key. Run the helper at the same permission level as COSTAR."); }
        }
        internal static void Click(Point p) {
            NoModifiers();
            int left=GetSystemMetrics(76),top=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
            Order.Require(width>1 && height>1 && p.X>=left && p.X<left+width && p.Y>=top && p.Y<top+height,"COSTAR field is outside the visible desktop.");
            var input=new Input[3];
            input[0].data.mouse.dx=(int)Math.Round((p.X-left)*65535.0/(width-1));
            input[0].data.mouse.dy=(int)Math.Round((p.Y-top)*65535.0/(height-1));
            input[0].data.mouse.flags=0xC001;
            input[1].data.mouse.flags=2; input[2].data.mouse.flags=4;
            LastSyntheticTick=Environment.TickCount;
            uint sent=SendInput(3,input,Marshal.SizeOf(typeof(Input)));
            if(sent!=3) { SendInput(1,new[]{input[2]},Marshal.SizeOf(typeof(Input))); throw new InvalidOperationException("Windows did not accept the field click."); }
        }
    }

    internal sealed partial class Runner : IDisposable {
        readonly Process process;
        readonly uint pid;
        readonly IntPtr root;
        readonly Order order;
        readonly string payment;
        readonly bool fitting;
        readonly Action<string> notify;
        readonly JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=2000000 };
        readonly StreamWriter log;
        internal volatile bool Cancel;
        internal string Folder, ZipPath;
        int writes;
        // How many fields this run has typed (0 = COSTAR untouched).
        internal int Writes { get { return writes; } }
        readonly Stopwatch runClock=Stopwatch.StartNew();
        readonly List<object> timings=new List<object>();
        int snapshotCount;
        long snapshotMilliseconds;
        int gridSnapshotCount,controlTextReads,skippedQuantities;
        IntPtr gridPanel;
        long gridPanelParent;
        string gridPanelClass;
        readonly Dictionary<int,int> packagePrices=new Dictionary<int,int>();
        readonly HashSet<long> originalWindows=new HashSet<long>();
        readonly Dictionary<long,int> popupCloseStages=new Dictionary<long,int>();
        bool enteringCustomer,lookupCancelled,restoredCustomerFocus;
        int searchCancelAttempts,recoveryActions;
        string verifiedCustomerAccount,verifiedCustomerName;
        internal RunDiagnostics Diag;
        IntPtr lastWritten;
        internal bool FreshlyOpened;
        bool fastTimer;
        long idleWaitedMs;
        readonly Dictionary<long,string> classCache=new Dictionary<long,string>();
        readonly Action<ControlInfo> lateRead,liveRead;
        long[] gridLabels;
        FieldMap headerCache;
        int skippedReads,lateReads,headerReads,headerHits,busySkips,busySnapshots;
        // True when the last snapshot found COSTAR not answering and read no text.
        bool lastSnapshotBusy;
        bool sawChooser;int chooserAttempts,focusRecoveries;
        // The phone typed for the customer lookup (used for the all-branch search).
        string lookupPhone="";
        readonly Stopwatch chooserClock=new Stopwatch();
        internal const int CustomerLookupTimeoutMs=20000;
        // COSTAR's phone search can take several seconds when it is slow (3-4 Oct: 2.2-2.5 s
        // and more). Escape during the search cancels the account list it is about to show,
        // so a search that is still running is left alone for this long.
        internal const int SearchPatienceMs=15000;
        internal static string ReportsRoot {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TempeCostarAutofill","Reports"); }
        }
        // The COSTAR branch this run's Repair Order must belong to (2.3.0: any branch).
        readonly int branch;
        internal int Branch { get { return branch; } }
        internal Runner(int processId,int expectedBranch,Order data,string pay,bool includeFitting,Action<string> progress,long expectedWindow=0) {
            lateRead=LateRead;liveRead=LiveRead;
            ProcessIdentity identity;Order.Require(LocalProcess.IsNamed(processId,"COSTAR",out identity),"Select COSTAR running inside this Remote Desktop session.");
            process=Process.GetProcessById(processId);
            try {
            IntPtr keep=process.Handle;
            Order.Require(expectedBranch>0,"The COSTAR branch for this order is unknown. Refresh the COSTAR list and select a COSTAR.");
            pid=(uint)processId; branch=expectedBranch; order=data; payment=Order.EntryText(pay.Trim()); fitting=includeFitting; notify=progress;
            var candidates=new List<IntPtr>();
            Native.EnumWindows(delegate(IntPtr h,IntPtr unused) {
                if(Native.IsWindowVisible(h)) originalWindows.Add(h.ToInt64());
                if(Native.Pid(h)==pid && Native.IsWindowVisible(h) && Branches.OrderTitle(Native.Caption(h),branch) && (expectedWindow==0 || h.ToInt64()==expectedWindow)) candidates.Add(h);
                return true;
            },IntPtr.Zero);
            Order.Require(candidates.Count==1,"Open one empty Repair Order (Branch "+branch+") in COSTAR, then click Fill again.");
            root=candidates[0];
            Order.Require(Branches.OrderTitle(Native.Caption(root),branch),"This Repair Order is not in Branch "+branch+". Open an empty Repair Order in that branch.");
            // Keep per-field diagnostics off redirected Desktop/UNC shares.
            string parent=ReportsRoot;
            Folder=Path.Combine(parent,DateTime.Now.ToString("yyyyMMdd-HHmmss")+"-"+order.orderId+"-"+Guid.NewGuid().ToString("N").Substring(0,6));
            Directory.CreateDirectory(Folder);
            log=new StreamWriter(Path.Combine(Folder,"steps.jsonl"),false,new UTF8Encoding(false)); log.AutoFlush=false;
            File.WriteAllText(Path.Combine(Folder,"order.json"),json.Serialize(order),new UTF8Encoding(false));
            // Last statement: nothing after this can throw and leave the probe running.
            Diag=new RunDiagnostics(Path.GetFileName(Folder),order.orderId,root,pid);
            Diag.SetEnv("branch",branch.ToString(CultureInfo.InvariantCulture));
            } catch {try{if(log!=null)log.Dispose();}finally{process.Dispose();}throw;}
        }
        internal void Activate() { Native.BringToFront(root); }
        void ActivateAndWait() {
            Activate();var timer=Stopwatch.StartNew();
            while(Native.GetForegroundWindow()!=root && timer.ElapsedMilliseconds<2000)Pause(25);
            Ready();
        }
        void Say(string text) { log.WriteLine(json.Serialize(new{At=DateTimeOffset.Now.ToString("o"),Version=AutofillForm.Version,Step=text,Writes=writes})); Diag.Step(text); notify(text); }
        void Timed(string stage,Action action) {
            var timer=Stopwatch.StartNew();bool completed=false;Diag.BeginStage(stage);
            try {action();completed=true;}
            finally {
                Diag.EndStage(completed);
                var timing=new {Stage=stage,Milliseconds=timer.ElapsedMilliseconds,Completed=completed};
                timings.Add(timing);log.WriteLine(json.Serialize(new{At=DateTimeOffset.Now.ToString("o"),Type="timing",Timing=timing}));log.Flush();
            }
        }
        void Check(bool foreground) {
            if(Cancel) throw new OperationCanceledException("Stopped by you. Check the partially filled order in COSTAR.");
            Order.Require(!process.HasExited && Native.IsWindow(root) && Native.Pid(root)==pid && System.Text.RegularExpressions.Regex.IsMatch(Native.Caption(root),@"^RepairOrder\s+Branch\s+11\b",System.Text.RegularExpressions.RegexOptions.IgnoreCase),"The original Repair Order was closed or changed.");
            if(foreground) {
                var front=Native.GetForegroundWindow();bool enabled=Native.IsWindowEnabled(root);
                if(front==IntPtr.Zero) {
                    // Windows briefly has no active window while one closes and another opens.
                    var gap=Stopwatch.StartNew();
                    while(front==IntPtr.Zero && gap.ElapsedMilliseconds<1500){Thread.Sleep(25);front=Native.GetForegroundWindow();}
                    enabled=Native.IsWindowEnabled(root);
                    Diag.EventRaw("foreground_gap",gap.ElapsedMilliseconds+" ms, then "+(front==root?"COSTAR":front==IntPtr.Zero?"still none":"another window"));
                }
                if(front!=root && enabled && focusRecoveries<3 && (front==IntPtr.Zero || Native.Pid(front)!=pid) && !Native.UserActiveWithin(2000)) {
                    // Another app took the screen and nobody is typing: bring COSTAR back once.
                    focusRecoveries++;
                    if(Native.BringToFront(root)) { Diag.EventRaw("focus_recovered","attempt "+focusRecoveries); front=root; }
                }
                if(front!=root || !enabled) {Diag.ForegroundLost(front,enabled);throw new InvalidOperationException("COSTAR lost focus or opened another screen. Entry stopped; check the current form.");}
            }
        }
        void Pause(int ms) { var slept=Stopwatch.StartNew(); try { for(int i=0;i<ms;i+=50) { Check(false); Thread.Sleep(Math.Min(50,ms-i)); } } finally { Diag.Pause(slept.ElapsedMilliseconds); } }
        // COSTAR answers a no-op message only when its UI thread is processing
        // messages again. Waiting for that avoids reading or clicking while it is
        // busy loading or redrawing. It never sends input.
        void WaitIdle(int maxMs) {
            var timer=Stopwatch.StartNew();
            while(timer.ElapsedMilliseconds<maxMs) {
                Check(false);
                int remaining=maxMs-(int)timer.ElapsedMilliseconds;
                UIntPtr result;var call=Stopwatch.StartNew();
                if(Native.SendNull(root,0,UIntPtr.Zero,IntPtr.Zero,0x0002,(uint)Math.Max(1,Math.Min(250,remaining)),out result)!=IntPtr.Zero)break;
                if(!Native.IsWindow(root))break;
                if(call.ElapsedMilliseconds<20)Thread.Sleep(20); // Reported as not responding: do not spin.
            }
            long waited=timer.ElapsedMilliseconds;
            if(waited>=3){idleWaitedMs+=waited;Diag.IdleWait(waited);}
        }
        // Reads the customer/header map, tolerating a brief redraw (for example
        // while COSTAR loads an existing customer's account).
        FieldMap HeaderNow() {
            // Reuse the last header map while the customer panel is unchanged: no full
            // screen read, and each field's value is read live only when it is used.
            var cached=headerCache;
            if(cached!=null) {
                Check(true);WaitIdle(3000);
                if(HeaderStill(cached)) { headerHits++; return LiveHeader(cached); }
                headerCache=null;
            }
            var timer=Stopwatch.StartNew();
            while(true) {
                try { var m=Selectors.Header(Current()); headerCache=m; return m; }
                catch(InvalidOperationException) {
                    if(timer.ElapsedMilliseconds>=3000 || Native.GetForegroundWindow()!=root) throw;
                    Pause(30);
                }
            }
        }
        static ControlInfo[] Fields(FieldMap m) { return new[]{m.Name,m.Account,m.Address,m.Address2,m.Suburb,m.State,m.Postcode,m.Phone,m.Email,m.PO,m.Comment}; }
        // Unchanged means every mapped field is the same window, still visible and
        // enabled, under the same parent, at the same position and size. An existing
        // customer's account rebuilds the panel, which fails this and forces a full read.
        bool HeaderStill(FieldMap m) {
            foreach(var c in Fields(m)) {
                var h=new IntPtr(c.Handle);Native.Rect box;
                if(!Native.IsWindow(h) || Native.Pid(h)!=pid || !Native.IsWindowVisible(h) || !Native.IsWindowEnabled(h) ||
                    Native.GetAncestor(h,2)!=root || Native.GetParent(h).ToInt64()!=c.Parent || !Native.GetWindowRect(h,out box) ||
                    box.Left!=c.Bounds[0] || box.Top!=c.Bounds[1] || box.Right-box.Left!=c.Bounds[2] || box.Bottom-box.Top!=c.Bounds[3]) return false;
            }
            return true;
        }
        ControlInfo Fresh(ControlInfo c) {
            return new ControlInfo { Handle=c.Handle,Root=c.Root,Parent=c.Parent,Style=c.Style,Class=c.Class,Visible=c.Visible,Enabled=c.Enabled,Password=c.Password,
                Bounds=c.Bounds,RelativeBounds=c.RelativeBounds,TextState="skipped",Late=liveRead };
        }
        FieldMap LiveHeader(FieldMap m) {
            return new FieldMap { Name=Fresh(m.Name),Account=Fresh(m.Account),Address=Fresh(m.Address),Address2=Fresh(m.Address2),Suburb=Fresh(m.Suburb),
                State=Fresh(m.State),Postcode=Fresh(m.Postcode),Phone=Fresh(m.Phone),Email=Fresh(m.Email),PO=Fresh(m.PO),Comment=Fresh(m.Comment) };
        }
        void FastTimer(){if(!fastTimer)fastTimer=Native.timeBeginPeriod(1)==0;}
        // A normal idle form reads every field. If some could not be read, COSTAR is still
        // drawing: read again (up to 5 s) rather than judge an order from a half-read form.
        List<ControlInfo> Settled(List<ControlInfo> s) {
            var timer=Stopwatch.StartNew();
            while((lastSnapshotBusy || s.Any(c=>c.TextState=="read-failed-or-timed-out")) && timer.ElapsedMilliseconds<5000) { Pause(150); s=Current(); }
            return s;
        }
        List<ControlInfo> Snapshot(IntPtr window) { return Snapshot(window,window,null); }
        List<ControlInfo> Snapshot(IntPtr window,IntPtr subtree) { return Snapshot(window,subtree,null); }
        // Two phases. Phase 1 records every control's geometry, class and state: these
        // are local Windows calls and cost almost nothing. Phase 2 reads text, which is a
        // cross-process round trip per control and the expensive part. "pick" (optional)
        // names the controls whose text is needed now; other readable controls are marked
        // "skipped" and read on demand only if something asks. Button captions are read
        // only on popups: the Repair Order form and item grid never use them.
        List<ControlInfo> Snapshot(IntPtr window,IntPtr subtree,Func<List<ControlInfo>,HashSet<long>> pick) {
            Check(false);WaitIdle(8000);int readsBefore=controlTextReads;
            Native.Rect rb; Order.Require(Native.GetWindowRect(window,out rb),"Cannot read the COSTAR window bounds.");
            var handles=new List<IntPtr>(400);
            uint windowPid=Native.Pid(window);
            bool popup=window!=root;
            Native.EnumChildWindows(subtree,delegate(IntPtr h,IntPtr unused) { if(Native.Pid(h)==windowPid && Native.IsWindowVisible(h)) handles.Add(h); return handles.Count<4000; },IntPtr.Zero);
            Order.Require(handles.Count<4000,"Unexpectedly large control tree.");
            var result=new List<ControlInfo>(handles.Count); var elapsed=Stopwatch.StartNew();
            int checkedControls=0;long windowHandle=window.ToInt64();
            foreach(var h in handles) {
                if(Cancel || (checkedControls++%64)==0) Check(false);
                Native.Rect box; if(!Native.GetWindowRect(h,out box)) continue;
                var c=new ControlInfo { Handle=h.ToInt64(),Root=windowHandle,Parent=Native.GetParent(h).ToInt64(),Class=ClassOf(h),Style=Native.GetWindowLong(h,-16),
                    Visible=true,Enabled=Native.IsWindowEnabled(h),Bounds=new[]{box.Left,box.Top,box.Right-box.Left,box.Bottom-box.Top},RelativeBounds=new[]{box.Left-rb.Left,box.Top-rb.Top,box.Right-box.Left,box.Bottom-box.Top},TextState="not-read" };
                c.Password=c.Class.IndexOf("EDIT",StringComparison.OrdinalIgnoreCase)>=0 && (c.Style&0x20)!=0;
                result.Add(c);
            }
            HashSet<long> wanted=pick==null?null:pick(result);
            checkedControls=0;
            // Every text read is a request COSTAR's screen thread must answer. While COSTAR is
            // busy (searching, loading) those requests pile up and it has to work through
            // them afterwards: the lag seen in 2.0.x. So: one cheap "are you there?" first and
            // no reads at all if it is not answering; and the first read that fails stops all
            // further reads in this snapshot. Callers see "busy" and simply look again later.
            bool busy=!Responsive(window,60);
            foreach(var c in result) {
                if(c.Password || !(c.Edit || c.Static || (popup && c.Class.IndexOf("BUTTON",StringComparison.OrdinalIgnoreCase)>=0))) continue;
                if(wanted!=null && !wanted.Contains(c.Handle)) { c.TextState="skipped";c.Late=lateRead;skippedReads++;continue; }
                if(busy) { c.TextState="busy";busySkips++;continue; }
                if(Cancel || (checkedControls++%32)==0) Check(false);
                Order.Require(elapsed.ElapsedMilliseconds<8000,"COSTAR is still busy reading fields. Wait for it to finish and retry on an empty order.");
                ReadText(c);
                if(c.TextState!="read" && !Responsive(window,30)) busy=true;
            }
            lastSnapshotBusy=busy;if(busy)busySnapshots++;
            Check(false);snapshotCount++;snapshotMilliseconds+=elapsed.ElapsedMilliseconds;
            Diag.Snapshot(window!=subtree?"grid":(window==root?"full":"popup"),elapsed.ElapsedMilliseconds,controlTextReads-readsBefore);return result;
        }
        // COSTAR answers a no-op message within ms when its screen thread is free.
        bool Responsive(IntPtr window,int ms) {
            UIntPtr result;
            return Native.SendNull(window,0,UIntPtr.Zero,IntPtr.Zero,0x0002,(uint)ms,out result)!=IntPtr.Zero;
        }
        void ReadText(ControlInfo c) {
            controlTextReads++;string value;bool ok=Native.TryText(new IntPtr(c.Handle),out value);
            c.Text=value;c.TextState=ok?"read":"read-failed-or-timed-out";
        }
        // A skipped control that something asked for after all. Correct either way; the
        // diagnostics count these so the read plan can be tightened if one is ever missed.
        void LateRead(ControlInfo c) {
            lateReads++;ReadText(c);
            if(lateReads<=20)Diag.EventRaw("late_read",RunDiagnostics.KindOf(c.Class)+" @"+c.X+","+c.Y+" "+c.W+"x"+c.H);
        }
        // Header fields returned from the cached map are read live on first use.
        void LiveRead(ControlInfo c){headerReads++;ReadText(c);}
        // Control classes never change for a window, so look each one up once per run.
        string ClassOf(IntPtr h) {
            string name;long key=h.ToInt64();
            if(classCache.TryGetValue(key,out name)) return name;
            if(classCache.Count>6000) classCache.Clear();
            name=Native.Class(h);classCache[key]=name;return name;
        }
        List<ControlInfo> Current() {
            var waited=Stopwatch.StartNew();
            while(true) {
                Check(true);var s=Snapshot(root);
                if(!lastSnapshotBusy || waited.ElapsedMilliseconds>=20000) return s;
                Pause(150);
            }
        }
        List<ControlInfo> GridCurrent() {
            Check(true);
            // Cache the container identity only. Rediscover live rows and values
            // on every read, including after DET creates or moves note controls.
            if(gridPanel==IntPtr.Zero || !Native.IsWindow(gridPanel) || Native.Pid(gridPanel)!=pid ||
                Native.GetAncestor(gridPanel,2)!=root || !Native.IsWindowVisible(gridPanel) ||
                !Native.IsWindowEnabled(gridPanel) || Native.GetParent(gridPanel).ToInt64()!=gridPanelParent || Native.Class(gridPanel)!=gridPanelClass) {
                var full=Current();var labels=full.Where(c=>c.Static && Order.Norm(c.Peek)=="ITEM").ToList();
                if(labels.Count!=1){gridPanel=IntPtr.Zero;gridLabels=null;return full;}
                gridPanel=new IntPtr(labels[0].Parent);
                Order.Require(Native.Pid(gridPanel)==pid && Native.GetAncestor(gridPanel,2)==root,"The item grid does not belong to this Repair Order.");
                gridPanelParent=Native.GetParent(gridPanel).ToInt64();gridPanelClass=Native.Class(gridPanel);
                RememberGridLabels(full);
                return full;
            }
            // Callers keep their normal wait/retry around row validation; temporary
            // overlapping rows during expansion must not fail before that wait.
            // Read plan: only the five header labels and the cells under them. The grid
            // holds ~180 readable controls; the engine's logic consults ~45 of them.
            var known=gridLabels;
            var snapshot=known==null?Snapshot(root,gridPanel):Snapshot(root,gridPanel,delegate(List<ControlInfo> s){return Selectors.GridReadSet(s,known);});
            gridSnapshotCount++;
            if(known==null) RememberGridLabels(snapshot);
            else if(!GridLabelsStill(snapshot,known)) {
                // A remembered label moved or changed: finish reading this snapshot in full
                // and learn the labels again, exactly as before the read plan existed.
                gridLabels=null;Diag.EventRaw("grid_read_plan_reset","header labels changed");
                foreach(var c in snapshot) if(c.Skipped){c.Late=null;ReadText(c);}
                RememberGridLabels(snapshot);
            }
            return snapshot;
        }
        static readonly string[] GridLabelNames={"ITEM","DESCRIPTION","QTY OR HRS","NET","LIST"};
        void RememberGridLabels(List<ControlInfo> s) {
            try { var g=Selectors.ProductGrid(s); gridLabels=new[]{g.Item.Handle,g.Description.Handle,g.Quantity.Handle,g.Net.Handle,g.ListPrice.Handle}; }
            catch(InvalidOperationException) { gridLabels=null; }
        }
        static bool GridLabelsStill(List<ControlInfo> s,long[] labels) {
            for(int i=0;i<labels.Length;i++) {
                long handle=labels[i];var c=s.FirstOrDefault(x=>x.Handle==handle);
                if(c==null || Order.Norm(c.Peek)!=GridLabelNames[i]) return false;
            }
            return true;
        }
        void Dump(string name,List<ControlInfo> data) { File.WriteAllText(Path.Combine(Folder,name+".json"),json.Serialize(data),new UTF8Encoding(false)); }
        void CaptureForegroundWindow(string stage) {
            // The old report captured only the Repair Order behind a dialog.
            // Keep the actual COSTAR window too, so a new notice can be mapped.
            try {
                var front=Native.GetForegroundWindow();
                if(front==root || !Native.IsWindow(front)) return;
                Native.Rect box; if(!Native.GetWindowRect(front,out box)) return;
                File.WriteAllText(Path.Combine(Folder,"foreground-window.json"),json.Serialize(new {
                    At=DateTimeOffset.Now.ToString("o"),Version=AutofillForm.Version,Step=stage,Handle=front.ToInt64(),Parent=Native.GetParent(front).ToInt64(),
                    Class=Native.Class(front),Title=Native.Caption(front),ProcessId=Native.Pid(front),CostarProcessId=pid,RepairOrderEnabled=Native.IsWindowEnabled(root),Enabled=Native.IsWindowEnabled(front),Bounds=new[]{box.Left,box.Top,box.Right-box.Left,box.Bottom-box.Top}
                }),new UTF8Encoding(false));
                if(Native.Pid(front)==pid || IsCustomerPopup(front)) {var popup=Snapshot(front);Dump("foreground-controls",popup);Diag.Popup(front,popup);}
            } catch { /* Diagnostics must not hide the original stop reason. */ }
        }
        void Ready() {
            WaitIdle(3000);var timer=Stopwatch.StartNew();int spins=0;
            try {
                while(timer.ElapsedMilliseconds<15000) {
                    Check(false);
                    string title;
                    if(Native.GetForegroundWindow()==root && Native.IsWindowEnabled(root) && Native.TryText(root,out title)) return;
                    if(enteringCustomer) { CustomerFormReady(0);return; }
                    if(Native.GetForegroundWindow()!=root) {
                        Diag.ForegroundLost(Native.GetForegroundWindow(),Native.IsWindowEnabled(root));
                        throw new InvalidOperationException("COSTAR opened another screen or lost focus. Entry stopped for you to check it.");
                    }
                    spins++;Pause(25);
                }
                throw new InvalidOperationException("COSTAR did not become ready in time.");
            } finally { if(spins>0) Diag.ReadyWait(timer.ElapsedMilliseconds); }
        }
        void CheckTarget(ControlInfo c) {
            Check(true); var h=new IntPtr(c.Handle);
            Order.Require(c.Edit && Native.Pid(h)==pid && Native.IsWindowVisible(h) && Native.IsWindowEnabled(h) && Native.GetAncestor(h,2)==root && Native.GetParent(h).ToInt64()==c.Parent && Native.Class(h)==c.Class && (Native.GetWindowLong(h,-16)&0x20)==0,"The target field changed before entry.");
        }
        void ClickTarget(ControlInfo c) {
            WaitIdle(2000);CheckTarget(c); var h=new IntPtr(c.Handle);
            Native.Rect box; Order.Require(Native.GetWindowRect(h,out box),"Cannot locate the target field.");
            var point=new Native.Point { X=box.Left+Math.Min(9,Math.Max(2,(box.Right-box.Left)/4)),Y=box.Top+Math.Min(10,Math.Max(2,(box.Bottom-box.Top)/2)) };
            IntPtr hit=Native.WindowFromPoint(point);
            if(hit!=h) {
                // 4 Oct: on a brand-new Repair Order something sat over the first field for a
                // moment (a retry on the same order always worked). Record what it was, then
                // wait up to 1.5 s for it to go; bring COSTAR back once if another app is on top.
                Diag.EventRaw("covered",DescribeCover(hit));
                var wait=Stopwatch.StartNew();bool raised=false;
                while(hit!=h && wait.ElapsedMilliseconds<1500) {
                    if(!raised && hit!=IntPtr.Zero && Native.Pid(hit)!=pid && !Native.UserActiveWithin(2000)) { raised=true; Native.BringToFront(root); }
                    Thread.Sleep(50);
                    Check(true);
                    if(!Native.GetWindowRect(h,out box)) break;
                    point=new Native.Point { X=box.Left+Math.Min(9,Math.Max(2,(box.Right-box.Left)/4)),Y=box.Top+Math.Min(10,Math.Max(2,(box.Bottom-box.Top)/2)) };
                    hit=Native.WindowFromPoint(point);
                }
                Diag.EventRaw("covered_wait",wait.ElapsedMilliseconds+" ms, "+(hit==h?"cleared":"still covered by "+DescribeCover(hit)));
            }
            Order.Require(hit==h,"The target field is covered. Leave COSTAR unobstructed and retry on an empty order.");
            Native.Click(point);Diag.Click();
        }
        // What is on top of a field: masked to its window class, owner and whether it is
        // COSTAR's own window (titles of other apps are never recorded).
        string DescribeCover(IntPtr hit) {
            if(hit==IntPtr.Zero) return "nothing";
            bool costar=Native.Pid(hit)==pid;IntPtr top=Native.GetAncestor(hit,2);
            return (costar?"COSTAR ":"another app ")+Native.Class(hit)+(costar&&top==root?" inside this Repair Order":costar?" in window \""+Sanitize.Text(Native.Caption(top),40)+"\"":"");
        }
        object DescribeControl(IntPtr h) {
            if(h==IntPtr.Zero || Native.Pid(h)!=pid || Native.GetAncestor(h,2)!=root) return null;
            Native.Rect box; Native.GetWindowRect(h,out box);
            string cls=Native.Class(h),text=null; int style=Native.GetWindowLong(h,-16);
            if(cls.IndexOf("EDIT",StringComparison.OrdinalIgnoreCase)>=0 && (style&0x20)==0) Native.TryText(h,out text);
            return new { Handle=h.ToInt64(),Parent=Native.GetParent(h).ToInt64(),Class=cls,Style=style,Text=text,
                Bounds=new[]{box.Left,box.Top,box.Right-box.Left,box.Bottom-box.Top} };
        }
        void TraceFocus(string stage,ControlInfo expected) {
            try {
                IntPtr focus=Native.Focus(root),front=Native.GetForegroundWindow(); Native.Rect box; Native.GetWindowRect(root,out box);
                log.WriteLine(json.Serialize(new { At=DateTimeOffset.Now.ToString("o"),Version=AutofillForm.Version,Type="focus",
                    Step=stage,Writes=writes,ForegroundIsRepairOrder=front==root,RepairOrderBounds=new[]{box.Left,box.Top,box.Right-box.Left,box.Bottom-box.Top},
                    Expected=expected,ExpectedLive=expected==null?null:DescribeControl(new IntPtr(expected.Handle)),ActualFocus=DescribeControl(focus) }));
            } catch { /* Diagnostics must not change entry behavior. */ }
        }
        void Focus(ControlInfo c) {
            CheckTarget(c);if(Native.Focus(root).ToInt64()==c.Handle)return;
            ClickTarget(c); var h=new IntPtr(c.Handle);
            var timer=Stopwatch.StartNew();var trace=new List<string>();IntPtr seen=new IntPtr(-1);
            while(timer.ElapsedMilliseconds<2000) {
                Check(true);var now=Native.Focus(root);
                if(now==h) {Diag.FocusWait(timer.ElapsedMilliseconds);return;}
                if(now!=seen && trace.Count<40) {seen=now;trace.Add(timer.ElapsedMilliseconds+"ms "+Shape(now));}
                Pause(25);
            }
            Diag.FocusFailed(Shape(h),trace);
            TraceFocus("Ordinary field focus failed",c);
            throw new InvalidOperationException("COSTAR did not focus the expected field.");
        }
        // Control kind, handle and position relative to the Repair Order. No text.
        string Shape(IntPtr h) {
            if(h==IntPtr.Zero) return "none";
            try {
                if(Native.Pid(h)!=pid) return "outside-COSTAR";
                Native.Rect box,rb;Native.GetWindowRect(h,out box);Native.GetWindowRect(root,out rb);
                return RunDiagnostics.KindOf(Native.Class(h))+"#"+h.ToInt64()+"@"+(box.Left-rb.Left)+","+(box.Top-rb.Top)+"+"+(box.Right-box.Left)+"x"+(box.Bottom-box.Top)+
                    (h==lastWritten?" (last written field)":"")+(Native.GetAncestor(h,2)!=root?" (other window)":"");
            } catch { return "unreadable"; }
        }
        void ReadEquals(ControlInfo c,string value,string label) {
            string actual; var timer=Stopwatch.StartNew();
            while(timer.ElapsedMilliseconds<2500) {
                Check(true);
                if(Native.TryText(new IntPtr(c.Handle),out actual) && Order.Clean(actual)==Order.Clean(value)) return;
                Pause(25);
            }
            throw new InvalidOperationException(label + " did not retain the expected value. Entry stopped.");
        }
        static string FieldText(string value,bool lowerCase) {
            return lowerCase?(value??"").ToLowerInvariant():Order.EntryText(value);
        }
        void Put(ControlInfo c,string value,string label,bool tab,bool lowerCase=false) {
            value=FieldText(value,lowerCase); Order.Safe(value,label,500);
            Focus(c); WriteFocused(c,value,label,tab,lowerCase);
        }
        void WriteFocused(ControlInfo c,string value,string label,bool tab,bool lowerCase=false) {
            value=FieldText(value,lowerCase); Order.Safe(value,label,500);
            CheckTarget(c); var h=new IntPtr(c.Handle);
            int style=Native.GetWindowLong(h,-16);
            Order.Require(c.Edit && (style&0x820)==0 && Native.Focus(root)==h,"The " + label + " field is read-only or protected.");
            UIntPtr result;var writeTimer=Stopwatch.StartNew();
            Order.Require(Native.WriteMessage(h,0xC,UIntPtr.Zero,value,3,1500,out result)!=IntPtr.Zero && result!=UIntPtr.Zero,"COSTAR did not accept " + label + ".");
            long setMs=writeTimer.ElapsedMilliseconds;lastWritten=h;
            writes++; ReadEquals(c,value,label);Diag.Write(setMs,writeTimer.ElapsedMilliseconds-setMs);
            Check(true);
            // Preserve the edit control's normal "modified" state for validation on Tab.
            Order.Require(Native.WriteMessage(h,0xB9,new UIntPtr(1),null,3,500,out result)!=IntPtr.Zero,"COSTAR did not mark " + label + " as edited.");
            if(tab) CommitField(c);
            Say("Entered " + label + ".");
        }
        void CommitField(ControlInfo c) {
            CheckTarget(c);var h=new IntPtr(c.Handle);
            Order.Require(Native.Focus(root)==h,"The field lost focus before validation.");
            Check(true);Native.Key(9);Diag.Key();var timer=Stopwatch.StartNew();
            // Most fields commit within milliseconds; a phone lookup can take seconds
            // when COSTAR is slow (4 Oct: 2.5 s), so allow 8 s before giving up.
            while(timer.ElapsedMilliseconds<8000) {
                Check(false);
                // A phone lookup can open its notice before Tab reaches the next field.
                if(Native.GetForegroundWindow()!=root || !Native.IsWindowEnabled(root)){Diag.Commit(timer.ElapsedMilliseconds,"dialog");return;}
                var focus=Native.Focus(root);
                if(focus!=IntPtr.Zero && focus!=h){Diag.Commit(timer.ElapsedMilliseconds,"moved");return;}
                Pause(25);
            }
            Diag.Commit(timer.ElapsedMilliseconds,"timeout");
            throw new InvalidOperationException("COSTAR did not commit the field after Tab.");
        }
        // A phone with two or more COSTAR accounts opens COSTAR's customer "Search" list
        // (seen on 3 Oct: a WinForms form with a results grid and Add new, Include Inactive,
        // Print Results, Search, Cancel, OK and Clear). OK stays unusable until a row is
        // highlighted. Take the first account: highlight the top row of the results grid
        // (accessibility first, a click on that row if needed), wait for OK, press OK.
        // Cancel, Add new, Search, Clear and Print are never pressed, and a new customer is
        // never created once this list was shown. An unfamiliar list stops with a capture.
        bool TryChooseFirstAccount(IntPtr front,List<ControlInfo> popup) {
            if(popup==null || front==root || Native.Pid(front)!=pid) return false;
            var kind=Selectors.AccountChooser(Native.Class(front),popup);
            if(!kind.IsChooser) return false;
            if(chooserAttempts==0) { Diag.Popup(front,popup); try { Dump("account-chooser-controls",popup); } catch(IOException) { } }
            Diag.EventRaw("account_chooser",kind.Reason+" accept="+(kind.Accept!=null)+" acceptEnabled="+(kind.Accept!=null&&Native.IsWindowEnabled(new IntPtr(kind.Accept.Handle)))+" listbox="+(kind.ListBox!=0)+" attempt="+(chooserAttempts+1));
            Order.Require(chooserAttempts<2,"The customer list did not close after choosing the first account. It is captured in the report; choose the customer in COSTAR, then retry.");
            chooserAttempts++;
            Check(false);
            Order.Require(Native.GetForegroundWindow()==front && IsCustomerPopup(front),"The customer list changed before the first account was chosen.");
            UIntPtr result;
            IntPtr okButton=kind.Accept==null?IntPtr.Zero:new IntPtr(kind.Accept.Handle);
            if(okButton!=IntPtr.Zero && !Native.IsWindowEnabled(okButton) && kind.ListBox==0) {
                // OK greyed out: COSTAR found nothing in Tempe. Search every branch (Tommy's steps).
                if(!SearchAllBranches(front,popup,okButton)) {
                    var cancel=popup.Where(c=>c.TextState=="read" && c.Class.IndexOf("BUTTON",StringComparison.OrdinalIgnoreCase)>=0 && Order.Norm(c.Text).Replace("&","")=="CANCEL").ToList();
                    Order.Require(cancel.Count==1 && Native.GetAncestor(new IntPtr(cancel[0].Handle),2)==front,"No account in any branch, and the search window's Cancel button was not found. Close it, then retry.");
                    Native.WriteMessage(new IntPtr(cancel[0].Handle),0xF5,UIntPtr.Zero,null,3,1000,out result); // BM_CLICK Cancel
                    var closing=Stopwatch.StartNew();
                    while(Native.IsWindow(front) && Native.IsWindowVisible(front) && closing.ElapsedMilliseconds<2500) Pause(25);
                    lookupCancelled=true;chooserClock.Restart();
                    Say("No account for this phone in any branch; entering the order's customer details.");
                    return true;
                }
            }
            sawChooser=true;lookupCancelled=false;
            if(kind.ListBox!=0) {
                var list=new IntPtr(kind.ListBox);
                if(Native.IsWindow(list) && Native.GetAncestor(list,2)==front) Native.WriteMessage(list,0x0186,UIntPtr.Zero,null,3,1000,out result); // LB_SETCURSEL row 0
            } else {
                string how=SelectFirstRow(front,kind.Accept==null?IntPtr.Zero:new IntPtr(kind.Accept.Handle));
                Diag.EventRaw("account_first_row",how);
            }
            if(kind.Accept!=null) {
                var button=new IntPtr(kind.Accept.Handle);string caption;
                var ready=Stopwatch.StartNew();
                while(!Native.IsWindowEnabled(button) && ready.ElapsedMilliseconds<1500) Pause(25);
                Order.Require(Native.GetAncestor(button,2)==front && Native.IsWindowEnabled(button) && Native.IsWindowVisible(button) &&
                    Native.TryText(button,out caption) && Order.Norm(caption)==Order.Norm(kind.Accept.Text),
                    "The customer list's OK button did not become available after selecting the first account. Nothing was pressed; the list is captured in the report.");
                Native.WriteMessage(button,0xF5,UIntPtr.Zero,null,3,1000,out result); // BM_CLICK
                Say("Two or more accounts share this phone: chose the first one ("+Order.Clean(kind.Accept.Text).Replace("&","")+").");
            } else {
                Order.Require(kind.EnterAllowed,"The customer list has no OK button and has buttons that could change data. Nothing was pressed; it is captured in the report.");
                Native.Key(13);Diag.Key();
                Say("Two or more accounts share this phone: chose the first one (Enter).");
            }
            var timer=Stopwatch.StartNew();
            while(Native.IsWindow(front) && Native.IsWindowVisible(front) && Native.GetForegroundWindow()==front && timer.ElapsedMilliseconds<2500) Pause(25);
            chooserClock.Restart();
            return true;
        }
        // 6 Oct (Tommy's video, TTW1730345): COSTAR's phone lookup only searches Tempe
        // (Branch 11). When the customer's accounts belong to other branches its "Search for
        // an Existing Customer" window opens with "Nothing found!" and OK greyed out. Done by
        // hand: the phone into that window's Phone box, its Branch box cleared, Search; the
        // accounts from every branch appear with row 1 highlighted and OK takes it.
        // Returns true when accounts were found (OK available), false when no branch has it.
        bool SearchAllBranches(IntPtr front,List<ControlInfo> popup,IntPtr ok) {
            var phoneBox=Selectors.FieldRightOf(popup,"PHONE");var branchBox=Selectors.FieldRightOf(popup,"BRANCH");
            var search=popup.Where(c=>c.TextState=="read" && c.Class.IndexOf("BUTTON",StringComparison.OrdinalIgnoreCase)>=0 && Order.Norm(c.Text).Replace("&","")=="SEARCH").ToList();
            Order.Require(phoneBox!=null && branchBox!=null && search.Count==1,"COSTAR's customer search window is not laid out as expected (Phone, Branch, Search). Nothing was changed; it is captured in the report.");
            string digits=Order.Phone(lookupPhone);
            Order.Require(digits.Length>=8,"The customer phone for the all-branch search is missing.");
            SetPopupText(front,phoneBox,digits,"the search window's Phone box");
            SetPopupText(front,branchBox,"","the search window's Branch box");
            Say("No account for this phone in this branch (Branch "+branch+"): searching every branch.");
            UIntPtr result;
            Native.WriteMessage(new IntPtr(search[0].Handle),0xF5,UIntPtr.Zero,null,3,1000,out result); // BM_CLICK Search
            var wait=Diag.Wait("customer_search_all_branches");
            try {
                var timer=Stopwatch.StartNew();
                while(timer.ElapsedMilliseconds<15000) {
                    wait.Tick();Check(false);
                    Order.Require(Native.IsWindow(front) && Native.IsWindowVisible(front),"COSTAR's customer search window closed during the all-branch search.");
                    if(Native.IsWindowEnabled(ok)) { wait.Done("accounts found");return true; }
                    if(timer.ElapsedMilliseconds>=800) {
                        var now=PopupSnapshot(front);
                        if(!lastSnapshotBusy && Selectors.NothingFound(now)) { wait.Done("none in any branch");return false; }
                    }
                    Pause(150);
                }
            } finally { wait.End(); }
            throw new InvalidOperationException("COSTAR's all-branch customer search did not finish within 15 s. Check the search window, then retry.");
        }
        void SetPopupText(IntPtr front,ControlInfo box,string value,string label) {
            var h=new IntPtr(box.Handle);UIntPtr result;string now;
            Order.Require(Native.IsWindow(h) && Native.GetAncestor(h,2)==front && Native.IsWindowEnabled(h),"COSTAR's search window changed before "+label+" could be set.");
            Order.Require(Native.WriteMessage(h,0xC,UIntPtr.Zero,value,3,1500,out result)!=IntPtr.Zero,"COSTAR did not accept "+label+".");
            Order.Require(Native.TryText(h,out now) && Order.Clean(now)==Order.Clean(value),"COSTAR did not keep "+label+".");
            writes++;Diag.Write(0,0);
        }
        // Tommy's rule (6 Oct): an order whose customer has a COSTAR customer number gets Ship
        // Via SHOP, entered as the last step. Deliveries keep their own Ship Via; a new
        // customer (no customer number) is left as it is. Never fatal.
        void SetShipViaShop() {
            var s=Current();
            var h=Selectors.Header(s);
            if(Order.Clean(ReadLive(h.Account)).Length==0) return;
            var box=Selectors.ShipVia(s);
            if(box==null) { Say("Ship Via box not found; enter SHOP by hand.");Diag.EventRaw("ship_via","box not found");return; }
            if(Order.Norm(ReadLive(box))=="SHOP") { Say("Ship Via already SHOP.");return; }
            PutMapped(box,"SHOP","Ship Via",true);
            Say("Entered Ship Via: SHOP (customer has a COSTAR customer number).");Diag.EventRaw("ship_via","SHOP");
        }
        // Highlights the first customer row of the list's results grid until OK lights up.
        // 5 Oct: the old version searched the list's panels smallest first, found the small
        // search-criteria panel (a table with no customer rows) and gave up there. Now every
        // grid-like panel is tried, largest first, then one level deeper; a row is selected
        // through accessibility and clicked near its left edge (row selector / first cell),
        // up to 3 top rows, stopping as soon as OK is enabled. On failure the grid's shape
        // (roles, counts, positions; never names or values) goes into the report.
        string SelectFirstRow(IntPtr front,IntPtr ok) {
            var grids=new List<KeyValuePair<IntPtr,int>>();
            Native.EnumChildWindows(front,delegate(IntPtr h,IntPtr unused) {
                Native.Rect r;
                if(Native.IsWindowVisible(h) && Native.Class(h).IndexOf("WindowsForms10.Window",StringComparison.OrdinalIgnoreCase)>=0 && Native.GetWindowRect(h,out r)) {
                    int w=r.Right-r.Left,hh=r.Bottom-r.Top;
                    if(w>=200 && hh>=60) grids.Add(new KeyValuePair<IntPtr,int>(h,w*hh));
                }
                return grids.Count<200;
            },IntPtr.Zero);
            var shapes=new List<string>();
            var ordered=grids.OrderByDescending(x=>x.Value).Take(20).Select(x=>x.Key).ToList();
            for(int depth=1;depth<=2;depth++) {
                foreach(var grid in ordered) {
                    Accessibility.IAccessible client=null,table=null;List<Msaa.Row> rows=null;
                    try {
                        client=Msaa.FromWindow(grid);
                        table=Msaa.Role(client)==Msaa.RoleTable?client:Msaa.FindTable(client,depth);
                        if(table==null) { if(depth==1 && shapes.Count<8) shapes.Add(WindowSize(grid)+" "+Msaa.Shape(client,8)); continue; }
                        rows=Msaa.TopRows(table,3);
                        if(rows.Count==0) { if(shapes.Count<8) shapes.Add(WindowSize(grid)+" table without rows "+Msaa.Shape(table,10)); continue; }
                        int tried=0;
                        foreach(var row in rows) {
                            tried++;
                            Msaa.SelectChild(table,row.Child);Pause(120);
                            if(ok!=IntPtr.Zero && Native.IsWindowEnabled(ok)) return "row "+tried+" selected";
                            if(row.Width>0 && row.Height>0) {
                                var point=new Native.Point{X=row.Left+Math.Min(40,Math.Max(4,row.Width/4)),Y=row.Top+row.Height/2};
                                IntPtr hit=Native.WindowFromPoint(point);
                                if(hit!=IntPtr.Zero && (hit==front || Native.GetAncestor(hit,2)==front)) { Native.Click(point);Diag.Click(); }
                            }
                            var wait=Stopwatch.StartNew();
                            while(ok!=IntPtr.Zero && !Native.IsWindowEnabled(ok) && wait.ElapsedMilliseconds<700) Pause(30);
                            if(ok==IntPtr.Zero || Native.IsWindowEnabled(ok)) return "row "+tried+" selected and clicked";
                        }
                        if(shapes.Count<8) shapes.Add(WindowSize(grid)+" rows tried "+tried+", OK still off "+Msaa.Shape(table,10));
                    } catch(Exception e) {
                        if(shapes.Count<8) shapes.Add(WindowSize(grid)+" "+e.GetType().Name);
                    } finally {
                        if(rows!=null) foreach(var row in rows) Msaa.Release(row.Child);
                        if(!Object.ReferenceEquals(table,client)) Msaa.Release(table);
                        Msaa.Release(client);
                    }
                }
            }
            Diag.EventRaw("account_grid_shape",String.Join(" || ",shapes));
            return "no customer row found";
        }
        static string WindowSize(IntPtr h) { Native.Rect r; return Native.GetWindowRect(h,out r)?(r.Right-r.Left)+"x"+(r.Bottom-r.Top):"?"; }
        bool CustomerPopup(IntPtr front,List<ControlInfo> controls) {
            if(front==root || controls==null || !Selectors.CustomerNotFoundNotice(controls)) return false;
            Check(false); Order.Require(Native.GetForegroundWindow()==front && Native.Pid(front)==pid && Native.IsWindowVisible(front),"Customer popup changed.");
            Native.Key(27);Diag.Key();var timer=Stopwatch.StartNew();
            while(Native.IsWindowVisible(front) && Native.GetForegroundWindow()==front && timer.ElapsedMilliseconds<1500)Pause(25);
            Order.Require(!Native.IsWindowVisible(front) || Native.GetForegroundWindow()!=front,"The Customer Not found notice did not close after Escape.");
            Say("Dismissed Customer Not found.");return true;
        }
        bool IsCustomerPopup(IntPtr window) {
            if(window==IntPtr.Zero || window==root || !Native.IsWindowVisible(window) || Native.Caption(window).StartsWith("RepairOrder",StringComparison.OrdinalIgnoreCase)) return false;
            var owner=window;
            for(int i=0;i<16 && owner!=IntPtr.Zero;i++) {
                owner=Native.GetWindow(owner,4); // GW_OWNER
                if(owner==root) return true;
            }
            // Existing COSTAR main windows must never receive a Close request.
            return Native.Pid(window)==pid && !originalWindows.Contains(window.ToInt64());
        }
        List<ControlInfo> PopupSnapshot(IntPtr window) {
            try { return Snapshot(window); }
            catch(InvalidOperationException) {
                if(!Native.IsWindow(window) || Native.GetForegroundWindow()!=window) return null;
                throw;
            }
        }
        void RecoverCustomerUi(IntPtr front,List<ControlInfo> popup,List<ControlInfo> snapshot) {
            Check(false);
            if(Native.GetForegroundWindow()!=front) return;
            if(IsCustomerPopup(front)) {
                popup=popup??PopupSnapshot(front);
                if(popup==null) return;
                CaptureForegroundWindow("Customer popup recovery");
                if(Native.GetForegroundWindow()!=front || !IsCustomerPopup(front)) return;
                if(Native.Pid(front)==pid && CustomerPopup(front,popup)) { lookupCancelled=true;return; }
                if(TryChooseFirstAccount(front,popup)) return;
                int stage;popupCloseStages.TryGetValue(front.ToInt64(),out stage);
                Order.Require(stage<3 && recoveryActions<8,"The customer popup did not close. Close it in COSTAR and check the partial order before retrying.");
                Check(false);
                Order.Require(Native.GetForegroundWindow()==front && IsCustomerPopup(front),"Customer popup changed before cancellation.");
                var button=Selectors.CustomerCancelButton(popup); UIntPtr result;
                if(stage==0 && button!=null) {
                    var handle=new IntPtr(button.Handle);string caption;
                    Order.Require(Native.GetAncestor(handle,2)==front && Native.IsWindowEnabled(handle) && Native.IsWindowVisible(handle) && Native.TryText(handle,out caption) && Order.Norm(caption)==Order.Norm(button.Text),"The popup Cancel/Close button changed.");
                    Native.WriteMessage(handle,0xF5,UIntPtr.Zero,null,3,1000,out result); // BM_CLICK on Cancel/Close only
                    Say("Requested "+Order.Clean(button.Text).Replace("&","")+" on the customer popup.");
                } else if(stage<2) {
                    Native.Key(27);Diag.Key();Say("Sent Escape to cancel the customer popup.");
                } else {
                    // Normal title-bar Close; never destroy/disable a window or confirm OK/Yes.
                    Native.WriteMessage(front,0x10,UIntPtr.Zero,null,3,1000,out result);
                    Say("Requested Close on the customer popup.");
                }
                popupCloseStages[front.ToInt64()]=stage+1;recoveryActions++;lookupCancelled=true;
                Pause(400);return;
            }
            if(front!=root) {
                if(front==IntPtr.Zero) { Pause(150);return; }
                CaptureForegroundWindow("Customer lookup focus changed");
                Order.Require(!restoredCustomerFocus && Native.IsWindowEnabled(root),"Another window is blocking COSTAR. Its title/process are in the report. Close it and check the partial order before retrying.");
                restoredCustomerFocus=true;Native.BringToFront(root);
                Say("Returning to the original Repair Order after the customer lookup lost focus.");Pause(350);return;
            }
            if(Selectors.CustomerSearchInProgress(snapshot)) {
                Order.Require(Native.IsWindowEnabled(root) && searchCancelAttempts<2 && recoveryActions<8,"COSTAR's search did not cancel. Close the search and check the partial order before retrying.");
                Dump("cancel-search-controls",snapshot);
                Check(false);Order.Require(Native.GetForegroundWindow()==root,"COSTAR changed before cancelling its search.");
                Native.Key(27);Diag.Key();searchCancelAttempts++;recoveryActions++;lookupCancelled=true;
                Say("Sent Escape to cancel the customer search; checking that the Repair Order is editable.");Pause(400);
            }
        }
        void CustomerFormReady(int quietMilliseconds) {
            var wait=Diag.Wait("customer_form_ready");
            try {
            var timer=Stopwatch.StartNew();var quiet=Stopwatch.StartNew();string previous=null;
            while(timer.ElapsedMilliseconds<CustomerLookupTimeoutMs) {
                wait.Tick();Check(false);var front=Native.GetForegroundWindow();
                var snapshot=Snapshot(root);
                if(lastSnapshotBusy) { previous=null;quiet.Restart();Pause(150);continue; }
                if(front!=Native.GetForegroundWindow()) { quiet.Restart();Pause(40);continue; }
                bool searching=Selectors.CustomerSearchInProgress(snapshot);
                if(front!=root || searching) {
                    previous=null;quiet.Restart();
                    if(timer.ElapsedMilliseconds>=(front!=root?750:SearchPatienceMs)) RecoverCustomerUi(front,null,snapshot);
                    Pause(searching?120:50);continue;
                }
                if(!Native.IsWindowEnabled(root)) { previous=null;quiet.Restart();Pause(40);continue; }
                try {
                    var m=Selectors.Header(snapshot);
                    string signature=m.Account.Value+"|"+m.Name.Value+"|"+m.Phone.Value;
                    if(signature!=previous) { previous=signature;quiet.Restart(); }
                    if(quiet.ElapsedMilliseconds>=quietMilliseconds) {wait.Done("ok");return;}
                } catch(InvalidOperationException) { previous=null;quiet.Restart(); }
                Pause(40);
            }
            wait.Done("timeout");
            throw new InvalidOperationException("COSTAR did not return to an editable customer form after popup recovery. Close the remaining popup and retry on an empty Repair Order.");
            } finally {wait.End();}
        }
        bool LookupCustomer() {
            var wait=Diag.Wait("customer_lookup");
            try {
            int stable=0;string previous=null;var timer=Stopwatch.StartNew();
            while(timer.ElapsedMilliseconds<CustomerLookupTimeoutMs) {
                wait.Tick();Check(false);var front=Native.GetForegroundWindow();var snapshot=Snapshot(root);
                if(lastSnapshotBusy) { stable=0;Pause(150);continue; }
                if(front!=Native.GetForegroundWindow()) { stable=0;Pause(40);continue; }
                List<ControlInfo> popup=IsCustomerPopup(front)?PopupSnapshot(front):null;
                if(front!=Native.GetForegroundWindow()) { stable=0;Pause(40);continue; }
                if(popup!=null && Native.Pid(front)==pid && CustomerPopup(front,popup)) { lookupCancelled=true;stable=0;continue; }
                if(popup!=null && TryChooseFirstAccount(front,popup)) { stable=0;previous=null;continue; }
                bool searching=Selectors.CustomerSearchInProgress(snapshot) || (popup!=null && Selectors.CustomerSearchInProgress(popup));
                if(front!=root || searching || !Native.IsWindowEnabled(root)) {
                    stable=0;
                    int patience=front!=root?750:searching?SearchPatienceMs:3000;
                    if(timer.ElapsedMilliseconds>=patience) RecoverCustomerUi(front,popup,snapshot);
                    Pause(searching?120:50);continue;
                }
                FieldMap m;
                // An existing customer's account makes COSTAR rebuild the customer panel.
                // Missing labels during that redraw are transient: keep waiting.
                try { m=Selectors.Header(snapshot); }
                catch(InvalidOperationException) { stable=0;previous=null;Pause(60);continue; }
                string signature=m.Account.Value+"|"+m.Name.Value+"|"+m.Phone.Value;
                stable=signature==previous?stable+1:1;previous=signature;
                if(stable>=2) {
                    if(CustomerEntry.HasMatch(m.Account.Value,m.Name.Value,m.Phone.Value,order.customer.phone)){wait.Done(sawChooser?"existing-customer-first-of-several":"existing-customer");return true;}
                    if(sawChooser) {
                        // The first account was chosen from the list: give COSTAR time to load it.
                        Order.Require(chooserClock.ElapsedMilliseconds<5000,"The first account was chosen from the list, but COSTAR did not load an account with this phone. Choose it in COSTAR, then retry; the list is captured in the report.");
                        stable=0;previous=null;Pause(40);continue;
                    }
                    Order.Require(m.Account.Value.Length==0,"COSTAR selected an account whose phone does not match. Check the account before continuing.");
                    if(lookupCancelled || timer.ElapsedMilliseconds>=3000) {
                        Order.Require(CustomerEntry.LookupResolved(m.Account.Value,m.Name.Value,m.Phone.Value,order.customer.phone),"The customer phone changed during lookup recovery.");
                        wait.Done(lookupCancelled?"new-customer-after-popup":"new-customer-after-3s-wait");return false;
                    }
                }
                Pause(30);
            }
            wait.Done("timeout");
            throw new InvalidOperationException("Customer lookup did not return to an editable form. Check the popup and customer account.");
            } finally {wait.End();}
        }
        void CustomerField(Func<FieldMap,ControlInfo> selector,string value,string label,bool allowEmpty=false) {
            if(!allowEmpty && String.IsNullOrWhiteSpace(value)) return;
            value=Order.EntryText(value);
            Ready();var header=HeaderNow();
            if(verifiedCustomerAccount!=null)Order.Require(header.Account.Value==verifiedCustomerAccount &&
                (verifiedCustomerName==null || header.Name.Value==verifiedCustomerName),"The selected customer account/name changed while filling the header.");
            var c=selector(header);
            if(c.Value==Order.Clean(value)) return;
            Put(c,value,label,true); Ready(); ReadEquals(selector(HeaderNow()),value,label);
        }
        string ReadLive(ControlInfo c) {
            CheckTarget(c);string value;
            Order.Require(Native.TryText(new IntPtr(c.Handle),out value),"A mapped COSTAR field is not readable.");
            return Order.Clean(value);
        }
        void PutMapped(ControlInfo c,string value,string label,bool allowEmpty=false,bool lowerCase=false) {
            if(!allowEmpty && String.IsNullOrWhiteSpace(value))return;
            value=FieldText(value,lowerCase);Ready();
            if(ReadLive(c)==Order.Clean(value))return;
            Put(c,value,label,true,lowerCase);Ready();ReadEquals(c,value,label);
        }
        void GuardCustomer(FieldMap h) {
            Order.Require(ReadLive(h.Account)==verifiedCustomerAccount &&
                (verifiedCustomerName==null || ReadLive(h.Name)==verifiedCustomerName) &&
                Order.Phone(ReadLive(h.Phone))==Order.Phone(order.customer.phone),"The selected customer account/name/phone changed while filling the header.");
        }
        void FillOnlineHeader(bool existing) {
            // Header controls do not expand like grid rows. Map once, then check
            // each live HWND/parent/class and retained text rather than rereading
            // hundreds of unrelated grid controls for every field.
            var h=HeaderNow();var c=order.customer;GuardCustomer(h);
            if(!existing) {
                PutMapped(h.Name,c.name,"customer name");
                verifiedCustomerName=Order.Clean(Order.EntryText(c.name));
            }
            GuardCustomer(h);PutMapped(h.Email,c.email,"email",lowerCase:true);
            var fields=new[] {
                new {Field=h.Address,Value=c.streetAddress,Label="address",Clear=false},
                new {Field=h.Address2,Value=c.address2,Label="address line 2",Clear=!String.IsNullOrWhiteSpace(c.streetAddress)},
                new {Field=h.Suburb,Value=c.suburb,Label="suburb",Clear=false},
                new {Field=h.State,Value=c.state,Label="state",Clear=false},
                new {Field=h.Postcode,Value=c.postcode,Label="postcode",Clear=false},
                new {Field=h.PO,Value=order.orderId,Label="PO#",Clear=false},
                new {Field=h.Comment,Value=order.comment,Label="order comment",Clear=true}
            };
            foreach(var field in fields){GuardCustomer(h);PutMapped(field.Field,field.Value,field.Label,field.Clear);}
            GuardCustomer(h);
            if(!order.IsDelivery) SetTimeIn();
        }
        // Time in: COSTAR fills it with the moment the order was opened. For an online pickup
        // the booking time is what the workshop needs, so it goes in instead. Never fatal:
        // if COSTAR will not take it, the order is still finished and the log says so.
        void SetTimeIn() {
            string want=Order.TimeInText(order.pickupTime);
            if(want==null) return;
            var box=Selectors.TimeIn(Current());
            if(box==null) { Say("Time in box not found on this Repair Order; left as COSTAR set it.");Diag.EventRaw("time_in","box not found");return; }
            if(Order.ClockMinutes(ReadLive(box))==Order.ClockMinutes(want)) { Say("Time in already shows the booking time ("+want+").");return; }
            Put(box,want,"Time in",true);Ready();
            string now=ReadLive(box);
            if(Order.ClockMinutes(now)==Order.ClockMinutes(want)) { Say("Entered Time in: "+want+" (booking time).");Diag.EventRaw("time_in","set"); }
            else { Say("COSTAR did not keep Time in "+want+" (shows "+now+"). Set it by hand.");Diag.EventRaw("time_in","not kept"); }
        }
        void FillDelivery() {
            // Billing has already been committed; shipping is a separate panel.
            var d=order.shipping;var m=Selectors.Delivery(Current());
            PutMapped(m.Name,d.name,"delivery recipient",true);
            PutMapped(m.Address,d.streetAddress,"delivery street",true);
            PutMapped(m.Address2,d.address2,"delivery address line 2",true);
            PutMapped(m.Suburb,d.suburb,"delivery suburb",true);
            PutMapped(m.State,d.state,"delivery state",true);
            PutMapped(m.Postcode,d.postcode,"delivery postcode",true);
            PutMapped(m.Contact,d.contact,"delivery contact",true);
            PutMapped(m.BusinessPhone,d.businessPhone,"delivery business phone",true);
            PutMapped(m.MobilePhone,d.mobilePhone,"delivery mobile",true);
            PutMapped(m.Email,d.email,"delivery email",true,lowerCase:true);
            PutMapped(m.ShipVia,d.shipVia,"Ship Via",true);
            PutMapped(m.Instructions,d.instructions,"shipping instructions",true);
            Say("Billing and delivery panels filled separately.");
        }
        ControlInfo BlankRow(List<ControlInfo> snapshot) {
            var g=Selectors.ProductGrid(snapshot); int bottom=g.Rows.Where(c=>c.Value.Length>0).Select(c=>c.Y).DefaultIfEmpty(-1).Max();
            var next=g.Rows.FirstOrDefault(c=>c.Y>bottom && c.Value.Length==0);
            Order.Require(next!=null,"No empty item row is visible. Entry stopped; check the order before continuing manually.");
            return next;
        }
        // The empty box on a numbered line (1-based).
        ControlInfo LineRow(List<ControlInfo> snapshot,int line) {
            var g=Selectors.ProductGrid(snapshot);
            Order.Require(line>=1 && line<=g.Rows.Count,"Line "+line+" is not visible in COSTAR's item grid. Entry stopped; check the order.");
            Order.Require(g.EvenLines,"COSTAR's item lines are not laid out as expected, so line "+line+" cannot be found safely. Entry stopped before typing.");
            var row=g.Rows[line-1];
            Order.Require(row.Value.Length==0,"Line "+line+" already holds "+row.Value+". Entry stopped; check the order.");
            return row;
        }
        // The next free line above DET for the next item (lines 1 down). When nothing fits above
        // (an order an older helper started, with DET straight after its items): the first empty
        // line after everything, as before.
        ControlInfo ItemRowAbove(List<ControlInfo> snapshot,int detLine) {
            var g=Selectors.ProductGrid(snapshot);
            int last=0;
            for(int i=0;i<g.Rows.Count && i<detLine-1;i++) if(g.Rows[i].Value.Length>0) last=i+1;
            return last+1<detLine?LineRow(snapshot,last+1):BlankRow(snapshot);
        }
        // DET's three notes must sit directly under it, so the items can go above without mixing
        // with them. Anything else stops entry; nothing is guessed.
        void RequireNotesUnderDet(int detLine) {
            var s=GridCurrent();var g=Selectors.ProductGrid(s);
            var det=g.Rows.Where(r=>Order.Norm(r.Value)=="DET").ToList();
            Order.Require(det.Count==1 && g.LineOf(det[0].Handle)==detLine,"DET is not on line "+detLine+". Entry stopped; check the order.");
            foreach(var note in new[]{new{Prefix="MAKE/MODEL",Code="M"},new{Prefix="REGO NO",Code="M"},new{Prefix="ODOMETER",Code="M ODO"}}) {
                var memo=Selectors.FindMemo(s,note.Prefix,note.Code);
                int at=memo==null?0:g.LineOf(memo.Row.Handle);
                Order.Require(at>detLine && at<=detLine+3,"COSTAR put DET's "+note.Prefix+" note "+(at==0?"nowhere":"on line "+at)+" instead of directly under DET (line "+detLine+"). Entry stopped; check the order.");
            }
            Say("DET is on line "+detLine+" with its notes directly under it.");
        }
        ControlInfo Row(List<ControlInfo> snapshot,long handle,string code) {
            var r=Selectors.One(Selectors.ProductGrid(snapshot).Rows.Where(c=>c.Handle==handle),"current item row");
            Order.Require(Order.Norm(r.Value)==code,"COSTAR changed the current item code unexpectedly."); return r;
        }
        void LeaveGrid(string stage) {
            // Leaving the description commits COSTAR's generated notes. Waiting
            // inside DET can leave those rows hidden indefinitely. PO# is an
            // already-filled header field: focus it without changing its text.
            var wait=Diag.Wait("leave_grid");
            try {
            Ready();ControlInfo po=HeaderNow().PO;
            var budget=Stopwatch.StartNew();
            for(int attempt=1;attempt<=12 && budget.ElapsedMilliseconds<6000;attempt++) {
                if(attempt>1)Diag.EventRaw("leave_grid_retry","attempt "+attempt+" "+stage);
                Ready();Order.Require(ReadLive(po)==order.orderId,"The PO# changed before leaving the item editor.");
                TraceFocus("Leaving item editor " + stage + ", attempt " + attempt,po);
                if(Native.Focus(root).ToInt64()!=po.Handle) ClickTarget(po);
                // COSTAR can finish the item lookup after the click and pull focus back
                // into the grid. Accept PO# once COSTAR has been busy and settled with
                // focus still there, or after it has held focus for 300 ms. Otherwise
                // click again quickly instead of waiting out a long timeout.
                var timer=Stopwatch.StartNew();long heldSince=-1;idleWaitedMs=0;
                while(timer.ElapsedMilliseconds<700) {
                    wait.Tick();Ready();Order.Require(ReadLive(po)==order.orderId,"The PO# changed while leaving the item editor.");
                    bool onPo=Native.Focus(root).ToInt64()==po.Handle,settled=idleWaitedMs>=15;
                    if(onPo) {
                        if(heldSince<0)heldSince=timer.ElapsedMilliseconds;
                        if(settled || timer.ElapsedMilliseconds-heldSince>=300) {
                            CheckTarget(po); TraceFocus("Confirmed outside item editor " + stage,po);
                            Say("Left item editor " + stage + "; PO# unchanged."); wait.Done(attempt==1?"ok":"ok-attempt-"+attempt); return;
                        }
                    } else if(heldSince>=0 || (settled && timer.ElapsedMilliseconds>=120)) break; // Focus was pulled back, or COSTAR settled without taking the click.
                    Pause(20);
                }
            }
            TraceFocus("Could not leave item editor " + stage,po);wait.Done("failed");
            throw new InvalidOperationException("COSTAR did not leave the item editor " + stage + ".");
            } finally {wait.End();}
        }
        // DET: one click on PO# makes the DET description lose focus, and that is what
        // creates the MAKE/MODEL, REGO NO and ODOMETER notes. Once those notes exist the
        // click has done its job, wherever COSTAR then puts the cursor. 1.6.1 runs showed
        // 0.5-1.2 s spent winning focus back to PO# after the notes already existed.
        // Falls back to the full leave-grid routine if the notes do not appear.
        bool LeaveForDetNotes() {
            var wait=Diag.Wait("det_leave_once");
            try {
                Ready();ControlInfo po=HeaderNow().PO;
                Order.Require(ReadLive(po)==order.orderId,"The PO# changed before leaving the item editor.");
                if(Native.Focus(root).ToInt64()!=po.Handle) ClickTarget(po);
                var timer=Stopwatch.StartNew();string previous=null;int stable=0;
                while(timer.ElapsedMilliseconds<1500) {
                    wait.Tick();Ready();
                    try {
                        var s=GridCurrent();
                        var car=Selectors.FindMemo(s,"MAKE/MODEL","M");var rego=Selectors.FindMemo(s,"REGO NO","M");var odo=Selectors.FindMemo(s,"ODOMETER","M ODO");
                        if(car!=null && rego!=null && odo!=null) {
                            string signature=Selectors.MemoSignature(car)+"|"+Selectors.MemoSignature(rego)+"|"+Selectors.MemoSignature(odo);
                            stable=signature==previous?stable+1:1;previous=signature;
                            if(stable>=2) {
                                Order.Require(ReadLive(po)==order.orderId,"The PO# changed while leaving the item editor.");
                                Say("Left item editor after DET; notes created; PO# unchanged.");wait.Done("ok");return true;
                            }
                        } else { stable=0;previous=null; }
                    } catch(InvalidOperationException) { stable=0;previous=null; }
                    Pause(25);
                }
                wait.Done("fallback");return false;
            } finally {wait.End();}
        }
        // line: type on that line (1-based). above: the next free line above that line (items
        // going in above DET). Neither: the first empty line after everything, as before.
        long AddCode(string code,bool allowBlankDescription,bool priced=false,bool commitOutsideGrid=false,int line=0,int above=0) {
            code=Order.EntryText(code);
            Ready(); var before=GridCurrent(); var row=line>0?LineRow(before,line):above>0?ItemRowAbove(before,above):BlankRow(before);
            Put(row,code,"item " + code,true);
            // DET reveals its generated note rows only once the description loses
            // focus, so leave the grid before waiting for them. First let COSTAR finish
            // looking up the code itself (the row's description fills in): a PO# click
            // made before that is undone when COSTAR moves focus back into the grid.
            if(commitOutsideGrid) {
                var lookup=Diag.Wait("det_lookup");
                try {
                    var settle=Stopwatch.StartNew();bool filled=false;
                    while(settle.ElapsedMilliseconds<1500) {
                        lookup.Tick();Ready();
                        try {
                            var s=GridCurrent();var r=Row(s,row.Handle,code);var d=Selectors.Cell(s,r,Selectors.ProductGrid(s).Description);
                            if(d.TextState=="read" && d.Value.Length>0) {filled=true;break;}
                        } catch(InvalidOperationException) { /* Row still loading. */ }
                        Pause(20);
                    }
                    lookup.Done(filled?"ok":"not-filled-continuing");
                } finally {lookup.End();}
                if(code!="DET" || !LeaveForDetNotes()) LeaveGrid("after " + code);
            }
            var wait=Diag.Wait(code=="DET"?"det_row_load":"item_load");
            try {
            var timer=Stopwatch.StartNew(); string previous=null; int stable=0;
            while(timer.ElapsedMilliseconds<15000) {
                wait.Tick();Ready(); var snapshot=GridCurrent();
                try {
                    var r=Row(snapshot,row.Handle,code); var grid=Selectors.ProductGrid(snapshot);
                    var description=Selectors.Cell(snapshot,r,grid.Description);
                    if(description.TextState=="read" && (allowBlankDescription || description.Value.Length>0)) {
                        string signature=description.Value + "|" + String.Join(";",grid.Rows.Where(x=>x.Value.Length>0).Select(x=>x.Value));
                        if(priced) signature += "|" + Selectors.Cell(snapshot,r,grid.Quantity).Value + "|" + Selectors.Cents(Selectors.Cell(snapshot,r,grid.Net));
                        if(signature==previous) stable++; else { previous=signature; stable=1; }
                        if(stable>=2) {wait.Done("ok");return row.Handle;}
                    } else { stable=0; previous=null; }
                } catch(InvalidOperationException) { stable=0; previous=null; }
                Pause(20);
            }
            wait.Done("timeout");
            throw new InvalidOperationException("COSTAR did not finish loading " + code + ".");
            } finally {wait.End();}
        }
        void AddLine(OrderLine line,int above=0) { FinishLine(line,AddCode(line.code,false,true,false,0,above)); }
        // The nth (0-based) item row holding this code, or 0 if there is none.
        long ExistingRow(string code,int nth) {
            var rows=Selectors.ProductGrid(GridCurrent()).Rows.Where(r=>Order.Norm(r.Value)==Order.Norm(code)).ToList();
            return rows.Count>nth?rows[nth].Handle:0;
        }
        // Description check, quantity and price for a row that holds this line's code. Safe to
        // run again on a row entered by an earlier, stopped attempt.
        void FinishLine(OrderLine line,long handle) {
            var s=GridCurrent(); var g=Selectors.ProductGrid(s); var r=Row(s,handle,line.code);
            string description=Order.Norm(Selectors.Cell(s,r,g.Description).Value);
            if(line.kind=="service") {
                bool front=description.Contains("FRONT"), rear=description.Contains("REAR"), alignment=description.Contains("ALIGNMENT");
                Order.Require(alignment && front && (line.code=="WA" ? !rear : rear),"The COSTAR alignment description does not match the online service.");
            }
            // Product SKU is the identifier; preserve COSTAR's own product description.
            if(PutQuantity(Selectors.Cell(s,r,g.Quantity),line.quantity,"quantity for " + line.code)) {
                Ready();s=GridCurrent();g=Selectors.ProductGrid(s);r=Row(s,handle,line.code);
            }
            var net=Selectors.Cell(s,r,g.Net);
            bool package=line.kind=="package";
            if(!package && Selectors.Cents(net)!=line.unitCents) Put(net,(line.unitCents/100m).ToString("0.00",CultureInfo.InvariantCulture),"price for " + line.code,true);
            Ready(); s=GridCurrent(); g=Selectors.ProductGrid(s); r=Row(s,handle,line.code);
            int actualPrice=Selectors.Cents(Selectors.Cell(s,r,g.Net));
            Order.Require(Selectors.Cell(s,r,g.Quantity).Value==line.quantity.ToString(CultureInfo.InvariantCulture) && (package || actualPrice==line.unitCents),"The quantity or price changed after COSTAR validated it.");
            if(package) {
                packagePrices[order.lines.IndexOf(line)]=actualPrice;
                Say("Package SKU " + line.code + " entered at COSTAR's current unit price $" + (actualPrice/100m).ToString("0.00",CultureInfo.InvariantCulture) + ". Missing tyre components, quantities and package pricing require manual completion.");
            } else Say("Verified item " + line.code + ".");
        }
        bool PutQuantity(ControlInfo field,int quantity,string label) {
            string expected=quantity.ToString(CultureInfo.InvariantCulture);
            if(ReadLive(field)==expected) { skippedQuantities++;return false; }
            Put(field,expected,label,true);return true;
        }
        void AddFreight() { if(order.freightCents==0) return; FinishFreight(AddCode("F",false,true)); }
        void FinishFreight(long handle) {
            var s=GridCurrent();var g=Selectors.ProductGrid(s);var r=Row(s,handle,"F");
            Order.Require(Order.Norm(Selectors.Cell(s,r,g.Description).Value)=="FREIGHT","F did not load the recorded Freight item.");
            if(PutQuantity(Selectors.Cell(s,r,g.Quantity),1,"freight quantity")) {
                Ready();s=GridCurrent();g=Selectors.ProductGrid(s);r=Row(s,handle,"F");
            }
            // The recording edits List, which then updates Net and the tax-in total.
            Put(Selectors.Cell(s,r,g.ListPrice),(order.freightCents/100m).ToString("0.00",CultureInfo.InvariantCulture),"freight charge",true);
            Ready();s=GridCurrent();g=Selectors.ProductGrid(s);r=Row(s,handle,"F");
            Order.Require(Selectors.Cell(s,r,g.Quantity).Value=="1" && Selectors.Cents(Selectors.Cell(s,r,g.Net))==order.freightCents,"The freight charge did not retain its expected value.");
        }
        void WaitForDetailsTemplate() {
            var wait=Diag.Wait("det_template");
            try {
            var timer=Stopwatch.StartNew(); string previous=null,lastProblem="The note rows have not appeared."; int stable=0;
            while(timer.ElapsedMilliseconds<12000) {
                wait.Tick();Ready(); var s=GridCurrent();
                try {
                    var car=Selectors.FindMemo(s,"MAKE/MODEL","M");
                    var rego=Selectors.FindMemo(s,"REGO NO","M");
                    var odo=Selectors.FindMemo(s,"ODOMETER","M ODO");
                    if(car!=null && rego!=null && odo!=null) {
                        string signature=Selectors.MemoSignature(car)+"|"+Selectors.MemoSignature(rego)+"|"+Selectors.MemoSignature(odo);
                        stable=signature==previous?stable+1:1;previous=signature;
                        if(stable>=2) { Say("DET template ready: car, rego and odometer notes located."); wait.Done("ok"); return; }
                    } else { stable=0;previous=null; }
                } catch(InvalidOperationException e) { stable=0;previous=null;lastProblem=e.Message; }
                Pause(25);
            }
            TraceFocus("DET template did not settle",null);wait.Done("timeout");
            throw new InvalidOperationException("DET did not finish creating stable car/rego notes. " + lastProblem);
            } finally {wait.End();}
        }
        MemoTarget ResolveMemo(string prefix,string code,long createdRow) {
            var s=GridCurrent();
            // Existing DET rows are located afresh by their label, never by a stale editor handle.
            var target=Selectors.FindMemo(s,prefix,code);
            if(target!=null) return target;
            Order.Require(createdRow!=0,"The " + prefix + " note disappeared after DET. Entry stopped.");
            var g=Selectors.ProductGrid(s); var row=Row(s,createdRow,code);
            var editor=Selectors.Cell(s,row,g.Description);
            Order.Require(editor.Value.Length==0,"An unfamiliar note appeared in the new memo row.");
            return new MemoTarget { Row=row,Editor=editor };
        }
        MemoTarget FocusMemo(Func<MemoTarget> locate,string label,MemoTarget initial=null) {
            // Click the live description directly, as in the recording. Only use
            // item-cell navigation if COSTAR redirects focus while expanding it.
            var wait=Diag.Wait("memo_focus");
            try {
            for(int attempt=1;attempt<=3;attempt++) {
                if(attempt>1)Diag.EventRaw("memo_focus_retry",label+" attempt "+attempt);
                Ready();var target=attempt==1 && initial!=null?initial:locate();
                if(attempt>1) {
                    ClickTarget(target.Row);var selection=Stopwatch.StartNew();
                    while(selection.ElapsedMilliseconds<500) {
                        Ready();target=locate();var focus=Native.Focus(root).ToInt64();
                        if(focus==target.Row.Handle){CommitField(target.Row);break;}
                        if(focus==target.Editor.Handle)break;
                        Pause(25);
                    }
                    Ready();target=locate();
                }
                if(Native.Focus(root).ToInt64()!=target.Editor.Handle)ClickTarget(target.Editor);
                var timer=Stopwatch.StartNew();string previous=Selectors.MemoSignature(target);
                while(timer.ElapsedMilliseconds<1200) {
                    wait.Tick();Ready();
                    try {
                        var live=locate(); string signature=Selectors.MemoSignature(live);
                        if(Native.Focus(root).ToInt64()==live.Editor.Handle) {
                            if(signature==previous) {
                                CheckTarget(live.Editor); TraceFocus("Confirmed focus for " + label,live.Editor);wait.Done(attempt==1?"ok":"ok-attempt-"+attempt);return live;
                            }
                            previous=signature;
                        } else {
                            previous=null;
                            if(timer.ElapsedMilliseconds>=100)break;
                        }
                    } catch(InvalidOperationException) { previous=null; }
                    Pause(25);
                }
                TraceFocus("Reacquiring " + label + " after a focus/layout change",target.Editor);
            }
            wait.Done("failed");
            throw new InvalidOperationException("COSTAR did not keep focus in " + label + " after selecting and refocusing its note row.");
            } finally {wait.End();}
        }
        void ReadMemoEquals(string prefix,string code,string expected) {
            var wait=Diag.Wait("memo_readback");
            try {
            var timer=Stopwatch.StartNew();
            while(timer.ElapsedMilliseconds<3000) {
                wait.Tick();Ready(); var snapshot=GridCurrent();
                try {
                    var live=Selectors.FindMemo(snapshot,prefix,code);
                    if(live!=null && live.Editor.Value==expected) {wait.Done("ok");return;}
                } catch(InvalidOperationException) { /* Wait for the validated editor to reappear. */ }
                Pause(25);
            }
            wait.Done("timeout");
            throw new InvalidOperationException(prefix + " note did not retain the expected value after COSTAR validation.");
            } finally {wait.End();}
        }
        void Memo(string prefix,string value,string code,bool allowCreate=true) {
            Ready(); var existing=Selectors.FindMemo(GridCurrent(),prefix,code); long createdRow=0;
            if(existing==null) {
                Order.Require(allowCreate,"DET did not provide the " + prefix + " note.");
                createdRow=AddCode(code,true);
            }
            Func<MemoTarget> locate=delegate { return ResolveMemo(prefix,code,createdRow); };
            string expected=Order.EntryText(prefix+":"+(String.IsNullOrWhiteSpace(value)?"":" "+value));
            var first=existing??locate();
            if(first.Editor.Value!=expected) {
                Say("Preparing " + prefix + " note.");
                var target=FocusMemo(locate,prefix + " note",first);
                WriteFocused(target.Editor,expected,prefix + " note",true);
                Ready();
            }
            ReadMemoEquals(prefix,code,expected);
        }
        void Verify(List<ControlInfo> s) {
            var h=Selectors.Header(s); var c=order.customer;
            Order.Require(CustomerEntry.SameIdentity(h.Account.Value,h.Name.Value,h.Phone.Value,verifiedCustomerAccount,verifiedCustomerName,c.phone),"The customer account/name/phone changed after lookup. Check the Repair Order before saving.");
            var checks=new[]{new{Actual=h.Address.Value,Expected=c.streetAddress,Label="address"},
                new{Actual=h.Suburb.Value,Expected=c.suburb,Label="suburb"},new{Actual=h.Postcode.Value,Expected=c.postcode,Label="postcode"},
                new{Actual=h.PO.Value,Expected=order.orderId,Label="PO#"},new{Actual=h.Comment.Value,Expected=order.comment,Label="comment"}};
            foreach(var check in checks) if(!String.IsNullOrWhiteSpace(check.Expected)) Order.Require(Order.Norm(check.Actual)==Order.Norm(check.Expected),"Final check failed: " + check.Label + ".");
            if(!String.IsNullOrWhiteSpace(c.email))Order.Require(Order.Clean(h.Email.Value)==Order.Clean(FieldText(c.email,true)),"Final email check failed: the supplied address must be retained in lowercase.");
            if(!String.IsNullOrWhiteSpace(c.streetAddress))Order.Require(Order.Norm(h.Address2.Value)==Order.Norm(c.address2),"Final billing address line 2 check failed.");
            if(!String.IsNullOrWhiteSpace(c.state))Order.Require(Order.Norm(h.State.Value)==Order.Norm(c.state),"Final billing state check failed.");
            Order.Require(Order.Phone(h.Phone.Value)==Order.Phone(c.phone),"Final phone check failed.");
            if(!order.IsDelivery) {
                try {
                    var timeIn=Selectors.TimeIn(s);string booked=Order.TimeInText(order.pickupTime);
                    if(timeIn!=null && booked!=null && Order.ClockMinutes(timeIn.Value)!=Order.ClockMinutes(booked)) Say("Note: Time in shows "+timeIn.Value+", booking time is "+booked+".");
                } catch(InvalidOperationException) { }
            }
            var g=Selectors.ProductGrid(s);
            var noteCodes=order.IsDelivery?new[]{"DET","M","M FB","M ODO","M PC","M C","F"}:new[]{"DET","M","M FB","M ODO","M PC"};
            var steps=order.ItemSteps(fitting);
            var expectedLines=steps.Where(step=>step.Line!=null).Select(step=>step.Line).ToList();
            var enteredItems=g.Rows.Where(r=>r.Value.Length>0 && (Order.Norm(r.Value)=="M FB" || !noteCodes.Contains(Order.Norm(r.Value)))).ToList();
            Order.Require(enteredItems.Select(r=>Order.Norm(r.Value)).SequenceEqual(steps.Select(step=>step.Code)),"Final item order must be wheels, tyres, fitting/balancing, then alignment.");
            if(!order.IsDelivery) {
                var dets=g.Rows.Where(r=>Order.Norm(r.Value)=="DET").ToList();
                Order.Require(dets.Count==1,"Final check failed: the order must have exactly one DET line.");
                int detAt=g.LineOf(dets[0].Handle);
                if(enteredItems.Any(r=>g.LineOf(r.Handle)>detAt)) Say("Note: some items are below DET (this order was started by an older helper).");
            }
            var paid=g.Rows.Where(r=>r.Value.Length>0 && !noteCodes.Contains(Order.Norm(r.Value))).ToList();
            Order.Require(paid.Count==expectedLines.Count,"Unexpected number of product/service rows after entry.");
            for(int i=0;i<paid.Count;i++) {
                var line=expectedLines[i]; var r=paid[i];
                int expectedPrice=line.unitCents;
                if(line.kind=="package") Order.Require(packagePrices.TryGetValue(order.lines.IndexOf(line),out expectedPrice),"The package item's retained price was not recorded.");
                Order.Require(Order.Norm(r.Value)==line.code && Selectors.Cell(s,r,g.Quantity).Value==line.quantity.ToString(CultureInfo.InvariantCulture) && Selectors.Cents(Selectors.Cell(s,r,g.Net))==expectedPrice,"Final check failed on item " + line.code + ".");
            }
            var descriptions=g.Rows.Where(r=>r.Value.Length>0).Select(r=>Selectors.Cell(s,r,g.Description).Value).ToList();
            if(order.IsDelivery) {
                var d=Selectors.Delivery(s);var expected=order.shipping;
                var deliveryChecks=new[]{new{Actual=d.Name.Value,Expected=expected.name,Label="delivery recipient"},new{Actual=d.Address.Value,Expected=expected.streetAddress,Label="delivery street"},
                    new{Actual=d.Address2.Value,Expected=expected.address2,Label="delivery address line 2"},new{Actual=d.Suburb.Value,Expected=expected.suburb,Label="delivery suburb"},
                    new{Actual=d.State.Value,Expected=expected.state,Label="delivery state"},new{Actual=d.Postcode.Value,Expected=expected.postcode,Label="delivery postcode"},
                    new{Actual=d.Contact.Value,Expected=expected.contact,Label="delivery contact"},
                    new{Actual=d.ShipVia.Value,Expected=expected.shipVia,Label="Ship Via"},new{Actual=d.Instructions.Value,Expected=expected.instructions,Label="shipping instructions"},
                    new{Actual=h.State.Value,Expected=c.state,Label="billing state"},new{Actual=h.Address2.Value,Expected=c.address2,Label="billing address line 2"}};
                foreach(var check in deliveryChecks) Order.Require(Order.Norm(check.Actual)==Order.Norm(check.Expected),"Final check failed: " + check.Label + ".");
                Order.Require(Order.Clean(d.Email.Value)==Order.Clean(FieldText(expected.email,true)),"Final delivery email check failed: the address must be retained in lowercase.");
                Order.Require(Order.Phone(d.BusinessPhone.Value)==Order.Phone(expected.businessPhone) && Order.Phone(d.MobilePhone.Value)==Order.Phone(expected.mobilePhone),"Final delivery phone check failed.");
                var freight=g.Rows.Where(r=>Order.Norm(r.Value)=="F").ToList();
                Order.Require(freight.Count==(order.freightCents>0?1:0),"Unexpected number of freight rows.");
                if(freight.Count==1) Order.Require(Selectors.Cell(s,freight[0],g.Quantity).Value=="1" && Selectors.Cents(Selectors.Cell(s,freight[0],g.Net))==order.freightCents,"Final freight check failed.");
                string vehicleNote="TO SUIT:"+(order.DeliveryVehicleNote.Length==0?"":" "+order.DeliveryVehicleNote);
                Order.Require(descriptions.Count(value=>Order.Norm(value)==Order.Norm(vehicleNote))==1,"Final delivery vehicle note check failed.");
                Order.Require(!g.Rows.Any(r=>new[]{"DET","M FB","M ODO"}.Contains(Order.Norm(r.Value))),"An unexpected pickup note was added to the delivery order.");
            } else {
                foreach(var expected in new[]{"MAKE/MODEL:"+(String.IsNullOrWhiteSpace(order.vehicle)?"":" "+order.vehicle),"REGO NO:"+(String.IsNullOrWhiteSpace(order.rego)?"":" "+order.rego),"ODOMETER:"}) {
                    var notes=g.Rows.Where(r=>r.Value.Length>0 && Order.Norm(Selectors.Cell(s,r,g.Description).Value)==Order.Norm(expected)).ToList();
                    Order.Require(notes.Count==1 && notes[0].Y>enteredItems.Max(r=>r.Y),"Final note content/order check failed: " + expected.Split(':')[0]);
                }
            }
            if(payment.Length>0) Order.Require(descriptions.Count(d=>Order.Norm(d)=="PAYING BY: "+Order.Norm(payment))==1,"Final payment note check failed.");
            // Only the exact automatic surcharge may be absent from an otherwise
            // complete order total. The package exception remains separate.
            if(!order.requiresReview) Order.Require(order.MatchesCostarTotal(Selectors.Total(s)),"COSTAR total does not match the online amount before or after its automatic card surcharge. Check the order manually; no save was attempted.");
        }
        internal void Run() {
            try {
                Diag.Kind=order.IsDelivery?"online-delivery":"online-pickup";
                order.Validate(true); Order.Safe(payment,"payment note",60);
                runClock.Restart();
                Diag.BeginStage(FreshlyOpened?"Startup: wait for new Repair Order":"Startup: verify empty Repair Order");
                List<ControlInfo> initial;
                if(FreshlyOpened) {
                    // A visible title is not proof that the new form's fields have loaded.
                    enteringCustomer=false;Activate();initial=WaitForMobileStartup();enteringCustomer=true;
                } else {enteringCustomer=true;ActivateAndWait();initial=Settled(Current());}
                Dump("before-controls",initial);Diag.Layout(initial);
                // A stopped earlier attempt of this same order (PO# = order number, same phone):
                // continue in it instead of opening another Repair Order.
                bool resuming=!FreshlyOpened && Selectors.SameOrderInProgress(initial,order);
                if(resuming) {
                    Diag.EventRaw("resume_order","PO# and phone match this order; continuing where the earlier attempt stopped");
                    Say("This Repair Order already holds "+order.orderId+" from an earlier attempt. Continuing where it stopped.");
                } else if(Selectors.SameCustomerStart(initial,order)) {
                    Diag.EventRaw("same_customer_start","Repair Order already holds this order's phone with no items");
                    Say("This Repair Order already holds this order's customer and no items. Re-checking the customer, then comparing and updating the details.");
                } else {
                    try {
                        Selectors.Blank(initial,branch);
                        if(order.IsDelivery) Selectors.BlankDelivery(initial,branch);
                    } catch(InvalidOperationException busy) {
                        // Nothing has been typed yet. An order opened by the helper itself is
                        // always new, so only a reused, already-open order can be "in use".
                        if(writes==0 && !FreshlyOpened) throw new RepairOrderInUseException(busy.Message);
                        throw;
                    }
                    Say("Verified an empty Repair Order. Looking up the customer's phone first.");
                }
                Diag.EndStage(true);
                bool existing=false;
                if(resuming) Timed("Resume: customer already looked up",delegate {
                    var current=HeaderNow();lookupPhone=order.customer.phone;
                    verifiedCustomerAccount=current.Account.Value;existing=Order.Clean(current.Account.Value).Length>0;
                    if(existing)verifiedCustomerName=current.Name.Value;
                    Say(existing?"Customer account already on the order; keeping it.":"No customer account on the order; checking the entered details.");
                });
                else Timed("Customer phone lookup",delegate {
                    var h=Selectors.Header(initial);lookupPhone=order.customer.phone;Put(h.Phone,order.customer.phone,"customer phone",true);
                    existing=LookupCustomer();var matched=HeaderNow();
                    verifiedCustomerAccount=matched.Account.Value;
                    if(existing)verifiedCustomerName=matched.Name.Value;
                    Say(existing?"Matched phone; retaining COSTAR's account and customer name.":"No matching customer; entering the order's customer details.");
                });
                Timed("Customer and order header",delegate {
                    FillOnlineHeader(existing);
                    if(order.IsDelivery)FillDelivery();
                    CustomerFormReady(0);
                    var confirmed=HeaderNow();
                    Order.Require(CustomerEntry.SameIdentity(confirmed.Account.Value,confirmed.Name.Value,confirmed.Phone.Value,verifiedCustomerAccount,verifiedCustomerName,order.customer.phone),"The selected customer account/name/phone changed during entry.");
                });
                enteringCustomer=false;
                var itemSteps=order.ItemSteps(fitting);
                // Pickups (2.3.0): DET and its notes go in first on line 6 (lower for a long order),
                // then the items fill the lines above it from line 1. Deliveries have no DET and
                // keep their order: items, freight, then the notes.
                int detLine=0;
                if(!order.IsDelivery) {
                    long existingDet=resuming?ExistingRow("DET",0):0;
                    detLine=existingDet!=0?Selectors.ProductGrid(GridCurrent()).LineOf(existingDet):Order.DetLine(itemSteps.Count);
                    Order.Require(detLine>0,"DET's line could not be found. Entry stopped; check the order.");
                    Diag.SetEnv("detLine",detLine.ToString(CultureInfo.InvariantCulture));
                    Timed("Details first (DET block)",delegate {
                        if(existingDet!=0) {
                            Say("DET was already entered on line "+detLine+".");
                            // Stopped before DET's notes appeared: they appear once DET's description loses focus.
                            if(Selectors.FindMemo(GridCurrent(),"MAKE/MODEL","M")==null && !LeaveForDetNotes()) LeaveGrid("after DET");
                        }
                        else AddCode("DET",false,commitOutsideGrid:true,line:detLine);
                        WaitForDetailsTemplate();
                        RequireNotesUnderDet(detLine);
                        Memo("MAKE/MODEL",order.vehicle,"M",false);
                        Memo("REGO NO",order.rego,"M",false);
                        Memo("ODOMETER","","M ODO",false);
                        if(payment.Length>0)Memo("PAYING BY",payment,"M PC");
                    });
                }
                var occurrences=new Dictionary<string,int>(StringComparer.Ordinal);
                foreach(var step in itemSteps) {
                    string code=Order.Norm(step.Code);int nth;occurrences.TryGetValue(code,out nth);occurrences[code]=nth+1;
                    long already=resuming?ExistingRow(code,nth):0;
                    Timed("Item "+step.Code,delegate {
                        if(already!=0) {
                            if(step.Line!=null)FinishLine(step.Line,already);
                            Say("Item "+step.Code+" was already entered; checked it.");
                        }
                        else if(step.Line!=null)AddLine(step.Line,detLine);else AddCode(step.Code,false,above:detLine);
                    });
                }
                if(order.IsDelivery) Timed("Details and freight",delegate {
                    long freight=resuming&&order.freightCents>0?ExistingRow("F",0):0;
                    if(freight!=0)FinishFreight(freight);else AddFreight();
                    Memo("TO SUIT",order.DeliveryVehicleNote,"M C");
                    if(payment.Length>0)Memo("PAYING BY",payment,"M PC");
                });
                if(!order.IsDelivery) Timed("Ship Via SHOP",delegate { SetShipViaShop(); });
                Diag.BeginStage("Final verification and report");Ready();var final=Current();Verify(final);Dump("after-controls",final);
                int actualTotal=Selectors.Total(final);
                File.WriteAllText(Path.Combine(Folder,"review.json"),json.Serialize(new{OrderId=order.orderId,ManualCompletionRequired=order.requiresReview,OnlineTotalCents=order.totalCents,CostarTotalCents=actualTotal,DifferenceCents=order.totalCents-actualTotal,
                    CustomerEntryMode="Phone first; retain COSTAR account/name; update supplied address",CustomerPopupRecoveryActions=recoveryActions,CustomerLookupCancelled=lookupCancelled,
                    OnlineCardSurchargeCents=order.surchargeCents,OnlineTotalBeforeSurchargeCents=order.TotalBeforeSurchargeCents,CardSurchargeHandledBy="COSTAR",
                    TotalCheck=order.requiresReview?"Package requires manual completion":(actualTotal==order.totalCents?"Online total matched":"Total before automatic card surcharge matched"),
                    IncompletePackages=order.lines.Where(l=>l.kind=="package").Select(l=>new{l.code,l.description,l.quantity,OnlinePackageTotalCents=l.totalCents}).ToArray()}),new UTF8Encoding(false));
                if(order.surchargeCents>0) Say("Website card surcharge $"+(order.surchargeCents/100m).ToString("0.00",CultureInfo.InvariantCulture)+" is handled by COSTAR. No surcharge item was entered. Website total $"+(order.totalCents/100m).ToString("0.00",CultureInfo.InvariantCulture)+"; current COSTAR total $"+(actualTotal/100m).ToString("0.00",CultureInfo.InvariantCulture)+".");
                if(order.requiresReview) Say("MANUAL COMPLETION REQUIRED - " + order.orderId + ": add missing package tyres and review wheel quantity/pricing. COSTAR $"+(actualTotal/100m).ToString("0.00",CultureInfo.InvariantCulture)+"; online $"+(order.totalCents/100m).ToString("0.00",CultureInfo.InvariantCulture)+". Repair Order left open.");
                else Say("READY FOR REVIEW - " + order.orderId + " - total $" + (actualTotal/100m).ToString("0.00",CultureInfo.InvariantCulture) + (order.surchargeCents>0 && actualTotal==order.TotalBeforeSurchargeCents?" before COSTAR's automatic card surcharge":"") + ". Repair Order left open.");
                Diag.EndStage(true);Diag.Completed();
            } catch(Exception error) {
                Diag.Stopped(error);TraceFocus("Stopped run",null);
                Say("STOPPED: " + error.Message);
                try { if(!process.HasExited && Native.IsWindow(root)) { bool saved=Cancel; Cancel=false; try { CaptureForegroundWindow(error.Message); Dump("stopped-controls",Snapshot(root)); } finally { Cancel=saved; } } } catch { }
                throw;
            } finally { log.Flush(); }
        }
        public void Dispose() {
            if(fastTimer){Native.timeEndPeriod(1);fastTimer=false;}
            try {File.WriteAllText(Path.Combine(Folder,"timing.json"),json.Serialize(new {Version=AutofillForm.Version,ElapsedMilliseconds=runClock.ElapsedMilliseconds,Writes=writes,SnapshotCount=snapshotCount,GridSnapshotCount=gridSnapshotCount,ControlTextReads=controlTextReads,SkippedQuantities=skippedQuantities,SnapshotMilliseconds=snapshotMilliseconds,Stages=timings}),new UTF8Encoding(false));}catch{}
            try {Diag.Reads(skippedReads,lateReads,headerReads,headerHits);Diag.Finish(runClock.ElapsedMilliseconds,writes,snapshotCount,gridSnapshotCount,controlTextReads,skippedQuantities,snapshotMilliseconds);Diag.Save(Folder);}catch{}
            log.Dispose(); process.Dispose();
            try { ZipPath=Folder+".zip"; ZipFile.CreateFromDirectory(Folder,ZipPath,CompressionLevel.Fastest,false); } catch { ZipPath=Folder; }
            // The ZIP holds the complete report; keep a single copy of customer details.
            if(ZipPath!=Folder) { try { Directory.Delete(Folder,true); } catch { } }
            ReportRetention.Prune();
            classCache.Clear();headerCache=null;gridLabels=null;
            Memory.Trim();
            if(busySnapshots>0) Diag.EventRaw("costar_busy_skips",busySnapshots+" snapshots, "+busySkips+" field reads not sent while COSTAR was busy");
            PerfMonitor.AfterJob(Diag==null?"":Diag.RunId);
        }
    }

    public sealed class AutofillForm : Form {
        const string Prefix="TEMPE_COSTAR_ORDER_V1\n";
        readonly JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=200000 };
        
        readonly TextBox preview=new TextBox { Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Width=725,Height=215 };
        readonly TextBox payment=new TextBox { Width=155,MaxLength=60 };
        readonly CheckBox fitting=new CheckBox { Text="Include fitting / balancing / disposal note",Checked=true,AutoSize=true };
        readonly CheckBox receive=new CheckBox { Text="Auto-load copied orders (this tab only)",Checked=false,AutoSize=true };
        readonly CheckBox autoFill=new CheckBox { Text="Fill automatically",Checked=false,AutoSize=true };
        readonly OrderQueue queue=new OrderQueue();
        readonly Button fill=new Button { Text="Fill Repair Order",Width=230,Height=36,Enabled=false };
        readonly Button stop=new Button { Text="Stop",Width=100,Height=36,Enabled=false };
        
        readonly Button load=new Button { Text="Load copied order",Width=155 };
        readonly TextBox status=new TextBox { Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Width=725,Height=150 };
        readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer { Interval=1000 };
        readonly BoundedLog messages=new BoundedLog();
        readonly EntryCoordinator coordinator;
        Order order;volatile Runner runner;volatile bool stopRequested;uint clipboardSequence;bool busy,activeTab,queuePaused;string lastReport,currentId;DateTime shownAt;
        // The Repair Order the last successful fill used (left open for review).
        volatile IntPtr lastFilledWindow;
        // Orders that stopped after typing something, and the Repair Order they were in: a
        // retry goes back there and continues instead of starting another Repair Order.
        readonly Dictionary<string,IntPtr> stoppedIn=new Dictionary<string,IntPtr>(StringComparer.OrdinalIgnoreCase);
        internal bool Busy {get{return busy;}}
        // Set by the worker window: finds and selects a COSTAR if none is chosen.
        internal Func<bool> EnsureTarget;
        internal void StopEntry(){if(busy)AppLog.Note("stop_pressed","online "+currentId);stopRequested=true;var active=runner;if(active!=null)active.Cancel=true;}
        internal void SetActive(bool active){activeTab=active;UpdateReceiving();}
        void UpdateReceiving(){timer.Enabled=activeTab&&receive.Checked&&(!busy||autoFill.Checked);}
        internal void FlushLog(){messages.Flush(status);}
        Form Host {get{return Parent==null?this:Parent.FindForm();}}
        // Online pickups name their store ("Tempe NSW"). Before anything is typed, that store must
        // belong to the selected COSTAR's branch, or a person confirms (remembered for this session
        // per store and branch). Deliveries and orders from older pages (no store) are not checked.
        readonly HashSet<string> confirmedStores=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        // True while that question is open. A WinForms timer still ticks under a message box, so
        // nothing is loaded from the clipboard and no entry starts until it is answered.
        bool askingBranch;
        void CheckStoreBranch(Order o,CostarInstance target) {
            if(o==null || o.IsDelivery || String.IsNullOrWhiteSpace(o.store) || target==null) return;
            if(Branches.StoreMatches(o.store,target.BranchName)) return;
            string key=Order.Norm(o.store)+"|"+target.Branch.ToString(CultureInfo.InvariantCulture);
            if(confirmedStores.Contains(key)) return;
            CostarInstance other=null;
            try { other=CostarWindows.Choices().FirstOrDefault(c=>!c.Same(target) && !OrderCheckLink.IsWipWindow(c) && Branches.StoreMatches(o.store,c.BranchName)); }
            catch(Exception) { other=null; }
            string store=Order.Clean(o.store);
            string text=o.orderId+" is a pickup at "+store+", but the selected COSTAR is "+target.Label+"."+
                (other!=null?"\r\n\r\n"+other.Label+" is also open: choose it in the list at the top to enter the order there.":"")+
                "\r\n\r\nEnter it into "+target.Label+" anyway?";
            // After an earlier order the helper may be minimised: bring it back so the question is seen.
            Form owner=Host;
            if(owner==null) owner=this;
            try { if(owner.WindowState==FormWindowState.Minimized) owner.WindowState=FormWindowState.Normal; owner.Activate(); } catch(Exception) { }
            AppLog.Note("online_branch_question",o.orderId+" store="+store+" branch="+target.Branch);
            DialogResult answer;
            askingBranch=true;
            try { answer=MessageBox.Show(owner,text,"Check the branch",MessageBoxButtons.YesNo,MessageBoxIcon.Warning,MessageBoxDefaultButton.Button2); }
            finally { askingBranch=false; }
            if(answer!=DialogResult.Yes) {
                AppLog.Note("online_branch_refused",o.orderId+" store="+store+" branch="+target.Branch);
                throw new InvalidOperationException("Not entered: "+o.orderId+" is a "+store+" pickup and the selected COSTAR is "+target.Label+". Choose the right COSTAR at the top, then click Fill.");
            }
            confirmedStores.Add(key);
            AppLog.Note("online_branch_confirmed",o.orderId+" store="+store+" branch="+target.Branch);
        }
        internal const string Version="2.3.0 - any branch";
        internal AutofillForm(EntryCoordinator entries) {
            coordinator=entries;
            Text="COSTAR Autofill - " + Version; ClientSize=new Size(765,705); StartPosition=FormStartPosition.CenterScreen; Font=new Font("Segoe UI",10F);
            var layout=new FlowLayoutPanel { Dock=DockStyle.Fill,Padding=new Padding(14),FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoScroll=true };
            Controls.Add(layout);
            layout.Controls.Add(new Label { Text="Fill opens a fresh Repair Order in the selected COSTAR's branch. Earlier orders left open for review are not touched.",AutoSize=true });
            var transfer=new FlowLayoutPanel { Width=730,Height=36 };transfer.Controls.Add(load);transfer.Controls.Add(receive);transfer.Controls.Add(autoFill);layout.Controls.Add(transfer);
            layout.Controls.Add(preview);
            layout.Controls.Add(new Label {Text="Phone first · keep COSTAR account/name · update supplied address",AutoSize=true});
            var options=new FlowLayoutPanel { Width=730,Height=35 };options.Controls.Add(new Label { Text="Paying by (optional):",AutoSize=true,Padding=new Padding(0,5,0,0) });options.Controls.Add(payment); options.Controls.Add(fitting);layout.Controls.Add(options);
            var actions=new FlowLayoutPanel { Width=730,Height=44 };actions.Controls.Add(fill);actions.Controls.Add(stop);
            var reports=new Button { Text="Open reports folder",Width=180,Height=36 };actions.Controls.Add(reports);layout.Controls.Add(actions);
            layout.Controls.Add(new Label { Text="During entry: leave COSTAR in front. Stop shortcut: Ctrl + Alt + F10.",AutoSize=true });
            layout.Controls.Add(status);
            load.Click+=delegate { LoadClipboard(true); };
            fill.Click+=delegate { StartEntry(); };stop.Click+=delegate { StopEntry(); };
            reports.Click+=delegate { Directory.CreateDirectory(Runner.ReportsRoot);Process.Start("explorer.exe",Runner.ReportsRoot); };
            receive.CheckedChanged+=delegate{clipboardSequence=Native.GetClipboardSequenceNumber();if(!receive.Checked&&autoFill.Checked)autoFill.Checked=false;UpdateReceiving();};
            autoFill.CheckedChanged+=delegate{
                if(autoFill.Checked){if(!receive.Checked)receive.Checked=true;queuePaused=false;Append("Fill automatically is on: each order you send with Send to COSTAR is entered straight away, one at a time, in its own new Repair Order. The same order is never entered twice.");}
                UpdateReceiving();FlushLog();
            };
            timer.Tick+=delegate { ClipboardTick(); };
            FormClosing+=delegate(object sender,FormClosingEventArgs e) { if(busy) { StopEntry(); e.Cancel=true; Append("Stopping entry. Close the helper again after it stops."); } };
            Shown+=delegate {Append("Send an order from your website, click Load copied order, then Fill Repair Order. Or tick Fill automatically and just click Send to COSTAR.");};
        }
        protected override void Dispose(bool disposing){if(disposing)timer.Dispose();base.Dispose(disposing);}
        void Append(string text) {messages.Add(text);}
        // Reads one order from the clipboard; null if it holds no valid COSTAR order.
        Order ParseClipboard(bool manual) {
            clipboardSequence=Native.GetClipboardSequenceNumber();
            string copied=OrderClipboard.Read(Handle);
            if(copied==null) { if(manual) Append("No order text found. Click Send to COSTAR in the HTML helper.");return null; }
            string text=copied.Replace("\r\n","\n");
            if(!text.StartsWith(Prefix,StringComparison.Ordinal)) { if(manual) Append("Clipboard does not contain a COSTAR order. Use the new Send to COSTAR button."); return null; }
            Order.Require(text.Length<=200000,"The order is too large.");
            var candidate=json.Deserialize<Order>(text.Substring(Prefix.Length)); Order.Require(candidate!=null,"Invalid order data."); candidate.Validate(true);
            return candidate;
        }
        void ShowOrder(Order loaded) {
            order=loaded;shownAt=DateTime.Now; var b=new StringBuilder();
                b.AppendLine(order.orderId+"  |  "+order.customer.name+"  |  $"+(order.totalCents/100m).ToString("0.00",CultureInfo.InvariantCulture));
                b.AppendLine(order.customer.phone+"  "+order.customer.email);
                b.AppendLine("Billing: "+order.customer.streetAddress+" "+order.customer.address2+", "+order.customer.suburb+" "+order.customer.state+" "+order.customer.postcode);
                fitting.Enabled=!order.IsDelivery;
                fitting.Text=order.IsDelivery?"In-store fitting note is not used for delivery orders":"Include fitting / balancing / disposal note";
                if(order.IsDelivery) {
                    var d=order.shipping;
                    b.AppendLine(order.deliveryMethod+" | Dispatch: "+order.deliveringBranch+" | Ship Via: "+d.shipVia);
                    b.AppendLine("Deliver to: "+d.name+", "+d.streetAddress+" "+d.address2+", "+d.suburb+" "+d.state+" "+d.postcode);
                    b.AppendLine("Contact: "+d.contact+" "+d.businessPhone+" | "+d.instructions);
                    b.AppendLine("Freight: $"+(order.freightCents/100m).ToString("0.00",CultureInfo.InvariantCulture)+" | Payment method: "+order.paymentMethod);
                    if(order.requiresReview) b.AppendLine("MANUAL COMPLETION: missing package tyres/quantities/pricing. COSTAR's item price will be kept; online package price will not be assigned to one wheel.");
                    b.AppendLine("Rego: "+order.rego);
                } else b.AppendLine("Pickup: "+order.pickupDate+" "+order.pickupTime+(String.IsNullOrWhiteSpace(order.store)?"":"  |  Store: "+order.store)+"  |  Rego: "+(String.IsNullOrWhiteSpace(order.rego)?"(not supplied)":order.rego));
                if(order.surchargeCents>0) b.AppendLine("Card surcharge: $"+(order.surchargeCents/100m).ToString("0.00",CultureInfo.InvariantCulture)+" handled automatically by COSTAR. Amount before surcharge: $"+(order.TotalBeforeSurchargeCents/100m).ToString("0.00",CultureInfo.InvariantCulture)+". No surcharge item will be added.");
                b.AppendLine("Vehicle: "+order.vehicle); b.AppendLine("Comment: "+order.comment); b.AppendLine();
                foreach(var l in order.ItemSteps(false).Select(step=>step.Line)) b.AppendLine(l.code+"  x"+l.quantity+(l.kind=="package"?"  ONLINE PACKAGE $":"  @ $")+(l.unitCents/100m).ToString("0.00",CultureInfo.InvariantCulture)+"  "+l.description);
                preview.Text=b.ToString();fill.Enabled=!busy;
        }
        // True when a new order was loaded and shown.
        bool LoadClipboard(bool manual) {
            if(busy) return false;
            try {
                var candidate=ParseClipboard(manual);
                if(candidate==null) return false;
                ShowOrder(candidate);
                AppLog.Note("online_loaded",candidate.orderId+(candidate.IsDelivery?" delivery":" pickup")+" lines="+(candidate.lines==null?0:candidate.lines.Count)+(manual?" manual":" auto")+(candidate.requiresReview?" package-review":""));
                if(queue.WasEntered(candidate.orderId)) Append("Received "+candidate.orderId+". It was already entered in this session: click Fill only if you really want a second copy.");
                else Append("Received "+candidate.orderId+". Click Fill Repair Order; a new Repair Order is opened for you.");
                return true;
            } catch(System.Runtime.InteropServices.ExternalException) { Append("Clipboard is busy. Click Load copied order again."); }
            catch(Exception e) { order=null;fill.Enabled=!busy&&queue.Count>0;preview.Clear();Append("Order was not loaded: "+e.Message);AppLog.Note("online_load_failed",e.Message); }
            finally{FlushLog();}
            return false;
        }
        // While an order is being entered, or after a stop, newly copied orders wait in line.
        void QueueFromClipboard() {
            try {
                var candidate=ParseClipboard(false);
                if(candidate==null) return;
                string result=queue.Add(candidate,currentId);
                AppLog.Note("online_queue_"+result,candidate.orderId+" waiting="+queue.Count);
                if(result=="queued") Append("Queued "+candidate.orderId+" ("+queue.Count+" waiting).");
                else if(result=="duplicate") Append(candidate.orderId+" is already waiting or being entered; not added twice.");
                else Append(candidate.orderId+" was already entered in this session; not added again.");
                if(!busy) fill.Enabled=order!=null||queue.Count>0;
            } catch(System.Runtime.InteropServices.ExternalException) { /* Clipboard busy; a later copy is picked up next time. */ }
            catch(Exception e) { Append("Copied order was not queued: "+e.Message);AppLog.Note("online_load_failed",e.Message); }
            finally{FlushLog();}
        }
        void ClipboardTick() {
            if(!activeTab || !receive.Checked || askingBranch) return;
            bool changed=Native.GetClipboardSequenceNumber()!=clipboardSequence;
            if(busy) { if(changed && autoFill.Checked) QueueFromClipboard(); return; }
            if(autoFill.Checked && (queuePaused || queue.Count>0)) {
                if(changed) QueueFromClipboard();
                if(!queuePaused && order==null && queue.Count>0) StartEntry();
                return;
            }
            if(!changed) return;
            if(LoadClipboard(false) && autoFill.Checked && order!=null) {
                if(queue.WasEntered(order.orderId)) { Append("Not filling "+order.orderId+" automatically: it was already entered in this session.");AppLog.Note("online_refused",order.orderId+" already entered");FlushLog();return; }
                StartEntry();
            }
        }
        void SetBusy(bool value) { busy=value;fill.Enabled=!value&&(order!=null||queue.Count>0);stop.Enabled=value;load.Enabled=!value;payment.Enabled=!value;fitting.Enabled=!value&&(order==null||!order.IsDelivery);receive.Enabled=!value;UpdateReceiving(); }
        void StartEntry() {
            if(busy || askingBranch) return;
            if(order==null) { var next=queue.Next(); if(next==null) return; ShowOrder(next); }
            queuePaused=false;
            EntryLease entry=null;
            try {
                order.Validate(true);
                if(coordinator.Selected==null && EnsureTarget!=null) EnsureTarget();
                entry=coordinator.TryBegin("Online order",false);
                Order.Require(entry!=null,coordinator.Selected==null?"Select a COSTAR in the list above.":"Wait for the current mobile or online entry to finish.");
                var submitted=order;
                CheckStoreBranch(submitted,entry.Target);
                Order.Require(Object.ReferenceEquals(order,submitted),"The order on screen changed while the branch question was open. Nothing was entered; check it and click Fill again.");
                string pay=payment.Text;bool includeFitting=fitting.Checked;
                var lease=entry;stopRequested=false;lastReport=null;currentId=submitted.orderId;SetBusy(true);var host=Host;
                AppLog.Note("online_fill_start",submitted.orderId+(autoFill.Checked?" auto":" manual")+" waited "+(int)(DateTime.Now-shownAt).TotalSeconds+" s after loading, queue="+queue.Count);
                var fillClock=Stopwatch.StartNew();
                var thread=new Thread(delegate() {
                    bool success=false;string error=null;
                    try {
                        using(var input=new CostarInputLock()) {
                            string orderCheck;string already=OrderCheckLink.AlreadyInCostar(submitted.orderId,out orderCheck);
                            AppLog.Note(already!=null?"online_duplicate_blocked":"order_check",submitted.orderId+": "+orderCheck);
                            if(already!=null) throw new InvalidOperationException(already);
                            CostarWindows.Main(lease.Target);
                            // A single open order of the selected branch is tried first: it may be
                            // empty, or already hold this customer. If it holds another job, or several
                            // are open, a fresh one is opened with Add New; earlier ones stay as they are.
                            var open=CostarWindows.Orders(lease.Target);
                            IntPtr window=open.Count==1&&Branches.OrderTitle(Native.Caption(open[0]),lease.Target.Branch)?open[0]:IntPtr.Zero;
                            // 5 Oct: every order first tried the previous order's Repair Order
                            // (left open for review), found it full and only then opened a new one.
                            // The helper knows which order it filled last: go straight to Add New.
                            IntPtr earlier;
                            lock(stoppedIn) { if(!stoppedIn.TryGetValue(submitted.orderId,out earlier)) earlier=IntPtr.Zero; }
                            if(earlier!=IntPtr.Zero && open.Contains(earlier) && Branches.OrderTitle(Native.Caption(earlier),lease.Target.Branch)) {
                                window=earlier;Append("Going back to the Repair Order "+submitted.orderId+" was started in.");AppLog.Note("online_resume",submitted.orderId);
                            }
                            else if(window!=IntPtr.Zero && window==lastFilledWindow) { window=IntPtr.Zero; AppLog.Note("online_skip_review_ro",submitted.orderId); }
                            bool reopened=false;
                            while(true) {
                                long openMs=-1;
                                if(window==IntPtr.Zero) {
                                    Append(open.Count==0?"Opening a new Repair Order with Add New.":"Earlier Repair Orders stay open for review; opening a fresh one with Add New.");
                                    var openTimer=Stopwatch.StartNew();
                                    window=CostarWindows.OpenNew(lease.Target,delegate{},delegate{return stopRequested;},true);
                                    openMs=openTimer.ElapsedMilliseconds;AppLog.Note("online_add_new",submitted.orderId+" "+openMs+" ms, other orders open="+open.Count);
                                }
                                runner=new Runner(lease.Target.Pid,lease.Target.Branch,submitted,pay,includeFitting,Append,window.ToInt64());
                                runner.FreshlyOpened=openMs>=0;if(openMs>=0)runner.Diag.OpenNewMs=openMs;
                                runner.Cancel=stopRequested;
                                try { runner.Run();success=true;lastFilledWindow=window;lock(stoppedIn)stoppedIn.Remove(submitted.orderId);break; }
                                catch(RepairOrderInUseException) {
                                    if(reopened) throw;
                                    reopened=true;var used=runner;runner=null;used.Dispose();
                                    Append("The open Repair Order already holds another job; it is left untouched.");AppLog.Note("online_ro_in_use",submitted.orderId);
                                    window=IntPtr.Zero;open=CostarWindows.Orders(lease.Target);
                                }
                                catch(Exception) {
                                    if(runner!=null && runner.Writes>0) lock(stoppedIn) stoppedIn[submitted.orderId]=window;
                                    throw;
                                }
                            }
                        }
                    } catch(Exception e){error=e.Message;}
                    finally {
                        try {var active=runner;if(active!=null){active.Dispose();lastReport=active.ZipPath;}}
                        catch(Exception e){error="Report cleanup failed: "+e.Message;}
                        finally {runner=null;lease.Dispose();}
                    }
                    try {BeginInvoke(new Action(delegate {
                        SetBusy(false);currentId=null;
                        if(success) queue.Entered(submitted.orderId);
                        string runFile=lastReport==null?"":Path.GetFileNameWithoutExtension(lastReport);
                        AppLog.Note(success?"online_fill_ok":"online_fill_stopped",submitted.orderId+" in "+(fillClock.ElapsedMilliseconds/1000)+" s run="+runFile+(success?"":" "+error));
                        order=null;fill.Enabled=queue.Count>0;
                        Append(success?"Finished "+submitted.orderId+". Review it in COSTAR.":"Entry stopped: "+error);
                        if(success&&error!=null)Append(error);
                        if(lastReport!=null)Append("Report: "+lastReport);
                        if(success && autoFill.Checked && queue.Count>0) {
                            var next=queue.Next();ShowOrder(next);
                            Append("Next in line: "+next.orderId+(queue.Count>0?" ("+queue.Count+" more waiting).":"."));
                            FlushLog();StartEntry();return;
                        }
                        if(!success && queue.Count>0) {queuePaused=true;AppLog.Note("online_queue_paused",queue.Count+" waiting");Append("Automatic filling paused: "+queue.Count+" order(s) waiting. Check COSTAR, then click Fill Repair Order to continue with the next one.");}
                        if(!success && host!=null){host.WindowState=FormWindowState.Normal;host.Activate();}
                        FlushLog();
                    }));}catch(InvalidOperationException){}
                });
                thread.IsBackground=true;thread.SetApartmentState(ApartmentState.STA);
                if(host!=null)host.WindowState=FormWindowState.Minimized;
                thread.Start();
            } catch(Exception e) {
                if(entry!=null)entry.Dispose();SetBusy(false);currentId=null;var host=Host;if(host!=null)host.WindowState=FormWindowState.Normal;Append(e.Message);
                AppLog.Note("online_fill_refused",e.Message);
            }
        }
        public static void SelfTest() {
            Order.Require(Marshal.SizeOf(typeof(Native.Input))==(IntPtr.Size==8?40:28),"Unexpected Windows INPUT structure layout.");
            var searching=new ControlInfo { Class="WindowsForms10.STATIC.app.0.13965fa_r10_ad1",Visible=true,Enabled=true,TextState="read",Text="Searching..." };
            var lookupControls=new List<ControlInfo>{searching};
            Order.Require(Selectors.CustomerSearchInProgress(lookupControls) && !Selectors.CustomerNotFoundNotice(lookupControls),"The recorded Searching panel must be recognised separately from an acknowledgement.");
            searching.Visible=false;Order.Require(!Selectors.CustomerSearchInProgress(lookupControls),"A hidden search indicator must not keep the lookup waiting.");
            searching.Visible=true;searching.TextState="read-failed-or-timed-out";Order.Require(!Selectors.CustomerSearchInProgress(lookupControls),"Unreadable text must not be treated as a known search indicator.");
            searching.TextState="read";searching.Text="Customer Not found";
            lookupControls.Add(new ControlInfo { Class="Button",Visible=true,Enabled=true,TextState="read",Text="OK" });
            Order.Require(Selectors.CustomerNotFoundNotice(lookupControls) && !Selectors.CustomerSearchInProgress(lookupControls),"The known Customer Not found notice must be acknowledged.");
            lookupControls.Add(new ControlInfo { Class="Button",Visible=true,Enabled=true,TextState="read",Text="Cancel" });
            Order.Require(!Selectors.CustomerNotFoundNotice(lookupControls),"A dialog offering another decision must not be dismissed as an acknowledgement.");
            Order.Require(Selectors.CustomerCancelButton(lookupControls)==lookupControls[2],"Recovery must choose Cancel rather than an unknown OK action.");
            lookupControls.RemoveAt(2);searching.Text="Confirm customer deletion";
            Order.Require(!Selectors.CustomerNotFoundNotice(lookupControls),"An unfamiliar OK dialog must not be mistaken for Customer Not found.");
            Order.Require(Selectors.CustomerCancelButton(lookupControls)==null,"An unknown OK button must never be selected as Cancel.");
            lookupControls[1].Text="&Close";
            Order.Require(Selectors.CustomerCancelButton(lookupControls)==lookupControls[1],"The popup Close button must be recognised.");
            lookupControls[1].Enabled=false;Order.Require(Selectors.CustomerCancelButton(lookupControls)==null,"A disabled Close button must not be used.");
            lookupControls[1].Enabled=true;lookupControls[1].Text="Save";
            Order.Require(Selectors.CustomerCancelButton(lookupControls)==null,"A Save button must not be used to dismiss a popup.");
            var json=new JavaScriptSerializer();
            var sample=json.Deserialize<Order>("{\"schema\":1,\"createdUtc\":\"2026-09-26T00:00:00Z\",\"orderId\":\"TTW100\",\"customer\":{\"name\":\"TEST CUSTOMER\",\"phone\":\"0400000000\"},\"rego\":\"\",\"vehicle\":\"TEST VEHICLE\",\"pickupDate\":\"2026-09-26\",\"pickupTime\":\"10:30\",\"comment\":\"SATURDAY - ONLINE 10:30\",\"totalCents\":19000,\"lines\":[{\"kind\":\"product\",\"sourceSku\":\"TEST123\",\"code\":\"TEST123\",\"description\":\"TEST TYRE\",\"quantity\":1,\"unitCents\":14000,\"totalCents\":14000},{\"kind\":\"service\",\"sourceSku\":\"TEST123\",\"code\":\"WA\",\"description\":\"SERVICES: FRONT WHEEL ALIGNMENT\",\"quantity\":1,\"unitCents\":5000,\"totalCents\":5000}]}");
            sample.Validate(false); sample.lines[1].code="WAFR";
            bool rejected=false; try { sample.Validate(false); } catch(InvalidOperationException) { rejected=true; }
            Order.Require(rejected,"Service mapping self-test failed.");
            sample.lines[1].description=": SERVICES: FRONT AND REAR WHEEL ALIGNMENT";
            sample.Validate(false); sample.lines[1].code="WA";
            rejected=false; try { sample.Validate(false); } catch(InvalidOperationException) { rejected=true; }
            Order.Require(rejected,"Front and rear alignment must use WAFR, including an empty-SKU prefix.");
            sample.lines[1].description=": SERVICES: Front Wheel Alignment";
            sample.Validate(false); sample.lines[1].code="WAFR";
            rejected=false; try { sample.Validate(false); } catch(InvalidOperationException) { rejected=true; }
            Order.Require(rejected,"Front-only alignment must use WA, including an empty-SKU prefix.");
            sample.lines[1].code="WA"; sample.surchargeCents=95; sample.totalCents=19095; sample.Validate(false);
            Order.Require(sample.MatchesCostarTotal(19000) && sample.MatchesCostarTotal(19095) && !sample.MatchesCostarTotal(19001),"Pickup automatic-surcharge total check failed.");
            var rearAlignment=new OrderLine { kind="service",code="WAFR",description=": SERVICES: FRONT AND REAR WHEEL ALIGNMENT" };
            var wheel=new OrderLine { kind="product",code="WHEEL1",description="18x8.5 TEST WHEEL" };
            var secondWheel=new OrderLine { kind="product",code="WHEEL2",description="18x9.5 TEST WHEEL" };
            var tyre=new OrderLine { kind="product",code="TYRE1",description="TEST 275/65R17" };
            var secondTyre=new OrderLine { kind="product",code="TYRE2",description="TEST 35X12.5R17" };
            var sequence=new Order { schema=1,lines=new List<OrderLine>{rearAlignment,tyre,wheel,secondTyre,secondWheel} };
            Order.Require(sequence.ItemSteps(true).Select(step=>step.Code).SequenceEqual(new[]{"WHEEL1","WHEEL2","TYRE1","TYRE2","M FB","WAFR"}),"Pickup entry must put wheels and tyres before M FB, then alignment.");
            Order.Require(sequence.lines[0]==rearAlignment && sequence.ItemSteps(true)[0].Line==wheel,"Planning must preserve source lines and their original identities/prices.");
            Order.Require(sequence.ItemSteps(false).Select(step=>step.Code).SequenceEqual(new[]{"WHEEL1","WHEEL2","TYRE1","TYRE2","WAFR"}),"Turning off fitting must retain the product/alignment order.");
            sequence.lines[0]=sample.lines[1];
            Order.Require(sequence.ItemSteps(true).Last().Code=="WA","Front-only alignment must also follow M FB.");
            sequence.schema=2;sequence.type="delivery";
            Order.Require(sequence.ItemSteps(true).Select(step=>step.Code).SequenceEqual(new[]{"WHEEL1","WHEEL2","TYRE1","TYRE2","WA"}),"Delivery entry must not add the in-store M FB note.");
            sequence.schema=1;sequence.type=null;sequence.lines=new List<OrderLine>{rearAlignment};
            Order.Require(sequence.ItemSteps(true).Select(step=>step.Code).SequenceEqual(new[]{"WAFR"}),"Alignment-only orders must not invent a fitting note.");
            var delivery=new Order { schema=2,type="delivery",createdUtc="2026-09-28T00:00:00Z",orderId="TTW100",deliveryMethod="FITTING PARTNER",requiresReview=true,
                customer=new Customer { name="TEST CUSTOMER",phone="0400000000",streetAddress="1 TEST ROAD",suburb="TEST SUBURB",state="VIC",postcode="3150" },
                shipping=new Shipping { name="TEST PARTNER",streetAddress="2 TEST ROAD",suburb="TEST SUBURB",state="VIC",postcode="3169" },
                comment="DFE - PACKAGE REVIEW",freightCents=10000,totalCents=199500,
                lines=new List<OrderLine>{new OrderLine { kind="package",sourceSku="TEST123",code="TEST123",description="TEST WHEEL PACKAGE WITH TYRES",quantity=1,unitCents=189500,totalCents=189500 }} };
            delivery.Validate(false);delivery.requiresReview=false;delivery.comment="DFE";
            rejected=false;try { delivery.Validate(false); } catch(InvalidOperationException) { rejected=true; }
            Order.Require(rejected,"Incomplete package must require manual review.");
            delivery.orderId="TTW1730086"; delivery.deliveryMethod="WITHIN AUSTRALIA";
            delivery.lines=new List<OrderLine>{new OrderLine { kind="product",sourceSku="SM9188555",code="SM9188555",description="18X8.5 18X9.5 SIMMONS OM-1 HYPER DARK 5/120.65 P0",quantity=4,unitCents=35000,totalCents=140000 }};
            delivery.freightCents=12000; delivery.surchargeCents=760; delivery.totalCents=152760; delivery.Validate(false);
            Order.Require(delivery.MatchesCostarTotal(152000) && delivery.MatchesCostarTotal(152760),"Delivery total must allow COSTAR's automatic surcharge before or after application.");
            Order.Require(!delivery.MatchesCostarTotal(152001) && !delivery.MatchesCostarTotal(153520),"An unrelated difference or duplicate surcharge must not pass the total check.");
            delivery.totalCents=152761; rejected=false; try { delivery.Validate(false); } catch(InvalidOperationException) { rejected=true; }
            Order.Require(rejected,"Source total must still include the exact card surcharge.");
            delivery.totalCents=152760; delivery.surchargeCents=-760; rejected=false; try { delivery.Validate(false); } catch(InvalidOperationException) { rejected=true; }
            Order.Require(rejected,"Negative card surcharge must not pass validation.");
            delivery.surchargeCents=760; delivery.discountCents=100; delivery.totalCents=152660;
            rejected=false; try { delivery.Validate(false); } catch(InvalidOperationException) { rejected=true; }
            Order.Require(rejected,"Unmapped discounts must remain blocked.");
        }
    }
}
