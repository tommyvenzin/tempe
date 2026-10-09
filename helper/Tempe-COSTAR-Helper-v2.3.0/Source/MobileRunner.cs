using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

namespace TempeCostar {
    // line: the 1-based grid line the row is on (2.3.0; 0 in tests and older checkpoints).
    public sealed class MobileRow { public string code,description,quantity;public int line; }
    public sealed class MobileView { public string account,name,phone,reference;public List<MobileRow> rows=new List<MobileRow>(); }
    public sealed class MobileCheckpoint {
        public string submissionId;public int processId,sessionId,index,pending=-1,planVersion;public long window,processStart;
        // COSTAR branch of the job's Repair Order (2.3.0+; 0 in older jobs means Branch 11).
        public int branch;
        public bool opening;public MobileView verified;
    }
    // line: where an "add" or "det" step must put its row (0 = after the last row).
    internal sealed class MobileStep {internal string kind,code,value,label;internal int quantity,line;}
    internal static class MobileProof {
        // 3 (2.3.0): DET and its notes first on line 6, then the items on lines 1 down.
        internal const int PlanVersion=3;
        internal static bool Unstarted(MobileCheckpoint cp) {
            // This baseline is persisted before step zero. Every field write is
            // preceded by a pending-step checkpoint, so neither may be present.
            return cp!=null&&cp.planVersion==PlanVersion&&cp.index==0&&cp.pending==-1&&cp.verified==null&&
                !cp.opening&&cp.window!=0&&cp.processId>0&&cp.processStart>0&&cp.sessionId>=0&&!String.IsNullOrWhiteSpace(cp.submissionId);
        }
        internal static void PrepareCheckpoint(MobileCheckpoint cp) {
            if(cp.planVersion==0 && cp.index==0 && cp.pending<0)cp.planVersion=PlanVersion;
            // A job from an older plan that has not started any step has nothing to reinterpret.
            if(cp.planVersion>0 && cp.planVersion<PlanVersion && cp.index==0 && cp.pending<0 && (cp.verified==null || cp.verified.rows.Count==0))cp.planVersion=PlanVersion;
            Order.Require(cp.planVersion==PlanVersion,"This partial job was started with an older helper. Finish it manually or use that helper to resume it; its steps will not be reinterpreted by this update.");
        }
        internal static bool Same(MobileView a,MobileView b) {return a!=null && b!=null && Wire.Json(a)==Wire.Json(b);}
        static bool RowSame(MobileRow a,MobileRow b) {return Wire.Json(a)==Wire.Json(b);}
        internal static List<MobileStep> Plan(MobileJob j) {
            var steps=new List<MobileStep> {
                new MobileStep {kind="phone",value=j.customer.mobile,label="Mobile number and customer lookup"},
                new MobileStep {kind="name",value=j.customer.name.ToUpperInvariant(),label="Customer name"},
                new MobileStep {kind="reference",value=j.Reference,label="Job reference"}
            };
            // DET first on its line, with its notes (and the optional notes row) under it; then
            // the items on lines 1 down, above DET: wheels, tyres, M FB, alignment.
            var ordered=j.Ordered.ToList();
            int itemLines=ordered.Count+1+(j.alignment!=null?1:0);
            int detLine=Order.DetLine(itemLines);
            steps.Add(new MobileStep {kind="det",code="DET",line=detLine,label="Create DET details"});
            steps.Add(new MobileStep {kind="memo",code="M",value="MAKE/MODEL: "+j.vehicle.makeModel.ToUpperInvariant(),label="MAKE/MODEL"});
            steps.Add(new MobileStep {kind="memo",code="M",value="REGO NO: "+j.vehicle.registration.ToUpperInvariant(),label="REGO NO"});
            steps.Add(new MobileStep {kind="memo",code="M ODO",value="ODOMETER: "+j.vehicle.odometer.Value.ToString(CultureInfo.InvariantCulture),label="ODOMETER"});
            if(j.Notes.Length>0) {
                steps.Add(new MobileStep {kind="add",code="M",label="Add notes row"});
                steps.Add(new MobileStep {kind="notes",code="M",value=Order.EntryText(j.Notes),label="Additional notes"});
            }
            int itemLine=0;
            foreach(var p in ordered) {
                itemLine++;
                steps.Add(new MobileStep {kind="add",code=p.sku,line=itemLine,label="Add "+p.type+" "+p.sku});
                steps.Add(new MobileStep {kind="quantity",code=p.sku,quantity=p.quantity,label="Quantity for "+p.sku});
            }
            itemLine++;
            steps.Add(new MobileStep {kind="add",code="M FB",line=itemLine,label="Fitting and balancing"});
            if(j.alignment!=null) {
                itemLine++;
                steps.Add(new MobileStep {kind="add",code=j.alignment,line=itemLine,label="Alignment "+j.alignment});
                steps.Add(new MobileStep {kind="quantity",code=j.alignment,quantity=1,label="Alignment quantity"});
            }
            return steps;
        }
        internal static bool After(MobileStep step,MobileView before,MobileView after) {
            if(before==null||after==null)return false;
            var expected=Wire.Copy(before);
            if(step.kind=="reference")expected.reference=step.value;
            else if(step.kind=="name")expected.name=CustomerEntry.NameForEntry(before.name,step.value);
            else if(step.kind=="phone") {
                // Phone lookup is the only step allowed to select an account/name.
                if(!CustomerEntry.LookupResolved(after.account,after.name,after.phone,step.value))return false;
                expected.account=after.account;expected.name=after.name;expected.phone=after.phone;
            } else if(step.kind=="add") {
                if(after.rows.Count!=before.rows.Count+1)return false;
                MobileRow row;
                if(step.line>0) {
                    // Exactly one new row, on the planned line, which was empty before.
                    var at=after.rows.Where(r=>r.line==step.line).ToList();
                    if(at.Count!=1 || before.rows.Any(r=>r.line==step.line))return false;
                    row=at[0];
                } else row=after.rows.Last();
                if(row.code!=step.code || (step.code!="M" && String.IsNullOrWhiteSpace(row.description)))return false;
                if(step.code=="WA"||step.code=="WAFR") {
                    string d=Order.Norm(row.description);
                    if(!d.Contains("ALIGNMENT")||!d.Contains("FRONT")||(step.code=="WA"?d.Contains("REAR"):!d.Contains("REAR")))return false;
                }
                if(step.line>0) expected.rows.Insert(expected.rows.Count(r=>r.line<step.line),row);
                else expected.rows.Add(row);
            } else if(step.kind=="quantity") {
                var rows=expected.rows.Where(r=>r.code==step.code).ToList();
                var live=after.rows.Where(r=>r.code==step.code).ToList();decimal q;
                if(rows.Count!=1||live.Count!=1||!Decimal.TryParse(live[0].quantity,NumberStyles.Number,CultureInfo.InvariantCulture,out q)||q!=step.quantity)return false;
                rows[0].quantity=live[0].quantity;
            } else if(step.kind=="det") {
                List<MobileRow> added;
                if(step.line>0) {
                    // DET on its planned line and its notes on the lines directly under it.
                    added=after.rows.Where(r=>!before.rows.Any(b=>b.line==r.line)).ToList();
                    if(added.Count==0 || added[0].line!=step.line)return false;
                    for(int i=0;i<added.Count;i++) if(added[i].line!=step.line+i)return false;
                    if(after.rows.Count!=before.rows.Count+added.Count)return false;
                } else added=after.rows.Skip(before.rows.Count).ToList();
                if(added.Count<4 || added[0].code!="DET" || added.Any(r=>!new[]{"DET","M","M ODO"}.Contains(r.code)))return false;
                if(added.Count(r=>r.code=="DET")!=1 || added.Count(r=>r.code=="M"&&r.description.StartsWith("MAKE/MODEL:",StringComparison.OrdinalIgnoreCase))!=1 ||
                    added.Count(r=>r.code=="M"&&r.description.StartsWith("REGO NO:",StringComparison.OrdinalIgnoreCase))!=1 ||
                    added.Count(r=>r.code=="M ODO"&&r.description.StartsWith("ODOMETER:",StringComparison.OrdinalIgnoreCase))!=1)return false;
                int rego=added.FindIndex(r=>r.description.StartsWith("REGO NO:",StringComparison.OrdinalIgnoreCase));
                if(rego+1>=added.Count || !added[rego+1].description.StartsWith("ODOMETER:",StringComparison.OrdinalIgnoreCase))return false;
                expected.rows.AddRange(added);
                if(step.line>0) expected.rows=expected.rows.OrderBy(r=>r.line).ToList();
            } else if(step.kind=="memo") {
                var rows=expected.rows.Where(r=>r.code==step.code && r.description.StartsWith(step.label+":",StringComparison.OrdinalIgnoreCase)).ToList();
                if(rows.Count!=1)return false;rows[0].description=step.value;
            } else if(step.kind=="notes") {
                if(expected.rows.Count==0 || expected.rows.Last().code!="M")return false;
                expected.rows.Last().description=step.value;
            } else return false;
            return Same(expected,after);
        }
        internal static bool CanClose(MobileJob job,MobileCheckpoint cp,MobileView live) {
            var expected=cp==null?null:cp.verified;
            return expected!=null && live!=null && cp.submissionId==job.submissionId && expected.reference==job.Reference &&
                Order.Phone(expected.phone)==Order.Phone(job.customer.mobile) && !String.IsNullOrWhiteSpace(expected.name) &&
                live.reference==expected.reference && CustomerEntry.SameIdentity(live.account,live.name,live.phone,expected.account,expected.name,expected.phone);
        }
    }
    // Tempe Order Check (a separate tool) reads a SECOND Tempe COSTAR window's
    // Work-in-Progress list and serves it on this PC. The helper never types into that
    // window, and before an online order is filled it asks Order Check whether the order
    // is already in COSTAR (its TTW number in the PO column, Order Check 1.4.0 or later).
    internal static class OrderCheckLink {
        internal const string WipUrl="http://127.0.0.1:8795/wip.json";
        static string cachedKey="";static DateTime cachedAt=DateTime.MinValue;
        // Order Check remembers its window as "PID@<process start time, local ticks>".
        internal static string WipKey() {
            if(DateTime.UtcNow-cachedAt<TimeSpan.FromSeconds(10)) return cachedKey;
            string key="";
            try {
                string path=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TempeOrderCheck","settings.json");
                if(System.IO.File.Exists(path)) {
                    var d=new System.Web.Script.Serialization.JavaScriptSerializer().DeserializeObject(System.IO.File.ReadAllText(path,System.Text.Encoding.UTF8)) as Dictionary<string,object>;
                    object v; if(d!=null&&d.TryGetValue("targetKey",out v)&&v!=null) key=Convert.ToString(v,CultureInfo.InvariantCulture);
                }
            } catch(Exception) { key=""; }
            cachedKey=key;cachedAt=DateTime.UtcNow;return key;
        }
        internal static bool IsWipWindow(CostarInstance c) { return c!=null && Matches(WipKey(),c.Pid,c.Started); }
        // Called when Order Check's WIP window was just chosen.
        internal static void Forget() { cachedAt=DateTime.MinValue; }
        // The helper records process start as UTC ticks; Order Check as local ticks.
        internal static bool Matches(string key,int pid,long startedUtcTicks) {
            if(String.IsNullOrEmpty(key)) return false;
            int at=key.IndexOf('@');if(at<=0) return false;
            int keyPid;long ticks;
            if(!Int32.TryParse(key.Substring(0,at),NumberStyles.Integer,CultureInfo.InvariantCulture,out keyPid) || keyPid!=pid) return false;
            if(!Int64.TryParse(key.Substring(at+1),NumberStyles.Integer,CultureInfo.InvariantCulture,out ticks) || ticks<=0 || ticks>=DateTime.MaxValue.Ticks) return false;
            long asUtc;
            try { asUtc=new DateTime(ticks,DateTimeKind.Local).ToUniversalTime().Ticks; } catch(ArgumentException) { return false; }
            return Math.Abs(asUtc-startedUtcTicks)<=2*TimeSpan.TicksPerSecond || Math.Abs(ticks-startedUtcTicks)<=2*TimeSpan.TicksPerSecond;
        }
        // A message when Order Check's latest read already holds this order; null otherwise.
        internal static string AlreadyInCostar(string orderId,out string note) {
            note="";
            if(String.IsNullOrWhiteSpace(orderId)) return null;
            string json;
            // Order Check runs inside this app (2.0.0+): read its data directly.
            var local=TempeOrderCheck.Hosting.Store;
            if(local!=null) {
                try { json=System.Text.Encoding.UTF8.GetString(local.Snapshot()); }
                catch(Exception) { note="Order Check data unavailable"; return null; }
                return FindInWip(json,orderId,out note);
            }
            try {
                var request=(System.Net.HttpWebRequest)System.Net.WebRequest.Create(WipUrl);
                request.Method="GET";request.Timeout=1500;request.ReadWriteTimeout=1500;request.Proxy=null;request.KeepAlive=false;
                using(var response=(System.Net.HttpWebResponse)request.GetResponse())
                using(var reader=new System.IO.StreamReader(response.GetResponseStream(),System.Text.Encoding.UTF8)) json=reader.ReadToEnd();
            } catch(Exception) { note="Order Check is not running"; return null; }
            return FindInWip(json,orderId,out note);
        }
        internal static string FindInWip(string json,string orderId,out string note) {
            note="";
            Dictionary<string,object> root=null;
            try { root=new System.Web.Script.Serialization.JavaScriptSerializer{MaxJsonLength=16*1024*1024}.DeserializeObject(json??"") as Dictionary<string,object>; } catch(Exception) { root=null; }
            if(root==null) { note="Order Check sent unreadable data"; return null; }
            string column=Field(root,"poColumn");
            if(column.Length==0) {
                string state=Field(root,"state");
                note=state=="ok"?"Order Check's WIP list has no PO column, so it cannot check for duplicates":
                    "Order Check has not read the WIP list yet ("+(state.Length>0?state:"starting")+"), so it cannot check for duplicates";
                return null;
            }
            object rowsValue;var rows=root.TryGetValue("rows",out rowsValue)?rowsValue as System.Collections.IEnumerable:null;
            if(rows==null) { note="Order Check has no rows yet"; return null; }
            string want=orderId.Trim();
            foreach(object o in rows) {
                var row=o as Dictionary<string,object>;
                if(row==null || !String.Equals(Field(row,"po").Trim(),want,StringComparison.OrdinalIgnoreCase)) continue;
                string doc=Field(row,"doc"),by=Field(row,"by"),read=Field(root,"readAt");
                note="already in COSTAR as document "+doc;
                return want+" is already in COSTAR as document "+(doc.Length>0?doc:"?")+(by.Length>0?" (written by "+by+")":"")+", according to Order Check"+
                    (read.Length>=16?" (read at "+read.Substring(11,5)+")":"")+". Not entered twice; check that document.";
            }
            note="not in Order Check's Work-in-Progress list";
            return null;
        }
        static string Field(Dictionary<string,object> d,string key) {
            object v; return d!=null&&d.TryGetValue(key,out v)&&v!=null?Convert.ToString(v,CultureInfo.InvariantCulture):"";
        }
    }
    internal static class CostarWindows {
        internal static bool IsCostar(IntPtr h) {
            ProcessIdentity identity;return LocalProcess.IsNamed((int)Native.Pid(h),"COSTAR",out identity);
        }
        // What the last search saw: COSTAR main-window titles only (never other apps).
        internal static volatile string LastScan="";
        internal static List<CostarInstance> Choices() {
            var result=new List<CostarInstance>();var identities=new Dictionary<int,ProcessIdentity>();
            var seen=new List<string>();int costarWindows=0;
            Native.EnumWindows(delegate(IntPtr h,IntPtr unused) {
                if(!Native.IsWindowVisible(h))return true;
                string title=Native.Caption(h);
                if(title.StartsWith("COSTAR",StringComparison.OrdinalIgnoreCase)){costarWindows++;if(seen.Count<6)seen.Add(title.Length>48?title.Substring(0,48):title);}
                if(Branches.OfMain(title)==0)return true;
                int pid=(int)Native.Pid(h);ProcessIdentity identity;
                if(!identities.TryGetValue(pid,out identity)) {
                    if(!LocalProcess.IsNamed(pid,"COSTAR",out identity))identity=null;
                    identities[pid]=identity;
                }
                if(identity!=null)result.Add(new CostarInstance(pid,h.ToInt64(),identity.Started,identity.Session,title));
                else if(seen.Count<8)seen.Add("(window of process "+pid+" is not a COSTAR process in this session)");
                return true;
            },IntPtr.Zero);
            LastScan=costarWindows+" COSTAR window(s) seen"+(seen.Count>0?": "+String.Join(" | ",seen):"");
            return result.OrderBy(x=>x.Pid).ThenBy(x=>x.MainWindow).ToList();
        }
        internal static IntPtr Main(CostarInstance target) {
            Order.Require(target!=null,"Select a COSTAR in the list above.");
            var h=new IntPtr(target.MainWindow);
            Order.Require(Native.IsWindow(h)&&Native.Pid(h)==target.Pid&&Branches.MainTitle(Native.Caption(h),target.Branch),"The selected COSTAR ("+target.Label+") was closed or changed branch. Refresh and select a target.");
            ProcessIdentity identity;
            Order.Require(LocalProcess.IsNamed(target.Pid,"COSTAR",out identity)&&identity.Started==target.Started&&identity.Session==target.Session,"The selected COSTAR restarted or is unavailable. Select it again; no replacement was chosen automatically.");
            return h;
        }
        internal static List<IntPtr> Orders(CostarInstance target) {
            Main(target);var result=new List<IntPtr>();
            Native.EnumWindows(delegate(IntPtr h,IntPtr unused) {
                // Filter by the selected PID before reading any other window.
                if(Native.Pid(h)==target.Pid&&Native.IsWindowVisible(h)&&Native.Caption(h).StartsWith("RepairOrder",StringComparison.OrdinalIgnoreCase))result.Add(h);
                return true;
            },IntPtr.Zero);return result;
        }
        internal static bool Available(CostarInstance target,out string detail) {
            try {if(Orders(target).Count>0){detail="A Repair Order is open in the selected COSTAR";return false;}detail="Selected COSTAR ready ("+target.Label+")";return true;}catch(Exception e){detail=e.Message;return false;}
        }
        internal static IntPtr OnlineOrder(CostarInstance target) {
            var orders=Orders(target);
            Order.Require(orders.Count==1 && Branches.OrderTitle(Native.Caption(orders[0]),target.Branch),"Open one NEW empty Repair Order in the selected COSTAR ("+target.Label+"). Other COSTAR instances can stay open.");
            return orders[0];
        }
        // allowExisting: earlier Repair Orders may stay open (online orders left for review);
        // the new window is the one that was not there before the click.
        internal static IntPtr OpenNew(CostarInstance target,Action beforeClick,Func<bool> cancelled,bool allowExisting=false) {
            var before=new HashSet<long>(Orders(target).Select(h=>h.ToInt64()));
            Order.Require(allowExisting || before.Count==0,"A Repair Order is already open in the selected COSTAR; it will not be overwritten.");
            var main=Main(target);var buttons=new List<IntPtr>();
            Native.EnumChildWindows(main,delegate(IntPtr h,IntPtr unused){string t;
                if(Native.IsWindowVisible(h)&&Native.IsWindowEnabled(h)&&Native.Class(h).IndexOf("BUTTON",StringComparison.OrdinalIgnoreCase)>=0&&Native.TryText(h,out t)&&Order.Norm(t).Replace("&","")=="ADD NEW")buttons.Add(h);return true;
            },IntPtr.Zero);
            Order.Require(buttons.Count==1,before.Count>0?"Add New is not available while another Repair Order is open in this COSTAR. Save or close the previous order, then click Fill again.":"Could not identify the recorded Add new button. Leave the selected COSTAR on Work-in-Progress.");
            Native.BringToFront(main); // Works even when an order arrives while Chrome is in front.
            var activation=Stopwatch.StartNew();
            while(!cancelled()&&Native.GetForegroundWindow()!=main&&activation.ElapsedMilliseconds<2000)Thread.Sleep(25);
            Order.Require(!cancelled()&&Native.GetForegroundWindow()==main&&Native.IsWindowEnabled(main)&&Orders(target).Count==before.Count,"The selected COSTAR is not ready to open a new order.");
            var button=buttons[0];Native.Rect box;Order.Require(Native.GetWindowRect(button,out box),"Add new moved.");
            var point=new Native.Point{X=(box.Left+box.Right)/2,Y=(box.Top+box.Bottom)/2};
            Order.Require(Native.GetAncestor(button,2)==main,"Add new moved.");
            bool covered=Native.WindowFromPoint(point)!=button;
            Order.Require(!covered || before.Count>0,"Add new is covered by another window.");
            Main(target);beforeClick();
            if(!covered) Native.Click(point);
            else { UIntPtr pressed; Native.WriteMessage(button,0xF5,UIntPtr.Zero,null,3,1000,out pressed); } // An open order covers it: press it directly (BM_CLICK).
            var timer=Stopwatch.StartNew();var settle=Stopwatch.StartNew();IntPtr candidate=IntPtr.Zero;bool promptNoted=false;
            while(timer.ElapsedMilliseconds<30000) {
                Order.Require(!cancelled(),"Stopped while waiting for Add New. Check COSTAR before retrying.");
                // 4 Oct: Add New took 31 s with the reviewed order still open. Record any COSTAR
                // prompt shown meanwhile (title and type only); nothing is pressed.
                IntPtr fg=Native.GetForegroundWindow();
                // "Order Entry" is COSTAR's own new-order window (5 Oct, every order), not a prompt.
                if(!promptNoted && fg!=IntPtr.Zero && fg!=main && Native.Pid(fg)==target.Pid && !Native.Caption(fg).StartsWith("RepairOrder",StringComparison.OrdinalIgnoreCase) && Native.Caption(fg)!="Order Entry") {
                    promptNoted=true;AppLog.Note("add_new_prompt","COSTAR showed \""+Native.Caption(fg)+"\" ("+Native.Class(fg)+") after Add New, at "+timer.ElapsedMilliseconds+" ms");
                }
                var fresh=Orders(target).Where(h=>!before.Contains(h.ToInt64())).ToList();
                Order.Require(fresh.Count<=1,"More than one Repair Order appeared in the selected COSTAR.");
                if(fresh.Count==1) {
                    Order.Require(Branches.OrderTitle(Native.Caption(fresh[0]),target.Branch),"The new Repair Order is not in "+target.Label+".");
                    // COSTAR can show a first window while it builds the order and then replace
                    // it (3 Oct: the window returned here was gone a moment later). Hand over
                    // only a window that has stayed the same for 300 ms.
                    if(fresh[0]==candidate && settle.ElapsedMilliseconds>=300) return fresh[0];
                    if(fresh[0]!=candidate) { candidate=fresh[0]; settle.Restart(); }
                } else candidate=IntPtr.Zero;
                Thread.Sleep(50);
            }
            throw new InvalidOperationException("Add New did not appear. A second click will not be sent automatically.");
        }
        // True when a job's Repair Order window no longer exists in its COSTAR process
        // (closed by hand, or COSTAR was closed or restarted). Cheap: no process query.
        internal static bool OrderWindowGone(MobileCheckpoint cp) {
            if(cp==null || cp.window==0) return false;
            var h=new IntPtr(cp.window);
            return !(Native.IsWindow(h) && (int)Native.Pid(h)==cp.processId);
        }
        // True when the COSTAR process a job was pinned to is no longer running.
        internal static bool PinnedProcessGone(MobileCheckpoint cp) {
            if(cp==null || cp.processId<=0) return false;
            ProcessIdentity identity;
            return !(LocalProcess.IsNamed(cp.processId,"COSTAR",out identity) && identity.Started==cp.processStart && identity.Session==cp.sessionId);
        }
        internal static void ValidateTarget(MobileCheckpoint c) {
            var h=new IntPtr(c.window);Order.Require(Native.IsWindow(h)&&Native.Pid(h)==c.processId&&Branches.OrderTitle(Native.Caption(h),Branches.OrLegacy(c.branch)),"The original Repair Order no longer exists; it will not be recreated on Retry.");
            ProcessIdentity identity;Order.Require(LocalProcess.IsNamed(c.processId,"COSTAR",out identity)&&identity.Started==c.processStart&&identity.Session==c.sessionId,"COSTAR restarted or changed session. Check the partial order manually.");
        }
    }
    internal sealed partial class Runner {
        internal IntPtr Target {get{return root;}}
        FieldMap mobileHeader;
        List<ControlInfo> WaitForMobileStartup() {
            Say("Waiting for the new Repair Order's customer fields and item grid to load.");
            var wait=Diag.Wait("ro_startup");
            try {
            var timer=Stopwatch.StartNew();string problem="COSTAR has not finished opening the Repair Order.";
            while(timer.ElapsedMilliseconds<30000) {
                wait.Tick();Check(false);
                var front=Native.GetForegroundWindow();
                if(front==root&&Native.IsWindowEnabled(root)) {
                    var snapshot=Snapshot(root);Check(true);
                    if(lastSnapshotBusy){problem="COSTAR is busy drawing the new order.";Pause(150);continue;}
                    try {
                        // A blank row may not create its quantity/price editors
                        // until a SKU is entered. Require the same initial form
                        // structure as the working online blank-order check.
                        Selectors.Header(snapshot);Selectors.ProductGrid(snapshot);Selectors.Total(snapshot);
                        // A field that could not be read means COSTAR was still drawing the
                        // order (a normal idle form reads every field). Wait, do not stop.
                        if(lastSnapshotBusy || snapshot.Any(c=>c.TextState=="read-failed-or-timed-out")){problem="COSTAR was still drawing the new order.";Pause(150);continue;}
                        wait.Done("ok");return snapshot;
                    } catch(InvalidOperationException e){problem=e.Message;}
                } else {
                    if(front!=root)Diag.ForegroundLost(front,Native.IsWindowEnabled(root));
                    problem="Blocking/foreground window: "+Native.Caption(front)+" (PID "+Native.Pid(front)+"). Leave the original Repair Order in front and close any prompt yourself.";
                }
                Pause(60);
            }
            wait.Done("timeout");
            throw new InvalidOperationException("The new Repair Order did not finish loading. No job fields were entered. Leave its window open and retry. "+problem);
            } finally {wait.End();}
        }
        MobileView MobileSnapshot() {
            FieldMap h=mobileHeader;List<ControlInfo> s;
            if(h!=null) {
                try {CheckTarget(h.Account);CheckTarget(h.Name);CheckTarget(h.Phone);CheckTarget(h.PO);}
                catch(InvalidOperationException){h=null;}
            }
            if(h==null){s=Current();h=Selectors.Header(s);mobileHeader=h;}else s=GridCurrent();
            var g=Selectors.ProductGrid(s);
            var v=new MobileView {account=ReadLive(h.Account),name=ReadLive(h.Name),phone=ReadLive(h.Phone),reference=ReadLive(h.PO)};
            for(int i=0;i<g.Rows.Count;i++) {
                var row=g.Rows[i];
                if(row.Value.Length==0) continue;
                string code=Order.Norm(row.Value),quantity="";
                if(!new[]{"M","M FB","M ODO","DET"}.Contains(code))quantity=Selectors.Cell(s,row,g.Quantity).Value;
                v.rows.Add(new MobileRow {code=code,description=Selectors.Cell(s,row,g.Description).Value,quantity=quantity,line=i+1});
            }
            return v;
        }
        MobileView StableMobileView() {
            var wait=Diag.Wait("stable_view");
            try {
            MobileView prior=null;var timer=Stopwatch.StartNew();string problem="";
            while(timer.ElapsedMilliseconds<8000) {
                wait.Tick();Ready();
                try{var v=MobileSnapshot();if(MobileProof.Same(prior,v)){wait.Done("ok");return v;}prior=v;}
                catch(InvalidOperationException e){Check(true);prior=null;problem=e.Message;}
                Pause(40);
            }
            wait.Done("timeout");
            throw new InvalidOperationException("The mobile order did not settle for verification. "+problem);
            } finally {wait.End();}
        }
        MobileView WaitAfterMobileStep(MobileStep step,MobileView before) {
            var wait=Diag.Wait("verify_after_step");
            try {
            var timer=Stopwatch.StartNew();
            while(timer.ElapsedMilliseconds<4000) {
                wait.Tick();Ready();
                try {var view=MobileSnapshot();if(MobileProof.After(step,before,view)){wait.Done("ok");return view;}}
                catch(InvalidOperationException) { /* A COSTAR row may still be expanding. */ }
                Pause(25);
            }
            wait.Done("timeout");
            throw new InvalidOperationException("Verification failed after "+step.label+". Retry will inspect this operation before doing anything.");
            } finally {wait.End();}
        }
        void MobileDo(MobileStep step,MobileView before) {
            if(step.kind=="reference")Put(HeaderNow().PO,step.value,step.label,true);
            else if(step.kind=="name") {if(String.IsNullOrWhiteSpace(before.name))CustomerField(m=>m.Name,step.value,step.label);}
            else if(step.kind=="phone") {
                lookupPhone=step.value;Put(HeaderNow().Phone,step.value,step.label,true);
                bool existing=LookupCustomer();mobileHeader=null;Say(existing?"Matched phone; retaining COSTAR's account and name.":"No customer found; entering the job card name.");
            }
            else if(step.kind=="add")AddCode(step.code,step.code=="M",false,false,step.line);
            else if(step.kind=="quantity") {
                var s=GridCurrent();var g=Selectors.ProductGrid(s);var row=Selectors.One(g.Rows.Where(r=>Order.Norm(r.Value)==step.code),step.code);
                PutQuantity(Selectors.Cell(s,row,g.Quantity),step.quantity,step.label);
            } else if(step.kind=="det") {AddCode("DET",false,commitOutsideGrid:true,line:step.line);WaitForDetailsTemplate();}
            else if(step.kind=="memo")Memo(step.label,step.value.Substring(step.label.Length+1).TrimStart(),step.code,false);
            else if(step.kind=="notes") {
                Func<MemoTarget> locate=delegate {var s=GridCurrent();var g=Selectors.ProductGrid(s);var r=g.Rows.Last(x=>x.Value.Length>0);Order.Require(Order.Norm(r.Value)=="M","Additional notes row changed.");return new MemoTarget {Row=r,Editor=Selectors.Cell(s,r,g.Description)};};
                var target=FocusMemo(locate,"Additional notes");WriteFocused(target.Editor,step.value,"Additional notes",true);
            }
        }
        internal void RunMobile(MobileJob job,MobileCheckpoint cp,Action<MobileCheckpoint> persist) {
            job.Validate();Order.Require(cp.submissionId==job.submissionId&&cp.window==root.ToInt64(),"Wrong target checkpoint.");
            runClock.Restart();var plan=MobileProof.Plan(job);Diag.Kind="mobile";
            try {
                Diag.BeginStage("Startup: wait for Repair Order and verify");
                MobileProof.PrepareCheckpoint(cp);persist(cp);
                if(cp.verified!=null)Diag.EventRaw("resume","checkpoint index "+cp.index+", pending "+cp.pending+", plan "+plan.Count+" steps");
                if(cp.verified==null) {
                    // A visible title is not proof that a freshly opened form's
                    // children have loaded. Do not treat startup as phone lookup.
                    enteringCustomer=false;Activate();
                    var startup=WaitForMobileStartup();Diag.Layout(startup);Selectors.Blank(startup,branch);cp.verified=StableMobileView();persist(cp);
                    enteringCustomer=true;
                } else {enteringCustomer=true;ActivateAndWait();}
                if(cp.pending>=0 && cp.pending<plan.Count) {
                    var pending=plan[cp.pending];var view=MobileSnapshot();
                    if(pending.kind=="phone" && MobileProof.After(pending,cp.verified,view)) {
                        var phone=Selectors.Header(Current()).Phone;
                        if(Native.Focus(root).ToInt64()==phone.Handle)CommitField(phone);
                        LookupCustomer();
                    } else if((pending.kind=="memo"||pending.kind=="notes") && MobileProof.After(pending,cp.verified,view)) {
                        var s=Current();ControlInfo editor;
                        if(pending.kind=="memo")editor=Selectors.FindMemo(s,pending.label,pending.code).Editor;
                        else {var g=Selectors.ProductGrid(s);editor=Selectors.Cell(s,g.Rows.Last(r=>r.Value.Length>0),g.Description);}
                        if(Native.Focus(root).ToInt64()==editor.Handle)CommitField(editor);
                    }
                }
                if(cp.pending>=0 && cp.pending<plan.Count && plan[cp.pending].kind=="det") {
                    var view=MobileSnapshot();
                    if(view.rows.Count>cp.verified.rows.Count && view.reference==order.orderId) {LeaveGrid("while recovering DET");WaitForDetailsTemplate();}
                }
                var live=StableMobileView();
                if(cp.pending>=0) {
                    Order.Require(cp.pending==cp.index&&cp.index<plan.Count,"Invalid checkpoint position.");
                    if(MobileProof.After(plan[cp.index],cp.verified,live)) {cp.verified=live;cp.index++;cp.pending=-1;persist(cp);}
                    else if(MobileProof.Same(cp.verified,live)) {cp.pending=-1;persist(cp);}
                    else throw new InvalidOperationException("The interrupted operation is only partly applied or the order changed. Retry cannot safely guess; finish/check it manually. No rows were repeated.");
                }
                Order.Require(MobileProof.Same(cp.verified,live),"COSTAR no longer matches the last verified step. Nothing will be overwritten.");
                Diag.EndStage(true);
                // The first step re-reads COSTAR after startup or resume. Later steps start
                // from the view this run verified moments earlier; any edit in between still
                // fails the next step's whole-order verification.
                bool continuing=false;
                while(cp.index<plan.Count) {
                    var step=plan[cp.index];Say((cp.index+1)+"/"+plan.Count+": "+step.label);
                    // Customer-popup recovery is only for the phone, name and reference steps.
                    enteringCustomer=step.kind=="phone"||step.kind=="name"||step.kind=="reference";
                    if(!continuing){Ready();Order.Require(MobileProof.Same(cp.verified,MobileSnapshot()),"The order was edited between steps; stopped to prevent mixing changes.");}
                    // One durable write per step records every verified step and marks this
                    // one pending. A stop after the step is reconciled by the pending check.
                    cp.pending=cp.index;persist(cp);MobileView after=null;
                    Timed(step.label,delegate {MobileDo(step,cp.verified);after=WaitAfterMobileStep(step,cp.verified);});
                    cp.verified=after;cp.index++;cp.pending=-1;continuing=true;
                }
                persist(cp);enteringCustomer=false;
                Diag.BeginStage("Final verification and report");Ready();var final=MobileSnapshot();Order.Require(MobileProof.Same(cp.verified,final)&&MobileProof.CanClose(job,cp,final),"Final mobile order verification failed.");
                // Ship Via SHOP for a customer with a COSTAR customer number. Not part of the
                // mobile proof (account, name, phone, PO#, rows), so it is done after it; never fatal.
                try { Timed("Ship Via SHOP",delegate { SetShipViaShop(); }); }
                catch(InvalidOperationException e) { Say("Ship Via SHOP not entered ("+e.Message+"). Enter it by hand."); }
                Dump("after-controls",Current());Say("READY FOR REVIEW — mobile job entered; COSTAR prices retained.");Activate();
                Diag.EndStage(true);Diag.Completed();
            } catch(Exception e) {
                Diag.Stopped(e);Say("STOPPED: "+e.Message);
                try{System.IO.File.WriteAllText(System.IO.Path.Combine(Folder,"mobile-checkpoint.json"),Wire.Json(cp));}catch{}
                try{CaptureForegroundWindow(e.Message);Dump("stopped-controls",Snapshot(root));}catch{}throw;
            }
        }
        internal void CloseMobile(MobileJob job,MobileCheckpoint cp) {
            Diag.Kind="mobile-close";ActivateAndWait();Check(true);var h=Selectors.Header(Current());
            var live=new MobileView {account=h.Account.Value,name=h.Name.Value,phone=h.Phone.Value,reference=h.PO.Value};
            Order.Require(MobileProof.CanClose(job,cp,live),"The open order belongs to another customer/reference. Close it manually if appropriate.");
            UIntPtr result;Native.WriteMessage(root,0x10,UIntPtr.Zero,null,3,1000,out result);
            var timer=Stopwatch.StartNew();while(timer.ElapsedMilliseconds<5000){if(!Native.IsWindow(root)){Diag.Completed();return;}Thread.Sleep(100);}
            throw new InvalidOperationException("COSTAR did not close the reviewed order. Resolve its prompt manually, then resume the RDP worker. No confirmation was accepted.");
        }
    }
}
