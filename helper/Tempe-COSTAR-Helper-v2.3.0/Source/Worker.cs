using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace TempeCostar {
    public sealed class WorkerJournal {
        public MobileJob job;public string lease;public MobileCheckpoint checkpoint;public WorkerReport report;
    }
    internal static class MobileRecovery {
        internal static bool CanReset(WorkerJournal state) {
            return state!=null&&state.job!=null&&state.report!=null&&state.report.status=="failed"&&
                !String.IsNullOrWhiteSpace(state.lease)&&Wire.Equal(state.lease,state.report.lease)&&state.report.submissionId==state.job.submissionId&&
                MobileProof.Unstarted(state.checkpoint)&&state.checkpoint.submissionId==state.job.submissionId;
        }
        internal static MobileCheckpoint FreshCheckpoint(WorkerJournal state) {
            Order.Require(CanReset(state),"This job has entered fields or has uncertain progress. It cannot be reset automatically; keep its saved progress and check the report.");
            return new MobileCheckpoint {submissionId=state.job.submissionId,planVersion=MobileProof.PlanVersion};
        }
    }
    internal sealed class WorkerEngine : IDisposable {
        readonly EntryCoordinator coordinator;readonly WorkerSettings settings;readonly string journalPath;readonly object gate=new object();readonly Action<string> log;
        WorkerJournal state;Runner runner;volatile bool disposed,busy;int started;
        readonly Stopwatch progressClock=Stopwatch.StartNew();
        internal volatile bool Enabled;
        // The last COSTAR availability check, reused for 3 s (each check scans windows).
        DateTime availableAt=DateTime.MinValue;bool availableCache;string availableDetail="";
        internal string Connection="Mobile is paused",Detail="Select COSTAR and click Start / resume mobile.";
        internal bool Busy {get{return busy;}}
        internal WorkerEngine(WorkerSettings config,string folder,Action<string> notify,EntryCoordinator entries) {
            coordinator=entries;
            NetworkRules.Worker(config);settings=config;log=notify;journalPath=Path.Combine(folder,"journal.dat");
            state=PrivateFiles.Load<WorkerJournal>(journalPath);
            if(state!=null&&state.report!=null&&state.report.status=="injecting")Report("failed","The RDP worker restarted. Retry will reconcile the saved progress.","");
        }
        internal MobileCheckpoint PendingCheckpoint {get{lock(gate)return state!=null&&(state.report==null||state.report.status!="closed")?Wire.Copy(state.checkpoint):null;}}
        internal bool TargetPinned {get{lock(gate)return state!=null&&(state.report==null||state.report.status!="closed")&&state.checkpoint!=null&&(state.checkpoint.window!=0||state.checkpoint.opening);}}
        internal bool CanResetUnstarted {get{lock(gate)return MobileRecovery.CanReset(state);}}
        internal string PendingSummary {get{lock(gate)return state==null||state.job==null?"":state.job.Reference+" ("+(state.report==null||state.report.status==null?"no status":state.report.status.Replace('_',' '))+")";}}
        void RequireUnstartedReset() {
            Order.Require(!Enabled&&!busy&&!coordinator.Busy,"Stop mobile entry and wait for the current entry to finish before resetting.");
            Order.Require(MobileRecovery.CanReset(state),"Only a failed job that stopped before any fields were entered can be reset.");
            Order.Require(!Native.IsWindow(new IntPtr(state.checkpoint.window)),"The original Repair Order window still exists. Leave it open, bring it to the front and retry; do not replace it.");
        }
        internal string DescribeUnstartedReset() {
            Stop();lock(gate){RequireUnstartedReset();return state.job.Reference+" — "+state.job.customer.name;}
        }
        internal void ResetUnstarted() {
            AppLog.Note("mobile_reset_unstarted","requested");
            string backup;
            lock(gate) {
                RequireUnstartedReset();var fresh=MobileRecovery.FreshCheckpoint(state);
                backup=Path.Combine(Path.GetDirectoryName(journalPath),"journal-before-reset-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,8)+".dat");
                File.Copy(journalPath,backup,false);
                var previous=state.checkpoint;state.checkpoint=fresh;
                try{Save();}catch{state.checkpoint=previous;throw;}
            }
            Detail="Unstarted job reset. Select COSTAR, start mobile, then Retry selected on the desk receiver.";
            log(Detail);log("Previous encrypted progress kept at: "+backup);
        }
        internal void Start(){if(disposed)return;if(!Enabled)AppLog.Note("mobile_start","");Enabled=true;if(Interlocked.Exchange(ref started,1)!=0)return;var t=new Thread(Loop);t.IsBackground=true;t.Start();}
        internal void Stop(){if(Enabled)AppLog.Note("mobile_stop",disposed?"app closing":"");Enabled=false;var active=runner;if(active!=null)active.Cancel=true;}
        void Save(){PrivateFiles.Save(journalPath,state);}
        void SaveCheckpoint(){PrivateFiles.Save(journalPath,state,false);}
        void Report(string status,string message,string progress) {
            message=ReportText(message,2000);progress=ReportText(progress,1000);
            lock(gate) {
                if(state==null)return;
                int sequence=state.report==null?1:state.report.sequence+1;
                var previous=state.report;
                state.report=new WorkerReport {submissionId=state.job.submissionId,lease=state.lease,status=status,message=message,progress=progress,sequence=sequence};
                try{Save();}catch{state.report=previous;Enabled=false;throw;}
            }
            Detail=message;log(message);
        }
        static string ReportText(string text,int limit){text=Regex.Replace(text??"",@"[\x00-\x1f\x7f]"," ");return text.Length>limit?text.Substring(0,limit):text;}
        void Progress(string message){
            // Checkpoints are saved once per operation. The desk receives progress only
            // on the 3-second worker poll, so a progress save more often than that adds
            // disk work without showing anything sooner.
            if(progressClock.ElapsedMilliseconds<2500){Detail=message;log(message);return;}
            var timer=Stopwatch.StartNew();Report("injecting",message,message);progressClock.Restart();NoteSave(timer);
        }
        void Persist(MobileCheckpoint checkpoint){var timer=Stopwatch.StartNew();long copyMs;lock(gate){var previous=state.checkpoint;state.checkpoint=Wire.Copy(checkpoint);copyMs=timer.ElapsedMilliseconds;try{SaveCheckpoint();}catch{state.checkpoint=previous;Enabled=false;throw;}}NoteSave(timer,copyMs);}
        // Called on the entry thread only, so diagnostics stay single-threaded.
        void NoteSave(Stopwatch timer,long copyMs=0){var active=runner;if(active!=null&&active.Diag!=null){active.Diag.Persist(timer.ElapsedMilliseconds);active.Diag.SaveParts(copyMs,PrivateFiles.LastJsonMs,PrivateFiles.LastProtectMs,PrivateFiles.LastWriteMs,PrivateFiles.LastReplaceMs);}}
        WorkerReply Request(WorkerHello hello) {
            var request=(HttpWebRequest)WebRequest.Create(settings.baseUrl.TrimEnd('/')+"/api/worker/v1/poll");
            request.Method="POST";request.ContentType="application/json";request.Headers["Authorization"]="Bearer "+settings.token;request.AllowAutoRedirect=false;request.Proxy=null;
            request.Timeout=8000;request.ReadWriteTimeout=8000;
            request.ServicePoint.Expect100Continue=false;
            request.ServerCertificateValidationCallback=delegate(object sender,X509Certificate cert,X509Chain chain,System.Net.Security.SslPolicyErrors errors) {
                if(cert==null)return false;using(var c=new X509Certificate2(cert))return DateTime.Now>=c.NotBefore&&DateTime.Now<=c.NotAfter&&Wire.Equal(Wire.Hash(c.RawData),settings.certificateHash);
            };
            byte[] bytes=Encoding.UTF8.GetBytes(Wire.Json(hello));request.ContentLength=bytes.Length;
            using(var output=request.GetRequestStream())output.Write(bytes,0,bytes.Length);
            try {using(var response=request.GetResponse())using(var input=response.GetResponseStream())using(var reader=new StreamReader(input,Encoding.UTF8))return Wire.Read<WorkerReply>(reader.ReadToEnd());}
            catch(WebException e) {
                if(e.Response!=null)using(var input=e.Response.GetResponseStream())using(var reader=new StreamReader(input))throw new InvalidOperationException("Receiver rejected the request: "+reader.ReadToEnd());
                throw;
            }
        }
        void Loop() {
            while(!disposed) {
                try {
                    string detail;bool available=false;
                    if(coordinator.Busy)detail=coordinator.Owner+" is filling COSTAR";
                    else if(!Enabled)detail="Mobile stopped; no COSTAR scanning";
                    else if(coordinator.MobilePaused)detail="Online Orders tab selected; mobile pickup paused";
                    else if(DateTime.UtcNow-availableAt<TimeSpan.FromSeconds(3)){available=availableCache;detail=availableDetail;}
                    else {available=CostarWindows.Available(coordinator.Selected,out detail);availableCache=available;availableDetail=detail;availableAt=DateTime.UtcNow;}
                    if(available&&CostarInputLock.LegacyOpen()){available=false;detail="Close the original online-order helper while using mobile injection";}
                    WorkerReport report;lock(gate)report=state==null?null:Wire.Copy(state.report);
                    var reply=Request(new WorkerHello {workerId=settings.workerId,accepting=Enabled&&!coordinator.MobilePaused,available=available,detail=detail,report=report});
                    Connection="PC receiver connected";if(!busy)Detail=detail;AppLog.PollOk();
                    if(reply!=null&&!busy&&!disposed&&Enabled&&!coordinator.MobilePaused&&(reply.command=="inject"||reply.command=="close"))Accept(reply);
                } catch(Exception e){Connection="PC receiver unavailable: "+e.Message;AppLog.PollError(e.Message);}
                // One-second poll while mobile entry is enabled (new jobs and finished
                // reports reach the desk sooner); three seconds while stopped or paused.
                // Never run window discovery on the UI thread or while stopped/online/busy.
                // Every 2 s while mobile entry is on (2.0.2: was 1 s), 3 s while stopped or paused.
                int ticks=Enabled&&!coordinator.MobilePaused?20:30;
                for(int i=0;i<ticks&&!disposed;i++)Thread.Sleep(100);
            }
        }
        void Accept(WorkerReply reply) {
            Order.Require(reply.job!=null&&!String.IsNullOrWhiteSpace(reply.lease),"Receiver omitted the assigned job.");reply.job.Validate();
            var entry=coordinator.TryBegin("Mobile job",true);if(entry==null)return;
            bool started=false;
            try {
                lock(gate) {
                    // Recheck after acquiring the gate: Stop/reset may have
                    // happened while the receiver request was in flight.
                    if(!Enabled||disposed)return;
                    if(state==null||state.job.submissionId!=reply.job.submissionId) {
                        Order.Require(reply.command=="inject"&&(state==null||(state.report!=null&&state.report.status=="closed")),"A different unfinished job is already in this worker's journal.");
                        var previous=state;
                        state=new WorkerJournal {job=Wire.Copy(reply.job),lease=reply.lease,checkpoint=new MobileCheckpoint {submissionId=reply.job.submissionId}};
                        try{Save();}catch{state=previous;Enabled=false;throw;}
                    } else Order.Require(Wire.Json(state.job)==Wire.Json(reply.job)&&Wire.Equal(state.lease,reply.lease),"The assigned job changed; entry refused.");
                    if(reply.command=="inject"&&state.report!=null&&state.report.status=="ready_for_review")return;
                    busy=true;
                }
                var thread=new Thread(delegate(){Run(reply.command,entry);});thread.IsBackground=true;thread.SetApartmentState(ApartmentState.STA);thread.Start();started=true;
            } finally {if(!started){busy=false;entry.Dispose();}}
        }
        void Run(string command,EntryLease entry) {
            CostarInputLock inputLock=null;var clock=Stopwatch.StartNew();string reference="";
            try {
                inputLock=new CostarInputLock();CostarWindows.Main(entry.Target);
                MobileJob job;MobileCheckpoint cp;lock(gate){job=Wire.Copy(state.job);cp=Wire.Copy(state.checkpoint);}
                reference=job.Reference;
                if(command!="close") AppLog.Note("mobile_job_start",reference+(cp.index>0||cp.pending>=0?" resume at step "+(cp.index+1):"")+DraftAge(job));
                if(command=="close") {
                    Order.Require(state.report!=null&&(state.report.status=="ready_for_review"||state.report.status=="closed"),"The current job is not ready to close.");
                    // A lost close acknowledgement must never close a later window. If the
                    // reviewed order's window is already gone (closed by hand, or COSTAR was
                    // closed or restarted) there is nothing to close in any COSTAR, so this is
                    // checked before requiring the job's original COSTAR to be selected.
                    if(state.report.status=="closed"||CostarWindows.OrderWindowGone(cp)) {
                        bool gone=state.report.status!="closed";
                        Report("closed",gone?"The reviewed Repair Order was already closed (COSTAR closed or restarted). Make sure it was saved.":"Reviewed order closed","");
                        if(gone)AppLog.Note("mobile_close_ok",reference+" window already gone");
                        return;
                    }
                }
                if(cp.window!=0)Order.Require(cp.processId==entry.Target.Pid&&cp.processStart==entry.Target.Started&&cp.sessionId==entry.Target.Session,"This mobile job belongs to another COSTAR instance. Select its original instance to resume.");
                if(command=="close") {
                    CostarWindows.ValidateTarget(cp);
                    runner=new Runner(cp.processId,Branches.OrLegacy(cp.branch),job.EngineOrder(),"",true,log,cp.window);
                    Order.Require(runner.Target.ToInt64()==cp.window,"A different Repair Order is open.");runner.CloseMobile(job,cp);
                    Report("closed","Reviewed order closed","");AppLog.Note("mobile_close_ok",reference);return;
                }
                Report("injecting","Checking COSTAR and saved progress","");
                long openMs=-1;
                if(cp.window==0) {
                    Order.Require(!cp.opening,"The previous Add New click has an uncertain result. Check COSTAR and send the worker report; another order will not be opened automatically.");
                    var openTimer=Stopwatch.StartNew();
                    var target=CostarWindows.OpenNew(entry.Target,delegate {cp.opening=true;Persist(cp);},delegate {return !Enabled||disposed;});
                    openMs=openTimer.ElapsedMilliseconds;
                    cp.window=target.ToInt64();cp.processId=(int)Native.Pid(target);
                    ProcessIdentity identity;Order.Require(LocalProcess.IsNamed(cp.processId,"COSTAR",out identity)&&identity.Started==entry.Target.Started&&identity.Session==entry.Target.Session,"COSTAR changed while opening the order. Check the partial order manually.");
                    cp.processStart=identity.Started;cp.sessionId=identity.Session;cp.branch=entry.Target.Branch;
                    cp.opening=false;Persist(cp);
                }
                if(!Native.IsWindow(new IntPtr(cp.window))) {
                    Enabled=false;
                    throw new InvalidOperationException(MobileProof.Unstarted(cp)?
                        "The original Repair Order window is closed. This job stopped before any fields were entered. After checking COSTAR, use Reset unstarted job, then resume and Retry selected.":
                        "The original Repair Order window is closed and this job has entered or uncertain progress. Check the existing order manually and keep the report; a replacement will not be created automatically.");
                }
                CostarWindows.ValidateTarget(cp);
                runner=new Runner(cp.processId,Branches.OrLegacy(cp.branch),job.EngineOrder(),"",true,Progress,cp.window);
                if(openMs>=0)runner.Diag.OpenNewMs=openMs;
                Order.Require(runner.Target.ToInt64()==cp.window,"The target Repair Order changed before entry.");
                if(!Enabled||disposed)runner.Cancel=true;
                runner.RunMobile(job,cp,Persist);Report("ready_for_review","READY FOR REVIEW","");
                AppLog.Note("mobile_job_ready",reference+" in "+(clock.ElapsedMilliseconds/100/10.0).ToString("0.0",System.Globalization.CultureInfo.InvariantCulture)+" s run="+runner.Diag.RunId+(openMs>=0?" add-new="+openMs+"ms":""));
            } catch(Exception e) {
                try{if(runner!=null)runner.Diag.Stopped(e);}catch{}
                AppLog.Note(command=="close"?"mobile_close_failed":"mobile_job_failed",reference+" "+e.Message+(runner!=null?" run="+runner.Diag.RunId:""));
                if(command=="close") {Enabled=false;Detail="Close stopped: "+e.Message;log(Detail);}
                else try{Report("failed",e.Message,"");}catch(Exception persistenceError){Enabled=false;Detail="Worker stopped: progress could not be saved. "+persistenceError.Message;log(Detail);}
            } finally {
                try{if(runner!=null){runner.Dispose();log("COSTAR report: "+runner.ZipPath);}}
                catch(Exception e){Enabled=false;log("Report cleanup failed: "+e.Message);}
                finally{runner=null;try{if(inputLock!=null)inputLock.Dispose();}finally{busy=false;entry.Dispose();}}
            }
        }
        // How long ago the salesperson started this job card (includes their own typing time).
        static string DraftAge(MobileJob job) {
            DateTimeOffset created;
            if(!DateTimeOffset.TryParse(job.createdUtc,System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.RoundtripKind,out created)) return "";
            return " card started "+Math.Max(0,(int)(DateTimeOffset.UtcNow-created).TotalSeconds)+" s ago";
        }
        public void Dispose(){disposed=true;Stop();}
    }
}
