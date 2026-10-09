using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;

namespace TempeCostar {
    // Model/API and helper-resource tests. Never opens, clicks or types into COSTAR.
    internal static class MobileTests {
        static readonly StringBuilder results=new StringBuilder();
        static int count;
        static void Check(bool value,string message){if(!value)throw new InvalidOperationException(message);}
        static void Reject(Action action){bool rejected=false;try{action();}catch(InvalidOperationException){rejected=true;}Check(rejected,"Expected rejection.");}
        static void Case(string name,Action test){try{test();count++;results.AppendLine("PASS "+name);}catch(Exception e){throw new InvalidOperationException(results+"FAIL "+name+": "+e.Message,e);}}
        static MobileJob Job(int n=1) {
            return new MobileJob {
                schema="tempe.mobile-jobcard.v1",submissionId="MJC-11111111-1111-4111-8111-"+n.ToString("D12"),
                draftId="22222222-2222-4222-8222-222222222222",createdUtc="2026-09-29T00:00:00.000Z",
                customer=new MobileCustomer{name="TEST CUSTOMER",mobile="0400000000"},
                vehicle=new MobileVehicle{registration="TEST123",makeModel="Mazda MX-5",odometer=0},
                products=new List<MobileProduct>{new MobileProduct{type="tyre",sku="TESTTYRE",description="TEST TYRE",quantity=4}},
                fittingCode="M FB",alignment=null,additionalNotes=""
            };
        }
        static WorkerHello Hello(WorkerReport report=null,bool accepting=true,bool available=true){return new WorkerHello{workerId="test-worker",accepting=accepting,available=available,report=report};}
        static WorkerReport Report(WorkerReply assignment,string status,int sequence){return new WorkerReport{submissionId=assignment.job.submissionId,lease=assignment.lease,status=status,sequence=sequence,message=status,progress=""};}
        static JobQueue Queue(){return new JobQueue(null,s=>{});}
        static MobileView View(){return new MobileView{account="",name="TEST CUSTOMER",phone="0400000000",reference=Job().Reference};}
        static WorkerJournal UnstartedJournal() {
            var job=Job();return new WorkerJournal {job=job,lease="test-lease",
                report=new WorkerReport {submissionId=job.submissionId,lease="test-lease",status="failed",sequence=3},
                checkpoint=new MobileCheckpoint {submissionId=job.submissionId,planVersion=MobileProof.PlanVersion,window=100,processId=20,processStart=1000,sessionId=1}};
        }
        static MobileRow Row(string code,string description,string quantity=""){return new MobileRow{code=code,description=description,quantity=quantity};}
        static HttpInput Request(string method,string path,string token,string origin=null,object body=null) {
            var r=new HttpInput{method=method,path=path,body=body==null?"":Wire.Json(body),headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase)};
            if(token!=null)r.headers["authorization"]="Bearer "+token;
            if(origin!=null)r.headers["origin"]=origin;
            if(body!=null)r.headers["content-type"]="application/json";
            return r;
        }
        internal static string Run() {
            results.Clear();count=0;
            Case("Existing online-order model and selector checks",()=>AutofillForm.SelfTest());
            Case("Targeted process identity matches this helper and rejects missing PIDs",()=>{
                ProcessIdentity identity;
                Check(LocalProcess.TryRead((int)LocalProcess.GetCurrentProcessId(),out identity),"Cannot read this process using limited-information access.");
                Check(identity.Pid==(int)LocalProcess.GetCurrentProcessId()&&identity.Session==LocalProcess.Session,"Wrong current process/session.");
                Check(identity.Name==Path.GetFileNameWithoutExtension(System.Windows.Forms.Application.ExecutablePath),"Wrong executable identity.");
                using(var self=System.Diagnostics.Process.GetCurrentProcess())Check(identity.Started==self.StartTime.ToUniversalTime().Ticks,"Checkpoint process-start format changed.");
                for(int i=0;i<32;i++){ProcessIdentity again;Check(LocalProcess.TryRead(identity.Pid,out again)&&again.Started==identity.Started&&again.Session==identity.Session,"Repeated identity check changed.");}
                ProcessIdentity missing;Check(!LocalProcess.TryRead(0,out missing)&&!LocalProcess.TryRead(-1,out missing)&&!LocalProcess.TryRead(Int32.MaxValue,out missing),"Invalid process accepted.");
            });
            Case("Progress backlog stays bounded while the UI cannot drain it",()=>{
                var buffer=new BoundedLog();for(int i=0;i<5000;i++)buffer.Add("Message "+i+" "+new string('x',100));buffer.Add("LATEST MARKER");
                string text=buffer.Drain();Check(text.Length<=BoundedLog.PendingLimit&&text.Contains("LATEST MARKER")&&!text.Contains("Message 0 "),"Log backlog is unbounded or discarded the newest progress.");
                Check(buffer.Drain()=="","Draining retained old messages.");
            });
            Case("One oversized progress message cannot enlarge the UI queue",()=>{
                var buffer=new BoundedLog();buffer.Add(new string('x',200000));string text=buffer.Drain();
                Check(text.Length<BoundedLog.MessageLimit+100&&text.Contains("[truncated]"),"Oversized message was retained.");
            });
            Case("Concurrent progress producers share a bounded tail",()=>{
                var buffer=new BoundedLog();var a=new Thread(()=>{for(int i=0;i<1000;i++)buffer.Add("Mobile "+i);});var b=new Thread(()=>{for(int i=0;i<1000;i++)buffer.Add("Online "+i);});
                a.Start();b.Start();a.Join();b.Join();buffer.Add("LAST");string text=buffer.Drain();
                Check(text.Length<=BoundedLog.PendingLimit&&text.EndsWith("LAST"+Environment.NewLine),"Concurrent logging lost the tail or exceeded its limit.");
            });
            Case("Visible progress log remains bounded after repeated flushes",()=>{
                var buffer=new BoundedLog();using(var box=new System.Windows.Forms.TextBox {Multiline=true}) {
                    for(int batch=0;batch<20;batch++){for(int i=0;i<40;i++)buffer.Add(new string('x',200));buffer.Flush(box);Check(box.TextLength<=BoundedLog.VisibleLimit,"Visible log grew beyond its limit.");}
                    buffer.Add("NEWEST");buffer.Flush(box);Check(box.Text.Contains("NEWEST"),"Visible log dropped the newest message.");
                }
            });
            Case("COSTAR titles give the branch; an order must be in the selected branch",()=>{
                Check(Branches.MainTitle("COSTAR:  11 Tempe Tyres Tempe     v5.7.6.0  (sql-Server:Tempe)",11) && Branches.OrderTitle("RepairOrder Branch 11 Tempe Tyres Tempe",11),"Screenshot titles rejected.");
                Check(Branches.OfMain("COSTAR:  1 Tempe Tyres Head Office   v5.7.6.0  (sql-Server:Tempe)")==1 && Branches.OrderTitle("RepairOrder Branch 1 Tempe Tyres Head Office",1),"Another branch was not recognised.");
                Check(Branches.NameOfMain("COSTAR:  11 Tempe Tyres Tempe                   v5.7.6.0  (sql-Server:Tempe)")=="Tempe Tyres Tempe","Branch name not read from the title.");
                foreach(string title in new[]{"COSTAR: 110 Tempe Tyres Tempe","COSTAR: 12 Tempe Tyres Tempe","COSTAR: 1 Tempe Tyres Tempe"})Check(!Branches.MainTitle(title,11),"Another branch's main window accepted as Branch 11.");
                foreach(string title in new[]{"Other COSTAR: 11 Tempe Tyres Tempe","CefSharp.BrowserSubprocess","COSTAR: 11","COSTAR:  Tempe Tyres Tempe",""})Check(Branches.OfMain(title)==0,"Not a COSTAR main window, but a branch was read: "+title);
                foreach(string title in new[]{"RepairOrder Branch 110","RepairOrder Branch 12","Other RepairOrder Branch 11","RepairOrder Branch 11A","RepairOrder Branch 1"})Check(!Branches.OrderTitle(title,11),"Another branch's repair order accepted as Branch 11: "+title);
                Check(!Branches.OrderTitle("RepairOrder Branch 11",0)&&!Branches.MainTitle("COSTAR: 11 Tempe Tyres Tempe",0),"An unknown branch (0) must never match.");
                Check(Branches.OrLegacy(0)==11&&Branches.OrLegacy(1)==1,"Jobs saved before 2.3.0 must count as Branch 11.");
                var c=new CostarInstance(10,20,30,1,"COSTAR:  1 Tempe Tyres Head Office   v5.7.6.0  (sql-Server:Tempe)");
                Check(c.Branch==1&&c.BranchName=="Tempe Tyres Head Office"&&c.Label=="Branch 1 (HEAD OFFICE)","The COSTAR list entry does not show its branch.");
                Check(!c.Same(new CostarInstance(10,20,30,1,"COSTAR:  11 Tempe Tyres Tempe")),"A COSTAR that changed branch must count as a different target.");
            });
            Case("A pickup's store is matched to a branch strictly, and new orders accept their branch's default suburb",()=>{
                Check(Branches.StoreMatches("Tempe NSW","Tempe Tyres Tempe")&&Branches.StoreMatches("TEMPE","Tempe Tyres Tempe"),"Tempe store not matched to Branch 11.");
                Check(Branches.StoreMatches("St Peters NSW","Tempe Tyres St. Peters"),"Punctuation must not stop a match.");
                Check(!Branches.StoreMatches("Tempe NSW","Tempe Tyres Head Office")&&!Branches.StoreMatches("Silverwater NSW","Tempe Tyres Tempe"),"A different store matched.");
                Check(!Branches.StoreMatches("","Tempe Tyres Tempe")&&!Branches.StoreMatches("Tempe NSW",""),"A missing store or branch must never match.");
                Check(Selectors.DefaultSuburb("Tempe",11)&&Selectors.DefaultSuburb("",11)&&!Selectors.DefaultSuburb("Mascot",11),"Branch 11 must keep its observed TEMPE default.");
                Check(Selectors.DefaultSuburb("Silverwater",1)&&Selectors.DefaultState("VIC",1)&&!Selectors.DefaultState("XX",1)&&!Selectors.DefaultState("VIC",11),"Another branch's own default suburb/state must be accepted, only valid states.");
            });
            Case("Instance identity includes process start, window and session",()=>{
                var a=new CostarInstance(1,100,200,3,"A");Check(a.Same(new CostarInstance(1,100,200,3,"Changed title")),"Stable instance rejected.");
                foreach(var other in new[]{new CostarInstance(2,100,200,3,"A"),new CostarInstance(1,101,200,3,"A"),new CostarInstance(1,100,201,3,"A"),new CostarInstance(1,100,200,4,"A")})Check(!a.Same(other),"Reused identity accepted.");
            });
            Case("Both modes require a selected target and hold it for the whole run",()=>{
                var c=new EntryCoordinator();Check(c.TryBegin("Online",false)==null&&c.TryBegin("Mobile",true)==null,"Entry started without a target.");
                var first=new CostarInstance(1,1,1,1,"A");var second=new CostarInstance(2,2,2,1,"B");c.Select(first);
                using(var active=c.TryBegin("Mobile",true)) {
                    Check(active!=null&&active.Target.Same(first)&&c.Busy,"Mobile lease not bound.");
                    Check(c.TryBegin("Online",false)==null,"Online ran during mobile.");Reject(()=>c.Select(second));
                }
                c.Select(second);using(var active=c.TryBegin("Online",false)){Check(active.Target.Same(second)&&c.TryBegin("Mobile",true)==null,"Mobile ran during online.");}
                Check(!c.Busy,"Coordinator stayed busy.");
            });
            Case("Online tab pauses mobile dispatch without stopping an active lease",()=>{
                var c=new EntryCoordinator();c.Select(new CostarInstance(1,1,1,1,"A"));var active=c.TryBegin("Mobile",true);c.MobilePaused=true;
                Check(c.Busy&&active!=null,"Tab switch discarded active entry.");active.Dispose();Check(c.TryBegin("Mobile",true)==null,"Mobile ignored online tab.");
                using(var online=c.TryBegin("Online",false)){Check(online!=null,"Online tab blocked online entry.");}
                c.MobilePaused=false;using(var next=c.TryBegin("Mobile",true)){Check(next!=null,"Mobile did not resume.");}
            });
            Case("Late lease disposal cannot release a newer entry",()=>{
                var c=new EntryCoordinator();c.Select(new CostarInstance(1,1,1,1,"A"));var old=c.TryBegin("Mobile",true);old.Dispose();
                using(var current=c.TryBegin("Online",false)){old.Dispose();Check(c.Busy&&c.TryBegin("Mobile",true)==null,"Old cleanup released a new entry.");}
            });
            Case("Concurrent online and mobile requests obtain only one lease",()=>{
                var c=new EntryCoordinator();c.Select(new CostarInstance(1,1,1,1,"A"));var leases=new EntryLease[2];
                using(var start=new ManualResetEvent(false)) {
                    var a=new Thread(()=>{start.WaitOne();leases[0]=c.TryBegin("Mobile",true);});
                    var b=new Thread(()=>{start.WaitOne();leases[1]=c.TryBegin("Online",false);});
                    a.Start();b.Start();start.Set();a.Join();b.Join();
                    try{Check(leases.Count(x=>x!=null)==1,"Concurrent requests obtained overlapping leases.");}finally{foreach(var lease in leases)if(lease!=null)lease.Dispose();}
                }
                Check(!c.Busy,"Concurrent test leaked its lease.");
            });
            Case("Closed-order recovery keeps the original job, lease and report",()=>{
                var journal=UnstartedJournal();string before=Wire.Json(journal);Check(MobileRecovery.CanReset(journal),"Unstarted failed job rejected.");
                var fresh=MobileRecovery.FreshCheckpoint(journal);
                Check(fresh.submissionId==journal.job.submissionId&&fresh.planVersion==MobileProof.PlanVersion&&fresh.window==0&&fresh.index==0&&fresh.pending==-1&&fresh.verified==null&&!fresh.opening,"Reset retained an old window or changed job identity.");
                Check(Wire.Json(journal)==before,"Preparing recovery mutated the job, report or old checkpoint.");
                journal.checkpoint=fresh;Check(!MobileRecovery.CanReset(journal),"Recovery could reset the same closed window twice.");
            });
            Case("Closed-order recovery refuses any entered, pending or uncertain progress",()=>{
                var mutations=new Action<MobileCheckpoint>[] {
                    cp=>cp.index=1,cp=>cp.index=-1,cp=>cp.pending=0,cp=>cp.pending=-2,cp=>cp.opening=true,
                    cp=>cp.verified=new MobileView(),cp=>cp.window=0,cp=>cp.processId=0,cp=>cp.processStart=0,
                    cp=>cp.sessionId=-1,cp=>cp.planVersion=0,cp=>cp.planVersion=MobileProof.PlanVersion-1,cp=>cp.submissionId=Job(2).submissionId
                };
                foreach(var mutate in mutations){var journal=UnstartedJournal();mutate(journal.checkpoint);Check(!MobileRecovery.CanReset(journal),"Unsafe progress allowed a reset.");Reject(()=>MobileRecovery.FreshCheckpoint(journal));}
            });
            Case("Closed-order recovery requires a matching failed receipt and lease",()=>{
                foreach(var status in new[]{"injecting","ready_for_review","closed","queued",null}) {
                    var journal=UnstartedJournal();journal.report.status=status;Check(!MobileRecovery.CanReset(journal),"Non-failed receipt allowed recovery.");
                }
                var wrong=UnstartedJournal();wrong.report.submissionId=Job(2).submissionId;Check(!MobileRecovery.CanReset(wrong),"Another job's report accepted.");
                wrong=UnstartedJournal();wrong.report.lease="other-lease";Check(!MobileRecovery.CanReset(wrong),"Another lease accepted.");
                wrong=UnstartedJournal();wrong.checkpoint=null;Check(!MobileRecovery.CanReset(wrong)&&!MobileRecovery.CanReset(null),"Missing progress accepted.");
            });
            Case("Valid mobile job, zero odometer and wire round-trip",()=>{var j=Wire.Copy(Job());j.Validate();Check(j.vehicle.odometer==0&&j.Reference.Length==16,"Job changed.");});
            Case("Missing mandatory customer/vehicle values",()=>{
                var j=Job();j.customer.name="";Reject(()=>j.Validate());j=Job();j.vehicle.odometer=null;Reject(()=>j.Validate());j=Job();j.customer.mobile="abc";Reject(()=>j.Validate());
            });
            Case("Reject invalid, reserved and duplicate product SKUs",()=>{
                foreach(string sku in new[]{"M","DET","WAFR","UNKNOWN","BAD SKU","line\nbreak"}){var j=Job();j.products[0].sku=sku;Reject(()=>j.Validate());}
                var duplicate=Job();duplicate.products.Add(Wire.Copy(duplicate.products[0]));Reject(()=>duplicate.Validate());
            });
            Case("Product count and quantity limits",()=>{
                var j=Job();j.products[0].quantity=0;Reject(()=>j.Validate());j.products[0].quantity=101;Reject(()=>j.Validate());
                j.products.Clear();Reject(()=>j.Validate());j=Job();for(int i=0;i<3;i++)j.products.Add(new MobileProduct{type="wheel",sku="W"+i,quantity=1});Reject(()=>j.Validate());
            });
            Case("Alignment and notes validation",()=>{
                var j=Job();j.alignment="WAFR";j.additionalNotes="Parked outside\nSpare on left";j.Validate();Check(j.Notes=="Parked outside Spare on left","Notes did not flatten safely.");
                j.alignment="REAR";Reject(()=>j.Validate());j.alignment=null;j.additionalNotes="bad\0note";Reject(()=>j.Validate());
            });
            Case("Wheel/tyre/fitting/alignment/DET/note order",()=>{
                var j=Job();j.products.Add(new MobileProduct{type="wheel",sku="TESTWHEEL",quantity=1});j.products.Add(new MobileProduct{type="tyre",sku="TESTREAR",quantity=2});j.alignment="WAFR";j.additionalNotes="Parked outside";
                var p=MobileProof.Plan(j);Check(p.Where(s=>s.kind=="add"||s.kind=="det").Select(s=>s.code).SequenceEqual(new[]{"DET","M","TESTWHEEL","TESTTYRE","TESTREAR","M FB","WAFR"}),"Incorrect item order: DET (and its notes row) first, then wheels, tyres, fitting, alignment.");
                Check(p.Where(s=>s.kind=="add"||s.kind=="det").Select(s=>s.line).SequenceEqual(new[]{7,0,1,2,3,4,5}),"Five item lines must go on lines 1-5 with DET on line 7 (one empty line between).");
                Check(p.Where(s=>s.kind=="memo").Select(s=>s.label).SequenceEqual(new[]{"MAKE/MODEL","REGO NO","ODOMETER"}),"Incorrect details order.");
                Check(j.products[0].sku=="TESTTYRE","Planning mutated source products.");
            });
            Case("No invented alignment or blank additional note",()=>{
                var p=MobileProof.Plan(Job());Check(!p.Any(s=>s.kind=="notes"||s.code=="WA"||s.code=="WAFR"),"Optional data invented.");
                Check(p.Single(s=>s.kind=="memo"&&s.label=="ODOMETER").value=="ODOMETER: 0","Odometer zero omitted.");
                Check(p.Single(s=>s.kind=="det").line==6&&p.Where(s=>s.kind=="add").Select(s=>s.line).SequenceEqual(new[]{1,2}),"One tyre and M FB must go on lines 1-2 with DET on line 6.");
            });
            Case("Phone is the first input and all inserted text is uppercase",()=>{
                var j=Job();j.customer.name="Test customer";j.additionalNotes="Parked outside\nSpare on left";var p=MobileProof.Plan(j);
                Check(p.Take(3).Select(s=>s.kind).SequenceEqual(new[]{"phone","name","reference"}),"Customer lookup is not first.");
                Check(p.Where(s=>s.value!=null).All(s=>s.value==s.value.ToUpperInvariant()),"Lowercase entry planned.");
                Check(p.Single(s=>s.kind=="notes").value=="PARKED OUTSIDE SPARE ON LEFT","Notes were not flattened/capitalised.");
                Check(Order.EntryText("det m fb wa wafr abc tyre@example.com")=="DET M FB WA WAFR ABC TYRE@EXAMPLE.COM","Shared online/mobile text conversion failed.");
                Check(j.customer.name=="Test customer"&&j.additionalNotes.Contains("Parked"),"Planning changed the submitted payload.");
            });
            Case("Phone lookup adopts COSTAR account/name even when the supplied name differs",()=>{
                var before=new MobileView{account="",name="",phone="",reference=""};var after=Wire.Copy(before);
                after.account="C100";after.name="Existing Account Name";after.phone="0400 000 000";
                var phone=MobileProof.Plan(Job())[0];Check(MobileProof.After(phone,before,after),"Existing account with a different name rejected.");
                var name=MobileProof.Plan(Job())[1];Check(MobileProof.After(name,after,Wire.Copy(after)),"Keeping the existing name rejected.");
                var overwritten=Wire.Copy(after);overwritten.name=Job().customer.name;
                Check(!MobileProof.After(name,after,overwritten),"Incoming name replaced the COSTAR name.");
                overwritten=Wire.Copy(after);overwritten.account="C200";Check(!MobileProof.After(name,after,overwritten),"Customer account changed during name entry.");
            });
            Case("No-account lookup uses the submitted name without inventing an account",()=>{
                var before=new MobileView{account="",name="",phone="",reference=""};var found=Wire.Copy(before);found.phone=Job().customer.mobile;
                var p=MobileProof.Plan(Job());Check(MobileProof.After(p[0],before,found),"Not-found phone result rejected.");
                var named=Wire.Copy(found);named.name="TEST CUSTOMER";Check(MobileProof.After(p[1],found,named),"New customer name rejected.");
                named.account="INVENTED";Check(!MobileProof.After(p[1],found,named),"Name entry silently selected an account.");
                Check(!CustomerEntry.HasMatch("","",found.phone,found.phone),"Blank name treated as an existing customer.");
                Check(CustomerEntry.NameForEntry("Existing Name","incoming name")=="Existing Name","Existing name capitalisation was overwritten.");
            });
            Case("Lookup rejects wrong phones, incomplete accounts and unrelated order changes",()=>{
                var before=new MobileView{account="",name="",phone="",reference=""};var after=Wire.Copy(before);var step=MobileProof.Plan(Job())[0];
                after.account="C100";after.name="OTHER NAME";after.phone="0499999999";Check(!MobileProof.After(step,before,after),"Wrong phone accepted.");
                after.phone=step.value;after.name="";Check(!MobileProof.After(step,before,after),"Partially loaded account accepted.");
                after.name="OTHER NAME";after.reference="SOMEONE ELSE";Check(!MobileProof.After(step,before,after),"Lookup changed the order reference.");
                after.reference="";after.rows.Add(Row("TYRE","UNRELATED TYRE","1"));Check(!MobileProof.After(step,before,after),"Lookup changed product rows.");
            });
            Case("Close verifies the retained COSTAR identity, including completed legacy jobs",()=>{
                var j=Job();var cp=new MobileCheckpoint{submissionId=j.submissionId,verified=View()};
                cp.verified.account="C100";cp.verified.name="COSTAR CUSTOMER NAME";var live=Wire.Copy(cp.verified);
                Check(MobileProof.CanClose(j,cp,live),"Original completed checkpoint or matched name could not close.");
                cp.planVersion=MobileProof.PlanVersion;Check(MobileProof.CanClose(j,cp,live),"New completed checkpoint could not close.");
                live.name=j.customer.name;Check(!MobileProof.CanClose(j,cp,live),"Changed name accepted at close.");
                live=Wire.Copy(cp.verified);live.account="DIFFERENT";Check(!MobileProof.CanClose(j,cp,live),"Changed account accepted at close.");
                live=Wire.Copy(cp.verified);live.reference="OTHER";Check(!MobileProof.CanClose(j,cp,live),"Changed reference accepted at close.");
                cp.verified=null;Check(!MobileProof.CanClose(j,cp,live),"Missing verified identity accepted at close.");
            });
            Case("Checkpoint versions prevent replaying legacy steps under the phone-first plan",()=>{
                var cp=new MobileCheckpoint();MobileProof.PrepareCheckpoint(cp);Check(cp.planVersion==MobileProof.PlanVersion,"New checkpoint not versioned.");
                cp.index=3;cp.pending=3;MobileProof.PrepareCheckpoint(cp);
                Reject(()=>MobileProof.PrepareCheckpoint(new MobileCheckpoint{index=1}));
                Reject(()=>MobileProof.PrepareCheckpoint(new MobileCheckpoint{pending=0}));
                Reject(()=>MobileProof.PrepareCheckpoint(new MobileCheckpoint{planVersion=999}));
            });
            Case("Consecutive details only change their own row and preserve the matched customer",()=>{
                var before=View();before.account="C100";before.name="COSTAR CUSTOMER NAME";
                before.rows.AddRange(new[]{Row("DET","Details"),Row("M","MAKE/MODEL:"),Row("M","REGO NO:"),Row("M ODO","ODOMETER:")});
                var after=Wire.Copy(before);after.rows[1].description="MAKE/MODEL: MAZDA MX-5";
                var step=MobileProof.Plan(Job()).Single(s=>s.kind=="memo"&&s.label=="MAKE/MODEL");
                Check(MobileProof.After(step,before,after),"Correct detail with matched name rejected.");
                after.rows[2].description="REGO NO: WRONG";Check(!MobileProof.After(step,before,after),"Adjacent row changed during detail entry.");
                after=Wire.Copy(before);after.rows[1].description="MAKE/MODEL: MAZDA MX-5";after.name="TEST CUSTOMER";
                Check(!MobileProof.After(step,before,after),"Details overwrote matched customer name.");
            });
            Case("Submission replay is idempotent; changed payload conflicts",()=>{
                var q=Queue();var j=Job();q.Submit(j,true);q.Submit(Wire.Copy(j),false);Check(q.List().Count==1&&q.Get(j.submissionId).status=="queued","Replay changed approval.");
                j.products[0].quantity=2;Reject(()=>q.Submit(j,true));Check(q.List()[0].job.products[0].quantity==4,"Conflict changed stored job.");
            });
            Case("Active arrival stays awaiting approval and blocks FIFO",()=>{
                var q=Queue();var first=Job();q.Submit(first,false);q.Submit(Job(2),true);
                for(int i=0;i<3;i++)Check(q.Poll(Hello()).command=="wait","Unapproved job was skipped.");
                q.Approve(first.submissionId);Check(q.Poll(Hello()).job.submissionId==first.submissionId,"Approved job not first.");
            });
            Case("Idle arrival waits for enabled, available worker",()=>{
                var q=Queue();q.Submit(Job(),true);Check(q.Poll(Hello(null,false,true)).command=="wait","Disabled worker assigned.");
                Check(q.Poll(Hello(null,true,false)).command=="wait","Occupied COSTAR assigned.");Check(q.Poll(Hello()).command=="inject","Idle job not assigned.");
            });
            Case("Pinad mode defaults off for new and existing installations",()=>{
                Check(!Queue().PinadMode,"New installation enabled Pinad mode.");
                var q=new JobQueue(Wire.Read<QueueState>("{\"jobs\":[],\"currentId\":null,\"nextRequested\":false}"),s=>{});
                Check(!q.PinadMode&&q.Submit(Job(),false).status=="awaiting_approval","Existing installation changed approval policy.");
                Check(q.Submit(Job(2),true).status=="queued","Idle approval changed.");
            });
            Case("Pinad mode approves waiting and new jobs; switching off affects new arrivals",()=>{
                var q=Queue();q.Submit(Job(),false);q.Submit(Job(2),false);q.SetPinadMode(true);
                Check(q.List().All(r=>r.approved&&r.status=="queued"&&r.version==2),"Waiting jobs were not approved.");
                Check(q.Submit(Job(3),false).status=="queued","Active arrival still required approval.");
                q.SetPinadMode(false);Check(q.Submit(Job(4),false).status=="awaiting_approval","Switching off did not restore approval.");
                Check(q.List().Take(3).All(r=>r.approved),"Switching off revoked existing approvals.");
                Check(q.Poll(Hello()).job.submissionId==Job().submissionId,"Pinad mode changed FIFO order.");
            });
            Case("Pinad mode and waiting approvals persist together or roll back together",()=>{
                QueueState saved=null;bool fail=false;Action<QueueState> save=s=>{if(fail)throw new IOException("Test disk failure");saved=Wire.Copy(s);};
                var q=new JobQueue(null,save);q.Submit(Job(),false);fail=true;
                try{q.SetPinadMode(true);}catch(IOException){}
                Check(!q.PinadMode&&!q.List()[0].approved&&q.Get(Job().submissionId).version==1,"Failed save left approvals active.");
                fail=false;q.SetPinadMode(true);q=new JobQueue(saved,save);
                Check(q.PinadMode&&q.Get(Job().submissionId).status=="queued"&&q.Submit(Job(2),false).status=="queued","Restart lost Pinad mode or approvals.");
                fail=true;try{q.SetPinadMode(false);}catch(IOException){}Check(q.PinadMode,"Failed save disabled Pinad mode only in memory.");
                fail=false;q.SetPinadMode(false);q=new JobQueue(saved,save);
                Check(!q.PinadMode&&q.Submit(Job(3),false).status=="awaiting_approval","Disabled mode was not remembered.");
            });
            Case("Pinad mode waits for entry to finish, then closes before assigning the next job",()=>{
                var q=Queue();q.SetPinadMode(true);q.Submit(Job(),false);q.Submit(Job(2),false);
                Check(q.Poll(Hello(null,false,true)).command=="wait","Stopped worker was bypassed.");
                Check(q.Poll(Hello(null,true,false)).command=="wait","Occupied COSTAR was bypassed.");
                var a=q.Poll(Hello());Check(a.command=="inject","Approved job did not start.");q.Poll(Hello(Report(a,"injecting",1)));
                q.SetPinadMode(false);q.SetPinadMode(true);Check(q.Poll(Hello()).command=="wait","Running entry was repeated.");
                var close=q.Poll(Hello(Report(a,"ready_for_review",2),true,false));
                Check(close.command=="close"&&close.lease==a.lease,"Completed order did not advance automatically.");
                Check(q.Current.job.submissionId==a.job.submissionId&&q.Get(Job(2).submissionId).status=="queued","Next job started before close acknowledgement.");
                var next=q.Poll(Hello(Report(a,"closed",3)));Check(next.command=="inject"&&next.job.submissionId==Job(2).submissionId,"Next job did not start after close.");
            });
            Case("Pinad queue handles late arrivals and enabling after a job is ready",()=>{
                var q=Queue();q.SetPinadMode(true);q.Submit(Job(),false);var a=q.Poll(Hello());
                Check(q.Poll(Hello(Report(a,"ready_for_review",1),true,false)).command=="wait","Last completed window closed without another job.");
                q.SetPinadMode(false);q.Submit(Job(2),false);
                Check(q.Poll(Hello(null,true,false)).command=="wait","Disabled Pinad mode advanced the queue.");
                q.SetPinadMode(true);var wrongWorker=Hello(null,true,false);wrongWorker.workerId="other-worker";
                Check(q.Poll(wrongWorker).command=="wait","Another worker was asked to close this order.");
                Check(q.Poll(Hello(null,true,false)).command=="close","Enabling Pinad mode did not release the ready-order backlog.");
            });
            Case("Automatic close survives restart and lost replies without duplicate jobs",()=>{
                QueueState saved=null;Action<QueueState> save=s=>saved=Wire.Copy(s);var q=new JobQueue(null,save);
                q.SetPinadMode(true);q.Submit(Job(),false);q.Submit(Job(2),false);var a=q.Poll(Hello());var ready=Report(a,"ready_for_review",1);
                var close=q.Poll(Hello(ready,true,false));q=new JobQueue(saved,save);var replay=q.Poll(Hello(ready,true,false));
                Check(close.command=="close"&&replay.command=="close"&&replay.lease==a.lease,"Lost close request was not replayed safely.");
                Check(q.Poll(Hello(ready,false,false)).command=="wait","Stopped worker received a pending close command.");
                var closed=Report(a,"closed",2);Check(q.Poll(Hello(closed,true,false)).command=="wait","Next job opened while COSTAR was occupied.");
                var next=q.Poll(Hello(closed));q=new JobQueue(saved,save);var again=q.Poll(Hello(closed));
                Check(next.command=="inject"&&next.job.submissionId==Job(2).submissionId&&again.command=="inject"&&again.lease==next.lease,"Lost acknowledgement duplicated or closed the next order.");
                Check(q.Get(a.job.submissionId).status=="ready_for_review"&&q.List()[0].closed,"Completed receipt disappeared.");
            });
            Case("Automatic close and advance roll back if persistence fails",()=>{
                bool fail=false;QueueState saved=null;var q=new JobQueue(null,s=>{if(fail)throw new IOException("Test disk failure");saved=Wire.Copy(s);});
                q.SetPinadMode(true);q.Submit(Job(),false);q.Submit(Job(2),false);var a=q.Poll(Hello());
                fail=true;try{q.Poll(Hello(Report(a,"ready_for_review",1),true,false));}catch(IOException){}
                Check(q.Current.status=="injecting"&&!saved.nextRequested,"Failed save committed an automatic close.");
                fail=false;Check(q.Poll(Hello(Report(a,"ready_for_review",1),true,false)).command=="close","Close could not resume after saving recovered.");
                fail=true;try{q.Poll(Hello(Report(a,"closed",2)));}catch(IOException){}
                Check(!q.List()[0].closed&&q.Current.job.submissionId==a.job.submissionId&&q.Get(Job(2).submissionId).status=="queued","Failed save advanced the queue.");
                fail=false;Check(q.Poll(Hello(Report(a,"closed",2))).job.submissionId==Job(2).submissionId,"Saved close acknowledgement could not be retried.");
            });
            Case("Pinad mode drains a three-job queue and retains completed receipts",()=>{
                var q=Queue();q.SetPinadMode(true);for(int n=1;n<=3;n++)q.Submit(Job(n),false);var a=q.Poll(Hello());
                for(int n=1;n<=3;n++) {
                    Check(a.command=="inject"&&a.job.submissionId==Job(n).submissionId,"Queue order changed.");
                    var reply=q.Poll(Hello(Report(a,"ready_for_review",1),true,false));
                    if(n<3) {Check(reply.command=="close","Completed job blocked the batch.");a=q.Poll(Hello(Report(a,"closed",2)));}
                    else Check(reply.command=="wait","Final completed job closed unnecessarily.");
                }
                Check(q.List().Count(r=>r.closed)==2&&q.List().All(r=>r.status=="ready_for_review"),"Completed jobs were lost or marked reviewed.");
                Check(q.List().Take(2).All(r=>r.message.Contains("Review in COSTAR")),"Completed jobs have no review reminder.");
            });
            Case("Pinad mode does not retry failed jobs or duplicate submissions",()=>{
                var q=Queue();q.SetPinadMode(true);var job=Job();q.Submit(job,false);var a=q.Poll(Hello());q.Poll(Hello(Report(a,"failed",1)));
                q.SetPinadMode(false);q.SetPinadMode(true);q.Submit(Wire.Copy(job),false);
                Check(q.List().Count==1&&q.Get(job.submissionId).status=="failed"&&q.Poll(Hello()).command=="wait","Failure retried or submission duplicated.");
                job.products[0].quantity=2;Reject(()=>q.Submit(job,false));
                Check(q.List()[0].job.products[0].quantity==4,"Pinad mode accepted a changed replay.");
            });
            Case("Lost claim reply replays the same persisted lease",()=>{
                QueueState saved=null;var q=new JobQueue(null,s=>saved=Wire.Copy(s));q.Submit(Job(),true);var first=q.Poll(Hello());
                q=new JobQueue(saved,s=>{});var again=q.Poll(Hello());Check(again.command=="inject"&&again.lease==first.lease&&again.job.submissionId==first.job.submissionId,"Claim was duplicated or lost.");
            });
            Case("Worker acknowledgements and progress are idempotent",()=>{
                var q=Queue();q.Submit(Job(),true);var a=q.Poll(Hello());var p=Report(a,"injecting",1);q.Poll(Hello(p));
                int version=q.Get(a.job.submissionId).version;q.Poll(Hello(p));Check(q.Get(a.job.submissionId).version==version,"Duplicate progress advanced version.");
                p.sequence=2;p.status="failed";q.Poll(Hello(p));q.Poll(Hello(Report(a,"injecting",1)));Check(q.Get(a.job.submissionId).status=="failed","Old progress replaced failure.");
            });
            Case("Failed retry reuses lease and replays a lost retry reply",()=>{
                var q=Queue();q.Submit(Job(),true);var a=q.Poll(Hello());var p=Report(a,"failed",1);q.Poll(Hello(p));q.Retry(a.job.submissionId);
                var retry=q.Poll(Hello(p));var replay=q.Poll(Hello(p));Check(retry.command=="inject"&&retry.lease==a.lease&&replay.command=="inject"&&replay.lease==a.lease,"Retry lost or duplicated assignment.");
            });
            Case("Wrong worker or lease cannot change a receipt",()=>{
                var q=Queue();q.Submit(Job(),true);var a=q.Poll(Hello());var p=Report(a,"ready_for_review",1);p.lease="wrong";Reject(()=>q.Poll(Hello(p)));
                var h=Hello(Report(a,"ready_for_review",1));h.workerId="other";Reject(()=>q.Poll(h));Check(q.Get(a.job.submissionId).status=="injecting","Bad report changed state.");
            });
            Case("Ready remains ready and the next job waits for Next Order",()=>{
                var q=Queue();q.Submit(Job(),true);q.Submit(Job(2),true);var a=q.Poll(Hello());q.Poll(Hello(Report(a,"ready_for_review",1)));
                q.Poll(Hello(Report(a,"failed",2)));Check(q.Get(a.job.submissionId).status=="ready_for_review","Ready regressed.");
                Check(q.Poll(Hello()).command=="wait"&&q.Current.job.submissionId==a.job.submissionId,"Next opened without review.");
            });
            Case("Next Order closes current before assigning next; lost close ack is harmless",()=>{
                var q=Queue();q.Submit(Job(),true);q.Submit(Job(2),false);var a=q.Poll(Hello());q.Poll(Hello(Report(a,"ready_for_review",1)));q.Next();
                var close=q.Poll(Hello());Check(close.command=="close"&&close.lease==a.lease,"Wrong order selected for close.");
                var ack=Report(a,"closed",2);var next=q.Poll(Hello(ack));Check(next.command=="inject"&&next.job.submissionId==Job(2).submissionId,"Next order not assigned after close.");
                var again=q.Poll(Hello(ack));Check(again.command=="inject"&&again.lease==next.lease,"Repeated close ack changed the next assignment.");
                Check(q.Get(a.job.submissionId).status=="ready_for_review"&&q.List()[0].closed,"Phone's completed receipt was lost.");
            });
            Case("Premature close acknowledgement is refused",()=>{
                var q=Queue();q.Submit(Job(),true);var a=q.Poll(Hello());Reject(()=>q.Poll(Hello(Report(a,"closed",1))));Check(q.Current!=null,"Premature close cleared current job.");
            });
            Case("Failed persistence rolls back queue mutations",()=>{
                bool fail=true;var q=new JobQueue(null,s=>{if(fail)throw new IOException("Test disk failure");});
                try{q.Submit(Job(),true);}catch(IOException){}Check(q.List().Count==0,"Failed receipt remained in memory.");
                fail=false;q.Submit(Job(),true);fail=true;try{q.Poll(Hello());}catch(IOException){}
                Check(q.Current==null&&q.Get(Job().submissionId).status=="queued","Unpersisted claim remained active.");
            });
            Case("Windows private storage survives an atomic replacement",()=>{
                string directory=Path.Combine(Path.GetTempPath(),"TempeMobile-selftest-"+Guid.NewGuid().ToString("N"));
                try {
                    PrivateFiles.DirectoryReady(directory);string file=Path.Combine(directory,"test.dat");
                    var j=Job();PrivateFiles.Save(file,j);Check(PrivateFiles.Load<MobileJob>(file).products[0].quantity==4,"Encrypted round-trip failed.");
                    Check(!Encoding.UTF8.GetString(File.ReadAllBytes(file)).Contains("TEST CUSTOMER"),"Plain customer data was persisted.");
                    j.products[0].quantity=2;PrivateFiles.Save(file,j);Check(PrivateFiles.Load<MobileJob>(file).products[0].quantity==2,"Atomic replacement failed.");
                    j.products[0].quantity=3;PrivateFiles.Save(file,j,false);Check(PrivateFiles.Load<MobileJob>(file).products[0].quantity==3,"Checkpoint save without a forced flush failed.");
                    Check(Directory.GetFiles(directory).Length==1,"Temporary persistence file remained.");
                } finally {if(Directory.Exists(directory))Directory.Delete(directory,true);}
            });
            Case("Snapshots accept exactly one resolved product row",()=>{
                var before=View();var after=Wire.Copy(before);after.rows.Add(Row("TESTTYRE","TEST TYRE","1"));var step=new MobileStep{kind="add",code="TESTTYRE"};
                Check(MobileProof.After(step,before,after),"Correct product rejected.");after.rows.Add(Row("TESTTYRE","TEST TYRE","1"));Check(!MobileProof.After(step,before,after),"Duplicate product accepted.");
            });
            Case("Snapshots reject unrelated customer or row changes",()=>{
                var before=View();before.rows.Add(Row("TESTTYRE","TEST TYRE","1"));var after=Wire.Copy(before);after.rows[0].quantity="4";var step=new MobileStep{kind="quantity",code="TESTTYRE",quantity=4};
                Check(MobileProof.After(step,before,after),"Correct quantity rejected.");after.name="SOMEONE ELSE";Check(!MobileProof.After(step,before,after),"Customer overwrite accepted.");
                after=Wire.Copy(before);after.rows[0].quantity="4";after.rows[0].description="OTHER PRODUCT";Check(!MobileProof.After(step,before,after),"Unexpected row change accepted.");
            });
            Case("Alignment must resolve to the matching front/rear service",()=>{
                var before=View();var after=Wire.Copy(before);after.rows.Add(Row("WAFR","Wheel Alignment (Front & Rear)","1"));
                Check(MobileProof.After(new MobileStep{kind="add",code="WAFR"},before,after),"WAFR rejected.");
                after.rows[0].code="WA";Check(!MobileProof.After(new MobileStep{kind="add",code="WA"},before,after),"Rear alignment accepted as WA.");
            });
            Case("DET requires all three details with odometer below rego",()=>{
                var before=View();var after=Wire.Copy(before);after.rows.AddRange(new[]{Row("DET","Details"),Row("M","MAKE/MODEL:"),Row("M","REGO NO:"),Row("M ODO","ODOMETER:")});
                var step=new MobileStep{kind="det"};Check(MobileProof.After(step,before,after),"Recorded DET template rejected.");
                var hold=after.rows[2];after.rows[2]=after.rows[3];after.rows[3]=hold;Check(!MobileProof.After(step,before,after),"Misordered DET accepted.");
            });
            Case("Interrupted writes reconcile exact before/after only",()=>{
                var before=View();var after=Wire.Copy(before);var step=new MobileStep{kind="reference",value="MJC-ABCDEF123456"};
                Check(MobileProof.Same(before,after),"Unchanged checkpoint not recognised.");after.reference=step.value;Check(MobileProof.After(step,before,after),"Completed step not recognised.");
                after.reference="MJC-ABC";Check(!MobileProof.Same(before,after)&&!MobileProof.After(step,before,after),"Partial write would be replayed.");
            });
            Case("DET goes on its line with its notes directly under it; items go on their planned lines above",()=>{
                Func<string,string,int,string,MobileRow> at=(code,description,line,quantity)=>new MobileRow{code=code,description=description,line=line,quantity=quantity??""};
                var j=Job();var plan=MobileProof.Plan(j);
                var det=plan.Single(s=>s.kind=="det");Check(det.line==6,"DET must go on line 6 for one tyre and M FB.");
                var before=View();var after=Wire.Copy(before);
                after.rows.AddRange(new[]{at("DET","Details",6,null),at("M","MAKE/MODEL:",7,null),at("M","REGO NO:",8,null),at("M ODO","ODOMETER:",9,null)});
                Check(MobileProof.After(det,before,after),"DET on line 6 with notes on 7-9 rejected.");
                var low=Wire.Copy(before);low.rows.AddRange(new[]{at("DET","Details",1,null),at("M","MAKE/MODEL:",2,null),at("M","REGO NO:",3,null),at("M ODO","ODOMETER:",4,null)});
                Check(!MobileProof.After(det,before,low),"DET on line 1 accepted although line 6 was planned.");
                var gap=Wire.Copy(before);gap.rows.AddRange(new[]{at("DET","Details",6,null),at("M","MAKE/MODEL:",7,null),at("M","REGO NO:",9,null),at("M ODO","ODOMETER:",10,null)});
                Check(!MobileProof.After(det,before,gap),"DET notes with a gap under DET accepted.");
                var split=Wire.Copy(before);split.rows.AddRange(new[]{at("M","MAKE/MODEL:",1,null),at("DET","Details",6,null),at("M","REGO NO:",7,null),at("M ODO","ODOMETER:",8,null)});
                Check(!MobileProof.After(det,before,split),"A DET note above DET accepted.");
                // The tyre then goes on line 1, above DET.
                var tyre=plan.First(s=>s.kind=="add"&&s.code=="TESTTYRE");Check(tyre.line==1,"The first item must be planned on line 1.");
                var withTyre=Wire.Copy(after);withTyre.rows.Insert(0,at("TESTTYRE","TEST TYRE",1,"1"));
                Check(MobileProof.After(tyre,after,withTyre),"Tyre on line 1 above DET rejected.");
                var wrongLine=Wire.Copy(after);wrongLine.rows.Insert(0,at("TESTTYRE","TEST TYRE",2,"1"));
                Check(!MobileProof.After(tyre,after,wrongLine),"Tyre on line 2 accepted although line 1 was planned.");
                var below=Wire.Copy(after);below.rows.Add(at("TESTTYRE","TEST TYRE",10,"1"));
                Check(!MobileProof.After(tyre,after,below),"Tyre below DET accepted.");
                var twice=Wire.Copy(withTyre);twice.rows.Insert(1,at("TESTTYRE","TEST TYRE",2,"1"));
                Check(!MobileProof.After(tyre,after,twice),"Two new rows accepted for one item.");
                var moved=Wire.Copy(withTyre);moved.rows[2].description="MAKE/MODEL: CHANGED";
                Check(!MobileProof.After(tyre,after,moved),"A DET note changed while adding an item, but it was accepted.");
                // Quantity on the tyre and M FB on line 2 keep everything in place.
                var qty=plan.First(s=>s.kind=="quantity"&&s.code=="TESTTYRE");var withQty=Wire.Copy(withTyre);withQty.rows[0].quantity="4";
                Check(MobileProof.After(qty,withTyre,withQty),"Quantity on the line-1 tyre rejected.");
                var fb=plan.First(s=>s.kind=="add"&&s.code=="M FB");var withFb=Wire.Copy(withQty);withFb.rows.Insert(1,at("M FB","FIT AND BALANCE",2,""));
                Check(fb.line==2&&MobileProof.After(fb,withQty,withFb),"M FB on line 2 rejected.");
                Check(withFb.rows.Select(r=>r.line).SequenceEqual(new[]{1,2,6,7,8,9}),"Final layout must be items on 1-2, gap, DET on 6, notes 7-9.");
            });
            Case("Line numbers are only trusted on an evenly spaced grid; long orders move DET down",()=>{
                Func<long,int,ControlInfo> box=(h,y)=>new ControlInfo{Handle=h,Parent=1,Class="WindowsForms10.EDIT.app.0.1",Visible=true,Enabled=true,Bounds=new[]{378,y,128,18},RelativeBounds=new[]{378,y,128,18},Text="",TextState="read"};
                var even=new Grid{Rows=Enumerable.Range(0,25).Select(i=>box(100+i,369+19*i)).ToList()};
                Check(even.EvenLines&&even.LineOf(100)==1&&even.LineOf(105)==6&&even.LineOf(124)==25&&even.LineOf(999)==0,"Line numbers of COSTAR's 25 evenly spaced lines are wrong.");
                var missing=new Grid{Rows=even.Rows.Where(r=>r.Handle!=102).ToList()};
                Check(!missing.EvenLines,"A grid with a missing line (disabled or hidden) must not be trusted for line numbers.");
                Check(Order.DetLine(2)==6&&Order.DetLine(4)==6&&Order.DetLine(5)==7&&Order.DetLine(14)==16,"DET line rule: line 6, or lower so one empty line stays above DET.");
            });
            Case("A mobile job from the old plan continues only if it has not started a step",()=>{
                var fresh=new MobileCheckpoint{planVersion=2};MobileProof.PrepareCheckpoint(fresh);
                Check(fresh.planVersion==MobileProof.PlanVersion,"An unstarted old-plan job was not moved to the new plan.");
                Reject(()=>MobileProof.PrepareCheckpoint(new MobileCheckpoint{planVersion=2,index=4}));
                Reject(()=>MobileProof.PrepareCheckpoint(new MobileCheckpoint{planVersion=2,pending=0}));
                var verified=new MobileCheckpoint{planVersion=2,verified=View()};verified.verified.rows.Add(Row("TESTTYRE","TEST TYRE","4"));
                Reject(()=>MobileProof.PrepareCheckpoint(verified));
            });
            Case("Pickups from other stores (schema 3) must name their store; unknown order types are refused",()=>{
                string json="{\"schema\":3,\"store\":\"Silverwater NSW\",\"createdUtc\":\"2026-10-09T00:00:00Z\",\"orderId\":\"TTW100\",\"customer\":{\"name\":\"TEST CUSTOMER\",\"phone\":\"0400000000\"},\"rego\":\"\",\"vehicle\":\"TEST VEHICLE\",\"pickupDate\":\"2026-10-10\",\"pickupTime\":\"10:30\",\"comment\":\"SATURDAY - ONLINE 10:30\",\"totalCents\":14000,\"lines\":[{\"kind\":\"product\",\"sourceSku\":\"TEST123\",\"code\":\"TEST123\",\"description\":\"TEST TYRE\",\"quantity\":1,\"unitCents\":14000,\"totalCents\":14000}]}";
                var other=Wire.Read<Order>(json);other.Validate(false);
                Check(other.store=="Silverwater NSW"&&!other.IsDelivery,"A schema-3 pickup was not read as a pickup with its store.");
                other.store="";Reject(()=>other.Validate(false));
                var unknown=Wire.Read<Order>(json);unknown.schema=4;Reject(()=>unknown.Validate(false));
                var tempe=Wire.Read<Order>(json);tempe.schema=1;tempe.store="Tempe NSW";tempe.Validate(false);
                var old=Wire.Read<Order>(json);old.schema=1;old.store=null;old.Validate(false);
            });
            Case("Notes can only edit the intended final M row",()=>{
                var before=View();before.rows.Add(Row("M",""));var after=Wire.Copy(before);after.rows[0].description="Parked outside";
                Check(MobileProof.After(new MobileStep{kind="notes",value="Parked outside"},before,after),"Correct note rejected.");
                after.rows.Add(Row("M","duplicate"));Check(!MobileProof.After(new MobileStep{kind="notes",value="Parked outside"},before,after),"Extra note accepted.");
            });
            Case("Receiver network and Tempe proxy boundaries",()=>{
                Check(NetworkRules.Private(IPAddress.Parse("192.168.1.2"))&&!NetworkRules.Private(IPAddress.Parse("8.8.8.8")),"Private network check failed.");
                Check(NetworkRules.TyreUrl(new Uri("https://www.tempetyres.com.au/tyres?width=205")),"Tempe search rejected.");
                foreach(string url in new[]{"https://example.com/tyres","http://tempetyres.com.au/tyres","https://tempetyres.com.au:444/tyres","https://tempetyres.com.au/admin","https://user@tempetyres.com.au/tyres"})
                    Check(!NetworkRules.TyreUrl(new Uri(url)),"Unsafe proxy target accepted.");
                Reject(()=>NetworkRules.Worker(new WorkerSettings{baseUrl="https://8.8.8.8",token=new string('x',43),workerId="test",certificateHash=new string('A',64)}));
                Check(NetworkRules.Website("https://example.com/helper")=="https://example.com/helper/Fitment_Planner.html","Website path was lost.");
            });
            Case("API authentication, origin and status contract",()=>{
                var settings=new ReceiverSettings{address="192.168.1.2",phoneToken="phone-test",workerToken="worker-test",workerId="test-worker",webUrl="https://example.com/Fitment_Planner.html"};
                var q=Queue();var api=new ReceiverApi(settings,q,Path.GetTempPath(),()=>false,id=>{});
                const string root="/api/mobile/v1";
                Check(api.Handle(Request("GET",root+"/health",null)).status==401,"Unauthenticated health exposed.");
                Check(api.Handle(Request("GET",root+"/health","phone-test","https://unpaired.example")).status==403,"Unpaired origin allowed.");
                var cors=api.Handle(Request("OPTIONS",root+"/jobs",null,"https://example.com"));Check(cors.status==204&&cors.headers["Access-Control-Allow-Origin"]=="https://example.com","Pairing preflight failed.");
                Check(api.Handle(Request("POST","/api/worker/v1/poll","worker-test",null,Hello())).status==200,"Worker hello rejected.");
                var posted=api.Handle(Request("POST",root+"/jobs","phone-test",null,Job()));Check(posted.status==200,"Mobile job rejected.");
                var status=Wire.Read<JobStatus>(Encoding.UTF8.GetString(posted.bytes));Check(status.status=="awaiting_approval"&&status.version==1,"Status contract mismatched.");
                var changed=Job();changed.products[0].quantity=2;Check(api.Handle(Request("POST",root+"/jobs","phone-test",null,changed)).status==409,"API conflict not reported.");
                settings.phoneToken="rotated";Check(api.Handle(Request("GET",root+"/health","phone-test")).status==401,"Revoked phone key accepted.");
            });
            Case("Pinad mode works through phone API and still respects Stop receiving",()=>{
                var settings=new ReceiverSettings{address="192.168.1.2",phoneToken="phone-test",workerToken="worker-test",workerId="test-worker"};
                var q=Queue();q.SetPinadMode(true);int incoming=0;var api=new ReceiverApi(settings,q,Path.GetTempPath(),()=>false,id=>incoming++);
                const string jobs="/api/mobile/v1/jobs",poll="/api/worker/v1/poll";
                Check(api.Handle(Request("POST",jobs,"phone-test",null,Job())).status==400,"Offline worker accepted a new job.");
                api.Handle(Request("POST",poll,"worker-test",null,Hello()));
                var posted=api.Handle(Request("POST",jobs,"phone-test",null,Job()));
                Check(posted.status==200&&Wire.Read<JobStatus>(Encoding.UTF8.GetString(posted.bytes)).status=="queued","Phone job required approval in Pinad mode.");
                api.Handle(Request("POST",jobs,"phone-test",null,Job()));Check(q.List().Count==1&&incoming==1,"Phone replay created work twice.");
                api.Receiving=false;var held=api.Handle(Request("POST",poll,"worker-test",null,Hello()));
                Check(Wire.Read<WorkerReply>(Encoding.UTF8.GetString(held.bytes)).command=="wait","Stop receiving was bypassed.");
                Check(api.Handle(Request("POST",jobs,"phone-test",null,Job(2))).status==400,"Stopped receiver accepted a new job.");
                api.Receiving=true;var started=api.Handle(Request("POST",poll,"worker-test",null,Hello()));
                Check(Wire.Read<WorkerReply>(Encoding.UTF8.GetString(started.bytes)).command=="inject","Resuming did not start the approved job.");
            });
            Case("Stop receiving pauses automatic close through the worker API",()=>{
                var settings=new ReceiverSettings{address="192.168.1.2",phoneToken="phone-test",workerToken="worker-test",workerId="test-worker"};
                var q=Queue();q.SetPinadMode(true);q.Submit(Job(),false);q.Submit(Job(2),false);var a=q.Poll(Hello());
                var api=new ReceiverApi(settings,q,Path.GetTempPath(),()=>false,id=>{});const string poll="/api/worker/v1/poll";
                api.Receiving=false;var ready=Report(a,"ready_for_review",1);
                var stopped=api.Handle(Request("POST",poll,"worker-test",null,Hello(ready,true,false)));
                Check(Wire.Read<WorkerReply>(Encoding.UTF8.GetString(stopped.bytes)).command=="wait","Stopped receiver requested automatic close.");
                api.Receiving=true;var resumed=api.Handle(Request("POST",poll,"worker-test",null,Hello(ready,true,false)));
                Check(Wire.Read<WorkerReply>(Encoding.UTF8.GetString(resumed.bytes)).command=="close","Resuming did not continue the queue.");
                api.Receiving=false;var paused=api.Handle(Request("POST",poll,"worker-test",null,Hello(ready,true,false)));
                Check(Wire.Read<WorkerReply>(Encoding.UTF8.GetString(paused.bytes)).command=="wait","Pending close ignored Stop receiving.");
            });
            Case("Deleting a completed entry persists without losing its receipt or replay protection",()=>{
                QueueState saved=null;var q=new JobQueue(null,s=>saved=Wire.Copy(s));var job=Job();q.Submit(job,true);var a=q.Poll(Hello());
                q.Poll(Hello(Report(a,"ready_for_review",1)));string receipt=Wire.Json(q.Get(job.submissionId));q.DeleteCompleted(job.submissionId);
                q=new JobQueue(saved,s=>{});Check(q.List()[0].hiddenFromList,"Deleted entry returned after restart.");
                Check(Wire.Json(q.Get(job.submissionId))==receipt&&Wire.Json(q.Submit(Wire.Copy(job),false))==receipt,"Deletion changed the phone receipt or accepted a duplicate.");
                Check(q.List().Count==1&&q.Poll(Hello()).command=="wait","Deletion created another order.");
                job.products[0].quantity=2;Reject(()=>q.Submit(job,false));
            });
            Case("Removing the current completed entry preserves automatic and manual queue progression",()=>{
                foreach(bool pinad in new[]{false,true}) {
                    var q=Queue();q.SetPinadMode(pinad);q.Submit(Job(),true);var a=q.Poll(Hello());q.Poll(Hello(Report(a,"ready_for_review",1)));
                    q.DeleteCompleted(a.job.submissionId);Check(q.Current.job.submissionId==a.job.submissionId,"List cleanup lost the current worker job.");
                    q.Submit(Job(2),true);if(!pinad)q.Next();
                    Check(q.Poll(Hello(null,true,false)).command=="close","Removed entry blocked normal closure.");
                    var next=q.Poll(Hello(Report(a,"closed",2)));
                    Check(next.command=="inject"&&next.job.submissionId==Job(2).submissionId&&q.List()[0].hiddenFromList,"Cleanup broke progression or restored the removed row.");
                }
            });
            Case("Clear completed removes all history including older rows while retaining pending jobs",()=>{
                var q=Queue();q.SetPinadMode(true);for(int n=1;n<=22;n++)q.Submit(Job(n),true);var a=q.Poll(Hello());
                for(int n=1;n<=22;n++) {q.Poll(Hello(Report(a,"ready_for_review",1),true,false));if(n<22)a=q.Poll(Hello(Report(a,"closed",2)));}
                q.SetPinadMode(false);q.Submit(Job(23),false);q.Submit(Job(24),true);q.ClearCompleted();
                Check(q.List().Count(r=>r.hiddenFromList)==22,"Bulk cleanup left older completed rows visible.");
                Check(q.List().Where(r=>!r.hiddenFromList).Select(r=>r.status).SequenceEqual(new[]{"awaiting_approval","queued"}),"Bulk cleanup removed pending work.");
                Check(q.Current.job.submissionId==Job(22).submissionId,"Bulk cleanup lost the last completed worker job.");
            });
            Case("Unfinished jobs stay visible and failed cleanup saves roll back",()=>{
                bool fail=false;var q=new JobQueue(null,s=>{if(fail)throw new IOException("Test disk failure");});var job=Job();
                q.Submit(job,false);Reject(()=>q.DeleteCompleted(job.submissionId));q.Approve(job.submissionId);Reject(()=>q.DeleteCompleted(job.submissionId));
                var a=q.Poll(Hello());Reject(()=>q.DeleteCompleted(job.submissionId));q.Poll(Hello(Report(a,"failed",1)));Reject(()=>q.DeleteCompleted(job.submissionId));
                q.ClearCompleted();Check(!q.List()[0].hiddenFromList,"Failed job was hidden.");
                q.Retry(job.submissionId);q.Poll(Hello());q.Poll(Hello(Report(a,"ready_for_review",2)));fail=true;
                try{q.DeleteCompleted(job.submissionId);}catch(IOException){}Check(!q.List()[0].hiddenFromList,"Failed save hid the selected entry.");
                try{q.ClearCompleted();}catch(IOException){}Check(!q.List()[0].hiddenFromList,"Failed save hid completed entries.");
            });
            Case("Diagnostics mask customer details, classify stops and summarise runs",()=>{
                string masked=Sanitize.Text("Call 0400 123 456 or test.person@example.com about TTW1730342 / 2054517ST005",200);
                Check(!masked.Contains("0400")&&!masked.Contains("@")&&masked.Contains("TTW1730342")&&masked.Contains("2054517ST005"),"Phone/email were not masked, or order/SKU codes were lost: "+masked);
                string title=Sanitize.Text("Blocking/foreground window: Jane Citizen - Inbox (PID 4321). Leave the original Repair Order in front.",200);
                Check(!title.Contains("Jane")&&title.Contains("[title removed]"),"Another application's window title was not removed.");
                Check(StopCategory.Of("COSTAR lost focus or opened another screen. Entry stopped; check the current form.",false)=="focus_stolen","Focus loss was not classified.");
                Check(StopCategory.Of("COSTAR did not focus the expected field.",false)=="focus_failed","Focus failure was not classified.");
                Check(StopCategory.Of("Direct entry must start without a selected customer account.",false)=="repair_order_not_empty","A non-empty Repair Order was not classified.");
                Check(StopCategory.Of("Stopped by you. Check the partially filled order in COSTAR.",true)=="user_stop","A user stop was not classified.");
                Check(StopCategory.Of("Something new happened.",false)=="other","Unknown stops must remain visible as other.");
                Check(DiagnosticsBundle.StageGroup("Add tyre 2054517ST005")=="Add tyre *"&&DiagnosticsBundle.StageGroup("Item WAFR")=="Item WAFR","SKU stages were not grouped.");
                var ok=new RunReport{Schema=1,Version="test",RunId="20261003-090000-MJC-TEST-aaaaaa",Kind="mobile",OrderRef="MJC-TEST",Outcome="completed",Category="ok",TotalMs=10000};
                ok.Stages.Add(new StageStat{Stage="Add tyre 2054517ST005",DurationMs=1100,Completed=true});
                ok.Waits.Add(new WaitStat{Name="item_load",Ms=900,Iterations=12,Result="ok"});
                var stopped=new RunReport{Schema=1,Version="test",RunId="20261003-091000-TTW1-bbbbbb",Kind="online-pickup",OrderRef="TTW1, \"quoted\"",Outcome="stopped",Category="focus_failed",
                    StopStage="Customer and order header",StopMessage="COSTAR did not focus the expected field.",TotalMs=3500};
                stopped.Events.Add(new DiagEvent{Kind="foreground_lost",Detail="process=chrome class=Chrome_WidgetWin_1"});
                var reports=new List<RunReport>{ok,stopped};
                string summary=DiagnosticsBundle.Summary(reports);
                Check(summary.Contains("1 of 2")&&summary.Contains("focus_failed")&&summary.Contains("Add tyre *")&&summary.Contains("chrome x1"),"Summary is missing outcome, stop, stage or focus totals.");
                var lines=DiagnosticsBundle.Csv(reports).Split(new[]{"\r\n"},StringSplitOptions.RemoveEmptyEntries);
                Check(lines.Length==3&&lines[2].Contains("\"TTW1, \"\"quoted\"\"\""),"CSV rows or quoting are wrong.");
                var copy=Wire.Read<RunReport>(Wire.Json(stopped));
                Check(copy.Events.Count==1&&copy.StopStage==stopped.StopStage&&copy.Env!=null&&copy.Probe!=null,"Diagnostics did not round-trip through JSON.");
            });
            Case("Diagnostics name the running stage on a stop and recognise successful lookups",()=>{
                var d=new RunDiagnostics("20261003-100000-TTW1-cccccc","TTW1",IntPtr.Zero,0);
                d.BeginStage("Customer phone lookup");d.EndStage(false);
                d.Stopped(new InvalidOperationException("Could not uniquely locate customer name/account label in this COSTAR layout (0 matches)."));
                d.Finish(1000,0,0,0,0,0,0);
                var r=d.Report;
                Check(r.Outcome=="stopped"&&r.Category=="layout"&&r.StopStage=="Customer phone lookup","The stop was not attributed to the stage that was running.");
                Check(r.BetweenStages!=null&&r.BetweenStagesMs==1000-r.Stages.Sum(s=>s.DurationMs),"Time between steps was not recorded.");
                Check(DiagnosticsBundle.WaitSucceeded("existing-customer")&&DiagnosticsBundle.WaitSucceeded("new-customer-after-popup")&&DiagnosticsBundle.WaitSucceeded("ok-attempt-2")&&
                    !DiagnosticsBundle.WaitSucceeded("timeout")&&!DiagnosticsBundle.WaitSucceeded("stopped"),"Wait outcomes were misread.");
            });
            Case("Grid read plan covers labels and their columns; skipped text still reads on demand",()=>{
                Func<long,long,string,int,int,int,int,string,ControlInfo> mk=(h,parent,cls,x,y,w,hh,text)=>new ControlInfo{Handle=h,Parent=parent,Class=cls,Visible=true,Enabled=true,
                    Bounds=new[]{x,y,w,hh},RelativeBounds=new[]{x,y,w,hh},Text=text,TextState="read"};
                const string ST="WindowsForms10.STATIC.app.0.1",ED="WindowsForms10.EDIT.app.0.1";
                var s=new List<ControlInfo>{mk(1,9,ST,70,100,40,18,"ITEM"),mk(2,9,ST,225,100,90,18,"DESCRIPTION"),mk(3,9,ST,730,100,60,18,"QTY OR HRS"),
                    mk(4,9,ST,834,100,40,18,"NET"),mk(5,9,ST,938,100,40,18,"LIST"),mk(50,9,"WindowsForms10.Window.8.app.0.1",60,128,960,24,null),
                    mk(10,50,ED,71,130,120,20,"TYRE1"),mk(11,50,ED,226,130,300,20,"A TYRE"),mk(12,50,ED,731,130,50,20,"4"),
                    mk(13,50,ED,500,130,60,20,"X"),mk(14,9,ST,300,160,90,18,"cell text"),mk(15,50,"WindowsForms10.BUTTON.app.0.1",990,130,20,20,"...")};
                var want=Selectors.GridReadSet(s,new long[]{1,2,3,4,5});
                Check(want!=null && want.SetEquals(new long[]{1,2,3,4,5,10,11,12}),"The grid read plan must cover exactly the labels and the item/description/quantity/net/list cells.");
                Check(Selectors.GridReadSet(s,new long[]{1,2,3,4,99})==null,"A missing remembered label must fall back to reading everything.");
                int reads=0;
                var lazy=new ControlInfo{Handle=20,Class=ED,Visible=true,Enabled=true,Bounds=new[]{0,0,50,20},RelativeBounds=new[]{0,0,50,20},TextState="skipped"};
                lazy.Late=x=>{reads++;x.Text="LIVE";x.TextState="read";};
                Check(lazy.Peek==null && reads==0,"Peeking must not read a skipped field.");
                Check(lazy.Value=="LIVE" && lazy.Value=="LIVE" && reads==1,"A skipped field must be read once, on first use.");
                var skippedLabel=s.Select(x=>x.Handle!=14?x:new ControlInfo{Handle=14,Parent=9,Class=ST,Visible=true,Enabled=true,Bounds=x.Bounds,RelativeBounds=x.RelativeBounds,
                    TextState="skipped",Late=y=>{reads+=100;}}).ToList();
                var grid=Selectors.ProductGrid(skippedLabel);
                Check(reads==1 && grid.Rows.Count==1 && grid.Rows[0].Value=="TYRE1","Finding the grid must not read skipped display labels.");
            });
            Case("Two accounts on one phone: the first account is chosen only from a real selection list",()=>{
                Func<long,string,int,int,int,int,string,ControlInfo> mk=(h,cls,x,y,w,hh,text)=>new ControlInfo{Handle=h,Parent=1,Class=cls,Visible=true,Enabled=true,
                    Bounds=new[]{x,y,w,hh},RelativeBounds=new[]{x,y,w,hh},Text=text,TextState="read"};
                const string WF="WindowsForms10.Window.8.app.0.1",BT="WindowsForms10.BUTTON.app.0.1";
                var grid=new List<ControlInfo>{mk(2,WF,10,40,400,160,null),mk(3,"WindowsForms10.SCROLLBAR.app.0.1",400,40,17,160,null),mk(4,BT,250,210,75,23,"&OK"),mk(5,BT,330,210,75,23,"Cancel")};
                var a=Selectors.AccountChooser(WF,grid);
                Check(a.IsChooser && a.Accept!=null && a.Accept.Handle==4 && a.EnterAllowed,"A customer list with OK must be chosen with OK.");
                var withNew=new List<ControlInfo>(grid){mk(6,BT,170,210,75,23,"New Customer")};
                var b=Selectors.AccountChooser(WF,withNew);
                Check(b.IsChooser && b.Accept!=null && b.Accept.Handle==4 && !b.EnterAllowed,"With a New button present only OK may be pressed, never Enter.");
                var listBox=Selectors.AccountChooser(WF,new List<ControlInfo>{mk(7,"WindowsForms10.LISTBOX.app.0.1",10,40,300,120,"")});
                Check(listBox.IsChooser && listBox.ListBox==7 && listBox.Accept==null && listBox.EnterAllowed,"A list box chooser selects row 0 and confirms with Enter.");
                var box=new List<ControlInfo>{mk(8,"Static",10,10,200,30,"Customer is on credit hold"),mk(9,"Button",80,60,75,23,"OK")};
                Check(!Selectors.AccountChooser("#32770",box).IsChooser,"A message box must never be treated as an account list.");
                var noAccept=new List<ControlInfo>{grid[0],grid[1],mk(10,BT,330,210,75,23,"Cancel")};
                Check(!Selectors.AccountChooser(WF,noAccept).IsChooser,"A list area without an OK/Select button is left to normal recovery.");
            });
            Case("Online orders wait in line once each, and an entered order is never queued again",()=>{
                var q=new OrderQueue();var first=new Order{orderId="TTW1"};var second=new Order{orderId="TTW2"};
                Check(q.Add(first,null)=="queued" && q.Add(second,null)=="queued" && q.Add(new Order{orderId="ttw1"},null)=="duplicate","Orders must queue once each.");
                Check(q.Add(new Order{orderId="TTW3"},"TTW3")=="duplicate","The order being entered must not be queued again.");
                Check(q.Next()==first && q.Count==1,"Orders must come out in the order they were copied.");
                q.Entered("TTW1");
                Check(q.Add(new Order{orderId="TTW1"},null)=="entered" && q.WasEntered("ttw1"),"An entered order must never be queued again.");
                Check(q.Next()==second && q.Next()==null,"The queue must empty cleanly.");
            });
            Case("End-of-day report counts today's events, compares versions and lists what to look at",()=>{
                var now=new DateTime(2026,10,3,17,0,0);
                Func<string,string,Dictionary<string,object>> ev=(kind,detail)=>new Dictionary<string,object>{{"At","2026-10-03T10:00:00.0000000+10:00"},{"Kind",kind},{"Detail",detail},{"MemoryMb",40}};
                var events=new List<Dictionary<string,object>>{ev("online_loaded","TTW1"),ev("online_fill_ok","TTW1"),ev("online_load_failed","Unmapped discounts must remain blocked."),
                    ev("online_refused","TTW1 already entered"),ev("crash","worker: NullReferenceException"),ev("user_note","COSTAR froze"),ev("memory_after_run","run=x")};
                events.Add(new Dictionary<string,object>{{"At","2026-10-02T10:00:00.0000000+10:00"},{"Kind","online_loaded"},{"Detail","yesterday"}});
                var fast=new RunReport{Version="1.8.1 - lean build",Kind="mobile",OrderRef="MJC-A",Outcome="completed",TotalMs=8000,StartedLocal="2026-10-03T09:00:00+10:00",LateReads=2};
                fast.Stages.Add(new StageStat{Stage="Mobile number and customer lookup",DurationMs=1600});
                var stopped=new RunReport{Version="1.8.1 - lean build",Kind="online-pickup",OrderRef="TTW2",Outcome="stopped",Category="focus_stolen",StopStage="Item X",StopMessage="COSTAR lost focus",TotalMs=3000,StartedLocal="2026-10-03T11:00:00+10:00"};
                var older=new RunReport{Version="1.6.1 - speed build",Kind="mobile",OrderRef="MJC-B",Outcome="completed",TotalMs=10300,StartedLocal="2026-10-02T14:19:00+10:00"};
                string page=DiagnosticsBundle.EndOfDay(new List<RunReport>{fast,stopped,older},events,now);
                Check(page.Contains("Entry runs: 2,") && page.Contains("loaded 1,") && page.Contains("filled 1,") && page.Contains("Crashes: 1."),"Today's counts are wrong.");
                Check(page.Contains("1.6.1 - speed build: mobile 10.30 s (1)") && page.Contains("1.8.1 - lean build: mobile 8.00 s (1)"),"Speed by version is missing.");
                Check(page.Contains("COSTAR froze") && page.Contains("read plan missed 2") && page.Contains("focus_stolen") && page.Contains("Unmapped discounts"),"Things to look at are missing.");
                Check(DiagnosticsBundle.Summary(new List<RunReport>{fast},null).Contains("END OF DAY"),"The end-of-day page must head the summary.");
            });
            Case("A job whose Repair Order or COSTAR is gone is recognised, so it cannot lock the COSTAR list",()=>{
                var cp=new MobileCheckpoint{submissionId="x",window=100,processId=20,processStart=1000,sessionId=1};
                Check(CostarWindows.OrderWindowGone(cp),"A closed Repair Order window was not recognised as gone.");
                cp.window=0;Check(!CostarWindows.OrderWindowGone(cp)&&!CostarWindows.OrderWindowGone(null),"A job without a window must not count as gone.");
                Check(CostarWindows.PinnedProcessGone(new MobileCheckpoint{processId=999999,processStart=1,sessionId=0}),"A COSTAR process that is not running was not recognised.");
                Check(!CostarWindows.PinnedProcessGone(new MobileCheckpoint{processId=0}),"A job that never opened COSTAR must not count as gone.");
            });
            Case("Order Check link: its WIP window is recognised and an order already in COSTAR is found",()=>{
                var startedUtc=new DateTime(2026,10,3,7,15,30,DateTimeKind.Utc);
                string key="4321@"+startedUtc.ToLocalTime().Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
                Check(OrderCheckLink.Matches(key,4321,startedUtc.Ticks),"Order Check's window key (local start time) was not matched.");
                Check(!OrderCheckLink.Matches(key,4320,startedUtc.Ticks),"A different PID must not match.");
                Check(!OrderCheckLink.Matches(key,4321,startedUtc.AddMinutes(5).Ticks),"A restarted COSTAR with the same PID must not match.");
                Check(!OrderCheckLink.Matches("",4321,startedUtc.Ticks)&&!OrderCheckLink.Matches("junk",4321,startedUtc.Ticks)&&!OrderCheckLink.Matches("4321@x",4321,startedUtc.Ticks),"Bad keys must not match.");
                string note;
                string wip="{\"readAt\":\"2026-10-03T23:39:10\",\"poColumn\":\"PO #\",\"rows\":[{\"doc\":\"0745042\",\"po\":\"TTW1730377\",\"by\":\"MOR\"},{\"doc\":\"0745043\",\"po\":\"\",\"by\":\"TOG\"}]}";
                string found=OrderCheckLink.FindInWip(wip,"ttw1730377",out note);
                Check(found!=null&&found.Contains("0745042")&&found.Contains("MOR")&&found.Contains("23:39"),"An order already in COSTAR was not reported with its document.");
                Check(OrderCheckLink.FindInWip(wip,"TTW1730378",out note)==null&&note.Contains("not in"),"An order that is not in COSTAR must not be blocked.");
                Check(OrderCheckLink.FindInWip("{\"rows\":[{\"doc\":\"1\",\"po\":\"TTW1\"}]}","TTW1",out note)==null&&note.Contains("cannot check"),"Without a PO column Order Check must never block an order.");
                Check(OrderCheckLink.FindInWip("not json","TTW1",out note)==null,"Unreadable Order Check data must never block an order.");
            });
            Case("COSTAR's customer Search list with OK greyed out is recognised as a first-account list",()=>{
                Func<long,string,int,int,int,int,string,bool,ControlInfo> mk=(h,cls,x,y,w,hh,text,enabled)=>new ControlInfo{Handle=h,Parent=1,Class=cls,Visible=true,Enabled=enabled,
                    Bounds=new[]{x,y,w,hh},RelativeBounds=new[]{x,y,w,hh},Text=text,TextState="read"};
                const string WF="WindowsForms10.Window.8.app.0.13965fa_r10_ad1",BT="WindowsForms10.BUTTON.app.0.13965fa_r10_ad1";
                var search=new List<ControlInfo>{mk(2,WF,8,67,1008,625,null,true),mk(3,BT,15,93,66,56,"&Add new",true),mk(4,BT,238,93,128,21,"Include Inactive [X] ",true),
                    mk(5,BT,472,98,72,64,"&Print Results",true),mk(6,BT,545,98,72,64,"&Search",true),mk(7,BT,700,700,75,23,"&Cancel",true),mk(8,BT,780,700,75,23,"&OK",false),mk(9,BT,618,98,72,64,"C&lear",false)};
                var kind=Selectors.AccountChooser(WF,search);
                Check(kind.IsChooser&&kind.Accept!=null&&kind.Accept.Handle==8,"COSTAR's customer Search list was not recognised, or OK was not chosen as the button to press.");
                Check(!kind.EnterAllowed,"With Add new on the list, Enter must never be used.");
            });
            Case("Time in uses the booking time in COSTAR's own format, and its box is found under its label",()=>{
                Check(Order.TimeInText("10:30")=="10:30 am"&&Order.TimeInText("13:05")=="1:05 pm"&&Order.TimeInText("00:15")=="12:15 am"&&Order.TimeInText("12:00")=="12:00 pm","Booking time was not turned into COSTAR's format.");
                Check(Order.TimeInText("")==null&&Order.TimeInText("9:5")==null&&Order.TimeInText("25:00")==null,"A bad booking time must not be entered.");
                Check(Order.ClockMinutes("10:30 am")==630&&Order.ClockMinutes("10:30 AM")==630&&Order.ClockMinutes("10:30am")==630&&Order.ClockMinutes("1:05 pm")==785&&Order.ClockMinutes("13:05")==785&&Order.ClockMinutes("12:15 am")==15,"Times in COSTAR's formats were not compared correctly.");
                Check(Order.ClockMinutes("")==-1&&Order.ClockMinutes("13:05 pm")==-1&&Order.ClockMinutes("10:75")==-1,"Something that is not a time was read as one.");
                Func<long,long,string,int,int,int,int,string,ControlInfo> mk=(h,parent,cls,x,y,w,hh,text)=>new ControlInfo{Handle=h,Parent=parent,Class=cls,Visible=true,Enabled=true,
                    Bounds=new[]{x,y,w,hh},RelativeBounds=new[]{x,y,w,hh},Text=text,TextState="read"};
                const string ST="WindowsForms10.STATIC.app.0.1",CB="WindowsForms10.COMBOBOX.app.0.1",ED="WindowsForms10.EDIT.app.0.1";
                var s=new List<ControlInfo>{mk(1,9,ST,109,295,81,15,"Time in"),mk(2,9,CB,109,309,82,21,null),mk(3,2,"Edit",112,312,59,15,"11:23 am"),
                    mk(4,9,ST,189,295,85,15,"Promised"),mk(5,9,CB,190,309,85,21,null),mk(6,5,"Edit",193,312,62,15,""),
                    mk(7,9,ST,274,295,40,15,"PO#"),mk(8,9,ED,274,310,109,20,"")};
                var box=Selectors.TimeIn(s);
                Check(box!=null&&box.Handle==3,"The Time in box was not found (or Promised was taken for it).");
                Check(Selectors.TimeIn(s.Where(c=>c.Handle!=1).ToList())==null,"Without a Time in label nothing may be written.");
            });
            Case("End-of-day report shows the helper's memory and CPU from its 5-minute samples and flags growth",()=>{
                var now=new DateTime(2026,10,4,17,0,0);
                Func<string,string,Dictionary<string,object>> ev=(at,detail)=>new Dictionary<string,object>{{"At","2026-10-04T"+at+":00.0000000+10:00"},{"Kind","perf"},{"Detail",detail}};
                var events=new List<Dictionary<string,object>>{ev("09:00","ws=40 private=55 heap=10 handles=500 gdi=40 user=50 threads=20 cpu=0.4"),
                    ev("12:00","ws=60 private=70 heap=14 handles=520 gdi=41 user=52 threads=21 cpu=0.8"),ev("16:55","ws=50 private=66 heap=12 handles=1200 gdi=42 user=52 threads=21 cpu=0.3")};
                string page=DiagnosticsBundle.EndOfDay(new List<RunReport>(),events,now);
                Check(page.Contains("start 40 MB, peak 60 MB, now 50 MB"),"Memory start/peak/now missing.");
                Check(page.Contains("Helper CPU: average 0.5%, peak 0.8%"),"CPU average/peak missing.");
                Check(page.Contains("handles grew from 500 to 1200"),"A handle leak was not flagged.");
                Check(!page.Contains("Helper memory peaked"),"Normal memory must not be flagged.");
                var values=DiagnosticsBundle.PerfValues("ws=48 cpu=0.4 run=x");
                Check(values["ws"]==48&&values["cpu"]==0.4&&!values.ContainsKey("run"),"Sample values were not read correctly.");
            });
            Case("Open-order checks are not counted as failed runs; a genuine not-empty stop still is",()=>{
                var now=new DateTime(2026,10,5,23,0,0);
                var done=new RunReport{Version="2.0.3",Kind="online-pickup",OrderRef="TTW1",Outcome="completed",TotalMs=5000,StartedLocal="2026-10-05T22:40:00+10:00"};
                var probe=new RunReport{Version="2.0.3",Kind="online-pickup",OrderRef="TTW2",Outcome="probe",Category="repair_order_not_empty",TotalMs=60,StartedLocal="2026-10-05T22:41:00+10:00"};
                var oldProbe=new RunReport{Version="2.0.2",Kind="online-pickup",OrderRef="TTW3",Outcome="stopped",Category="repair_order_not_empty",StopStage="Startup: verify empty Repair Order",TotalMs=63,StartedLocal="2026-10-05T22:42:00+10:00"};
                var genuine=new RunReport{Version="2.0.3",Kind="mobile",OrderRef="MJC-1",Outcome="stopped",Category="repair_order_not_empty",StopStage="Startup: wait for Repair Order and verify",TotalMs=900,StartedLocal="2026-10-05T22:43:00+10:00"};
                var all=new List<RunReport>{done,probe,oldProbe,genuine};
                Check(DiagnosticsBundle.IsProbe(probe)&&DiagnosticsBundle.IsProbe(oldProbe)&&!DiagnosticsBundle.IsProbe(genuine)&&!DiagnosticsBundle.IsProbe(done),"Open-order checks were not told apart from real stops.");
                string page=DiagnosticsBundle.EndOfDay(all,new List<Dictionary<string,object>>(),now);
                Check(page.Contains("Entry runs: 2,")&&page.Contains("open-order checks (not counted as runs): 2"),"Today's counts still include open-order checks.");
                Check(page.Contains("Stopped 1x: repair_order_not_empty"),"A genuine not-empty stop must still be reported.");
                Check(DiagnosticsBundle.Details(all).Contains("Completed without help: 1 of 2"),"The detailed completion rate still counts open-order checks.");
            });
            Case("COSTAR's customer Search window: Phone and Branch boxes, Nothing found, and Ship Via are found",()=>{
                Func<long,long,string,int,int,int,int,string,bool,ControlInfo> mk=(h,parent,cls,x,y,w,hh,text,enabled)=>new ControlInfo{Handle=h,Parent=parent,Class=cls,Visible=true,Enabled=enabled,
                    Bounds=new[]{x,y,w,hh},RelativeBounds=new[]{x,y,w,hh},Text=text,TextState="read"};
                const string ST="WindowsForms10.STATIC.app.0.1",ED="WindowsForms10.EDIT.app.0.1",BT="WindowsForms10.BUTTON.app.0.1",WF="WindowsForms10.Window.8.app.0.1";
                // Geometry from the 5 Oct diagnostics (popup_layout) and Tommy's 6 Oct video.
                var search=new List<ControlInfo>{mk(1,9,WF,8,67,1008,625,null,true),
                    mk(10,9,ST,0,114,235,19,"Cust# / Name",true),mk(11,9,ED,239,112,126,21,"",true),
                    mk(12,9,ST,0,132,235,17,"Phone",true),mk(13,9,ED,239,130,126,21,"",true),
                    mk(14,9,ST,0,150,235,20,"Contact / Terms",true),mk(15,9,ED,239,148,126,21,"",true),
                    mk(16,9,ST,0,222,235,17,"Branch",true),mk(17,9,ED,239,220,126,21,"11",true),
                    mk(20,9,BT,545,98,72,64,"&Search",true),mk(21,9,BT,618,98,72,64,"&Cancel",true),mk(22,9,BT,691,98,72,64,"&OK",false),mk(23,9,BT,15,93,66,56,"&Add new",true),
                    mk(30,1,ST,300,290,180,36,"Nothing found!",true)};
                var phone=Selectors.FieldRightOf(search,"PHONE");var branch=Selectors.FieldRightOf(search,"BRANCH");
                Check(phone!=null&&phone.Handle==13,"The search window's Phone box was not found.");
                Check(branch!=null&&branch.Handle==17,"The search window's Branch box was not found.");
                Check(Selectors.NothingFound(search),"\"Nothing found!\" was not recognised.");
                Check(!Selectors.NothingFound(search.Where(c=>c.Handle!=30).ToList()),"A window with results must not count as nothing found.");
                var kind=Selectors.AccountChooser(WF,search);
                Check(kind.IsChooser&&kind.Accept!=null&&kind.Accept.Handle==22&&!kind.EnterAllowed,"The Search window was not handled as a customer list with OK.");
                Check(Selectors.FieldRightOf(search.Where(c=>c.Handle!=12).ToList(),"PHONE")==null,"Without its label no box may be written.");
                var ro=new List<ControlInfo>{mk(40,5,ST,789,250,113,15,"Ship Via",true),mk(41,5,ED,790,265,113,20,"",true),
                    mk(42,5,ST,903,250,79,15,"ShipTerms",true),mk(43,5,ED,904,265,77,20,"",true)};
                var ship=Selectors.ShipVia(ro);
                Check(ship!=null&&ship.Handle==41,"The Ship Via box was not found (or ShipTerms was taken for it).");
            });
            Case("A stopped online order is recognised in its own Repair Order, and only there",()=>{
                Func<long,long,string,int,int,int,int,string,ControlInfo> mk=(h,parent,cls,x,y,w,hh,text)=>new ControlInfo{Handle=h,Parent=parent,Class=cls,Visible=true,Enabled=true,
                    Bounds=new[]{x,y,w,hh},RelativeBounds=new[]{x,y,w,hh},Text=text,TextState="read"};
                const string ST="WindowsForms10.STATIC.app.0.1",ED="WindowsForms10.EDIT.app.0.1";
                // Made-up customer; the layout follows the real Repair Order header.
                Func<string,string,string,List<ControlInfo>> ro=(po,phone,comment)=>new List<ControlInfo>{
                    mk(1,100,ST,350,101,270,15,"Account#   Name"),mk(2,100,ED,350,116,80,20,"9000001"),mk(3,100,ED,432,116,188,20,"TEST CUSTOMER"),
                    mk(4,100,ED,350,136,270,20,"1 TEST STREET"),mk(5,100,ED,350,156,270,20,""),
                    mk(6,100,ED,350,176,160,20,"TEMPE"),mk(7,100,ED,512,176,40,20,"NSW"),mk(8,100,ED,556,176,60,20,"2044"),
                    mk(9,100,ST,350,205,70,15,"eMail"),mk(10,100,ED,350,220,110,20,""),
                    mk(11,100,ST,465,205,70,15,"Mobile Ph"),mk(12,100,ED,465,220,90,20,phone),
                    mk(13,100,ST,535,245,40,15,"PO#"),mk(14,100,ED,535,260,85,20,po),
                    mk(15,200,ST,873,85,60,15,"Comment"),mk(16,200,ED,933,85,200,20,comment)};
                var order=new Order{orderId="TTW1730414",comment="ABC1 - SAT - ONLINE 10:30",customer=new Customer{phone="0400 000 001"}};
                Check(Selectors.SameOrderInProgress(ro("TTW1730414","0400000001","ABC1 - SAT - ONLINE 10:30"),order),"This order's half-done Repair Order was not recognised.");
                Check(Selectors.SameOrderInProgress(ro("ttw1730414","0400000001",""),order),"An empty comment must still count as this order's Repair Order.");
                Check(!Selectors.SameOrderInProgress(ro("TTW1730415","0400000001","ABC1 - SAT - ONLINE 10:30"),order),"Another order's Repair Order must never be resumed.");
                Check(!Selectors.SameOrderInProgress(ro("TTW1730414","0499999999","ABC1 - SAT - ONLINE 10:30"),order),"A different phone must never be resumed.");
                Check(!Selectors.SameOrderInProgress(ro("","0400000001",""),order),"A Repair Order without this PO# is not a resume.");
                Check(!Selectors.SameOrderInProgress(ro("TTW1730414","0400000001","OTHER JOB"),order),"A different comment must never be resumed.");
            });
            Case("Time saved counts the helper's finished orders and the report holds no order details",()=>{
                Func<string,string,Dictionary<string,object>> ev=(kind,detail)=>new Dictionary<string,object>{{"Kind",kind},{"Detail",detail}};
                var events=new List<Dictionary<string,object>>{ev("online_fill_ok","TTW1 in 7 s run=a"),ev("online_fill_ok","TTW2 in 5 s run=b"),
                    ev("mobile_job_ready","MJC-1 in 8.0 s run=c"),ev("online_fill_stopped","TTW3 in 2 s run=d stopped"),ev("tab","online")};
                var d=TimeSaved.Count(new DateTime(2026,10,6),events);
                Check(d.Online==2&&d.Mobile==1&&d.Stopped==1&&Math.Abs(d.HelperSeconds-20)<0.01,"Orders or helper time were not counted correctly.");
                var settings=new TimeSaved.Settings{onlineMinutes=4,mobileMinutes=5};
                Check(TimeSaved.MinutesSaved(d,settings)==13,"Time saved should be 2 x 4 + 1 x 5 = 13 minutes.");
                Check(TimeSaved.Minutes(13)=="13 min"&&TimeSaved.Minutes(150)=="2.5 hours","Time saved was not written plainly.");
                string html=TimeSaved.Html(new List<TimeSaved.Day>{d},settings,"test");
                Check(html.Contains("13 min")&&html.Contains("3 orders entered")&&!html.Contains("TTW")&&!html.Contains("MJC"),"The report is wrong or contains order details.");
            });
            Case("Auto-update accepts only a well-formed, newer, fully checked package",()=>{
                Check(Updater.Parse("2.2.0 - all branches")==new Version(2,2,0)&&Updater.Parse("v2.10.3")==new Version(2,10,3)&&Updater.Parse("junk")==new Version(0,0,0),"Versions were not read correctly.");
                Check(Updater.Parse("2.10.0")>Updater.Parse("2.9.9"),"2.10.0 must be newer than 2.9.9.");
                var good=new Updater.Release{version="2.2.1",zip="Tempe-COSTAR-Helper-v2.2.1.zip",sha256=new string('a',64),size=500000};
                Check(Updater.Validate(good)==good,"A good release file was refused.");
                Func<Updater.Release,bool> refused=r=>{try{Updater.Validate(r);return false;}catch(InvalidOperationException){return true;}};
                Check(refused(new Updater.Release{version="2.2.1",zip="Tempe-COSTAR-Helper-v2.2.2.zip",sha256=new string('a',64),size=500000}),"A ZIP for another version was accepted.");
                Check(refused(new Updater.Release{version="2.2.1",zip="other.exe",sha256=new string('a',64),size=500000}),"A download that is not the helper was accepted.");
                Check(refused(new Updater.Release{version="2.2.1",zip="Tempe-COSTAR-Helper-v2.2.1.zip",sha256="abc",size=500000}),"A release without a fingerprint was accepted.");
                string folder=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"TempeUpdaterTest-"+Guid.NewGuid().ToString("N"));
                try {
                    System.IO.Directory.CreateDirectory(System.IO.Path.Combine(folder,"Source"));
                    var manifest=new Dictionary<string,string>();
                    for(int i=0;i<12;i++) {
                        byte[] data=System.Text.Encoding.UTF8.GetBytes("file "+i);
                        System.IO.File.WriteAllBytes(System.IO.Path.Combine(folder,"Source","f"+i+".txt"),data);manifest["Source/f"+i+".txt"]=Updater.Sha256(data);
                    }
                    System.IO.File.WriteAllText(System.IO.Path.Combine(folder,"PACKAGE-SHA256.json"),Wire.Json(manifest));
                    Updater.VerifyManifest(folder);
                    System.IO.File.WriteAllText(System.IO.Path.Combine(folder,"Source","f3.txt"),"changed");
                    bool caught=false;try{Updater.VerifyManifest(folder);}catch(InvalidOperationException){caught=true;}
                    Check(caught,"A changed file passed the package check.");
                    byte[] zip;
                    using(var stream=new System.IO.MemoryStream()) {
                        using(var archive=new System.IO.Compression.ZipArchive(stream,System.IO.Compression.ZipArchiveMode.Create,true)) {
                            var entry=archive.CreateEntry("../escape.txt");
                            using(var writer=new System.IO.StreamWriter(entry.Open())) writer.Write("x");
                        }
                        zip=stream.ToArray();
                    }
                    caught=false;try{Updater.Extract(zip,System.IO.Path.Combine(folder,"unzip"));}catch(InvalidOperationException){caught=true;}
                    Check(caught&&!System.IO.File.Exists(System.IO.Path.Combine(folder,"escape.txt")),"A ZIP entry escaping its folder was not refused.");
                } finally { try{System.IO.Directory.Delete(folder,true);}catch(System.IO.IOException){}catch(UnauthorizedAccessException){} }
            });
            results.AppendLine(count+" test groups passed. No COSTAR window was opened or modified.");
            return results.ToString();
        }
    }
}
