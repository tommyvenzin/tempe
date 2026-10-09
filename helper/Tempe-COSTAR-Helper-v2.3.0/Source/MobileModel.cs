using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace TempeCostar {
    public sealed class MobileCustomer { public string name, mobile; }
    public sealed class MobileVehicle { public string registration, makeModel; public int? odometer; }
    public sealed class MobileProduct { public string type, sku, description; public int quantity; }
    public sealed class MobileJob {
        public string schema, submissionId, draftId, createdUtc, fittingCode, alignment, additionalNotes;
        public MobileCustomer customer;
        public MobileVehicle vehicle;
        public List<MobileProduct> products;
        public void Validate() {
            Guid id, draft; DateTimeOffset date;
            Order.Require(schema=="tempe.mobile-jobcard.v1" && Regex.IsMatch(submissionId??"",@"^MJC-[0-9a-fA-F-]{36}$") && Guid.TryParse((submissionId??"").Substring(4),out id),"Invalid mobile submission ID.");
            Order.Require(Guid.TryParse(draftId,out draft) && DateTimeOffset.TryParse(createdUtc,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out date),"Invalid draft ID or date.");
            Order.Require(customer!=null && vehicle!=null,"Customer and vehicle are required.");
            Text(customer.name,"customer name",200,true); Text(customer.mobile,"mobile",30,true);
            Order.Require(Regex.IsMatch(customer.mobile,@"^\+?[\d ()-]+$") && Regex.IsMatch(Order.Phone(customer.mobile),@"^\d{8,15}$"),"Invalid mobile number.");
            Text(vehicle.makeModel,"vehicle",200,true);
            Order.Require(Regex.IsMatch(vehicle.registration??"",@"^[A-Z0-9 -]{1,15}$",RegexOptions.IgnoreCase)&&Regex.IsMatch(vehicle.registration??"",@"[A-Z0-9]",RegexOptions.IgnoreCase),"Invalid registration.");
            Order.Require(vehicle.odometer.HasValue && vehicle.odometer>=0 && vehicle.odometer<=9999999,"Odometer is required (0 is valid).");
            Order.Require(products!=null && products.Count>=1 && products.Count<=3,"Use one to three products.");
            var codes=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach(var p in products) {
                Order.Require(p!=null && (p.type=="wheel" || p.type=="tyre") && Regex.IsMatch(p.sku??"",@"^[A-Z0-9][A-Z0-9._-]{0,39}$") && !Regex.IsMatch(p.sku??"",@"^(F|M|DET|WA|WAFR|SERVICES?|UNKNOWN|UNAVAILABLE)$"),"Invalid product SKU/type.");
                Order.Require(codes.Add(p.sku) && p.quantity>=1 && p.quantity<=100,"Duplicate SKU or invalid quantity.");
                Text(p.description,"product description",400,false);
            }
            Order.Require(fittingCode=="M FB" && (alignment==null || alignment=="WA" || alignment=="WAFR"),"Invalid fitting/alignment code.");
            Order.Require((additionalNotes??"").Length<=400 && !(additionalNotes??"").Any(c=>Char.IsControl(c) && c!='\r' && c!='\n' && c!='\t'),"Invalid additional notes.");
        }
        static void Text(string value,string label,int limit,bool required) {
            Order.Safe(value,label,limit); Order.Require(!required || !String.IsNullOrWhiteSpace(value),label+" is required.");
        }
        internal string Reference { get { return "MJC-"+submissionId.Substring(4).Replace("-","").Substring(0,12).ToUpperInvariant(); } }
        internal string Notes { get { return Regex.Replace(additionalNotes??"",@"\s+"," ").Trim(); } }
        internal IEnumerable<MobileProduct> Ordered { get { return products.OrderBy(p=>p.type=="wheel"?0:1); } }
        internal Order EngineOrder() {
            return new Order { orderId=Reference,createdUtc=createdUtc,vehicle=vehicle.makeModel.ToUpperInvariant(),rego=vehicle.registration.ToUpperInvariant(),
                customer=new Customer { name=customer.name.ToUpperInvariant(),phone=customer.mobile },comment="",lines=new List<OrderLine>() };
        }
    }
    internal static class Wire {
        // One serializer per thread, reused (a new one per message was created every poll
        // and every checkpoint save).
        [ThreadStatic] static JavaScriptSerializer serializer;
        static JavaScriptSerializer Serializer { get { return serializer ?? (serializer=new JavaScriptSerializer { MaxJsonLength=12000000,RecursionLimit=32 }); } }
        internal static string Json(object value) { return Serializer.Serialize(value); }
        internal static T Read<T>(string text) { return Serializer.Deserialize<T>(text); }
        internal static T Copy<T>(T value) { return Read<T>(Json(value)); }
        internal static string Token() { var b=new byte[32];using(var r=RandomNumberGenerator.Create())r.GetBytes(b);return Convert.ToBase64String(b).TrimEnd('=').Replace('+','-').Replace('/','_'); }
        internal static string Hash(byte[] data) { using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(data)).Replace("-",""); }
        internal static bool Equal(string a,string b) { if(a==null||b==null)return false;int n=a.Length^b.Length;for(int i=0;i<a.Length;i++)n|=a[i]^(i<b.Length?b[i]:0);return n==0; }
    }
    internal static class PrivateFiles {
        internal static string Home { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TempeMobileCostar"); } }
        internal static void DirectoryReady(string path) {
            Directory.CreateDirectory(path);
            var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);
            var inheritance=InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit;
            acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,FileSystemRights.FullControl,inheritance,PropagationFlags.None,AccessControlType.Allow));
            acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null),FileSystemRights.FullControl,inheritance,PropagationFlags.None,AccessControlType.Allow));
            Directory.SetAccessControl(path,acl);
        }
        internal static T Load<T>(string path) where T:class {
            if(!File.Exists(path))return null;
            return Wire.Read<T>(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path),null,DataProtectionScope.CurrentUser)));
        }
        // flush=false skips the forced write-through to disk. The data still reaches the
        // operating system before Save returns and survives this helper crashing; only a
        // power cut or Windows crash could lose it, which also loses COSTAR's unsaved order.
        // Timing of the last save on this thread, for the diagnostics only.
        [ThreadStatic] internal static long LastJsonMs,LastProtectMs,LastWriteMs,LastReplaceMs;
        internal static void Save(string path,object value,bool flush=true) {
            var clock=System.Diagnostics.Stopwatch.StartNew();
            string json=Wire.Json(value);long jsonMs=clock.ElapsedMilliseconds;
            byte[] bytes=ProtectedData.Protect(Encoding.UTF8.GetBytes(json),null,DataProtectionScope.CurrentUser);long protectMs=clock.ElapsedMilliseconds;
            string temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";long writeMs=protectMs;
            try {
                using(var f=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {f.Write(bytes,0,bytes.Length);if(flush)f.Flush(true);}
                writeMs=clock.ElapsedMilliseconds;
                if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);
            } finally {if(File.Exists(temp))File.Delete(temp);}
            LastJsonMs=jsonMs;LastProtectMs=protectMs-jsonMs;LastWriteMs=writeMs-protectMs;LastReplaceMs=clock.ElapsedMilliseconds-writeMs;
        }
    }
    public sealed class JobStatus { public string submissionId,status,message,progress;public int version; }
    public sealed class Receipt {
        public MobileJob job; public string hash,status,message,progress,lease,workerId; public int version,workerSequence;
        public bool approved,closed,awaitingWorker,hiddenFromList;
        internal JobStatus Status() { return new JobStatus {submissionId=job.submissionId,status=status,message=message,progress=progress,version=version}; }
    }
    public sealed class QueueState { public List<Receipt> jobs=new List<Receipt>();public string currentId; public bool nextRequested,pinadMode; }
    public sealed class WorkerReport { public string submissionId,lease,status,message,progress; public int sequence; }
    public sealed class WorkerHello { public string workerId;public bool available,accepting;public string detail;public WorkerReport report; }
    public sealed class WorkerReply { public MobileJob job;public string lease,command;public JobStatus status; }
    internal sealed class JobQueue {
        readonly object gate=new object();readonly Action<QueueState> save;
        QueueState state;
        internal JobQueue(QueueState initial,Action<QueueState> persist) {state=initial??new QueueState();save=persist;}
        T Change<T>(Func<T> action) { lock(gate) { var old=Wire.Copy(state);try {T value=action();save(state);return value;}catch {state=old;throw;} } }
        internal List<Receipt> List() {lock(gate)return Wire.Copy(state.jobs);}
        internal Receipt Current {get {lock(gate)return Wire.Copy(state.jobs.FirstOrDefault(j=>j.job.submissionId==state.currentId));}}
        Receipt Find(string id) {var r=state.jobs.FirstOrDefault(j=>j.job.submissionId==id);Order.Require(r!=null,"Unknown submission.");return r;}
        Receipt Pending() {return state.jobs.FirstOrDefault(j=>!j.closed && j.job.submissionId!=state.currentId && (j.status=="queued"||j.status=="awaiting_approval"||j.status=="failed"));}
        internal JobStatus Get(string id) {lock(gate){var r=state.jobs.FirstOrDefault(j=>j.job.submissionId==id);return r==null?null:r.Status();}}
        static void Set(Receipt r,string status,string message) {r.status=status;r.message=message;r.version++;}
        internal bool PinadMode {get {lock(gate)return state.pinadMode;}}
        internal void SetPinadMode(bool enabled) {Change(delegate {
            if(state.pinadMode==enabled)return true;
            state.pinadMode=enabled;
            if(enabled)foreach(var r in state.jobs.Where(j=>!j.closed && j.status=="awaiting_approval")) {
                r.approved=true;Set(r,"queued","Pinad mode approved; waiting for COSTAR");
            }
            return true;
        });}
        internal JobStatus Submit(MobileJob job,bool idleAtArrival) {
            job.Validate();string hash=Wire.Hash(Encoding.UTF8.GetBytes(Wire.Json(job)));
            return Change(delegate {
                var old=state.jobs.FirstOrDefault(j=>j.job.submissionId==job.submissionId);
                if(old!=null){Order.Require(Wire.Equal(old.hash,hash),"CONFLICT: This ID already has a different payload.");return old.Status();}
                Order.Require(state.jobs.Count(j=>!j.closed && j.status!="ready_for_review")<100,"The pending queue is full.");
                bool approved=state.pinadMode||idleAtArrival;
                var r=new Receipt {job=Wire.Copy(job),hash=hash,approved=approved,status=approved?"queued":"awaiting_approval",version=1,message=state.pinadMode?"Pinad mode approved; waiting for COSTAR":approved?"Waiting for COSTAR":"Approve this job on the desk PC"};
                state.jobs.Add(r);return r.Status();
            });
        }
        internal JobStatus Approve(string id) {return Change(delegate {var r=Find(id);if(r.status=="awaiting_approval"){r.approved=true;Set(r,"queued","Approved; waiting for COSTAR");}return r.Status();});}
        internal JobStatus Retry(string id) {return Change(delegate {var r=Find(id);if(r.status=="failed"){r.approved=true;Set(r,"queued","Retry requested; checking the existing order");}return r.Status();});}
        internal void DeleteCompleted(string id) {Change(delegate {
            var r=Find(id);Order.Require(r.status=="ready_for_review","Only completed jobs can be removed from this list.");
            r.hiddenFromList=true;return true;
        });}
        internal void ClearCompleted() {Change(delegate {
            foreach(var r in state.jobs.Where(j=>j.status=="ready_for_review"))r.hiddenFromList=true;
            return true;
        });}
        internal void Next() {Change(delegate {
            var current=state.jobs.FirstOrDefault(j=>j.job.submissionId==state.currentId);
            Order.Require(current!=null && current.status=="ready_for_review","Next Order requires a completed order ready for review.");
            var next=state.jobs.FirstOrDefault(j=>!j.closed && j.job.submissionId!=state.currentId && (j.status=="queued"||j.status=="awaiting_approval"));
            Order.Require(next!=null,"No pending job is available.");next.approved=true;Set(next,"queued","Next Order approved");state.nextRequested=true;return true;
        });}
        internal WorkerReply Poll(WorkerHello hello) {
            return Change(delegate {
                if(hello.report!=null) {
                    var p=hello.report;var r=Find(p.submissionId);
                    Order.Require(r.workerId==hello.workerId && Wire.Equal(r.lease,p.lease),"Wrong worker or lease.");
                    if(p.sequence>r.workerSequence) {
                        Order.Require(new[]{"injecting","failed","ready_for_review","closed"}.Contains(p.status),"Invalid worker status.");
                        if(r.status!="ready_for_review" || p.status=="closed") {
                            if(p.status=="closed") {Order.Require(state.nextRequested && r.status=="ready_for_review" && state.currentId==p.submissionId,"Unexpected close acknowledgement.");r.closed=true;Set(r,"ready_for_review","Entry complete; window closed. Review in COSTAR.");state.currentId=null;state.nextRequested=false;}
                            else {Set(r,p.status,p.message??"");r.progress=p.progress??"";}
                        }
                        r.workerSequence=p.sequence;r.awaitingWorker=false;
                    }
                }
                var current=state.jobs.FirstOrDefault(j=>j.job.submissionId==state.currentId);
                if(!hello.accepting)return new WorkerReply {command="wait"};
                // COSTAR is occupied by the completed order here, so available is normally false.
                // Reuse the existing close/acknowledge handshake before assigning another job.
                if(!state.nextRequested && state.pinadMode && current!=null && current.status=="ready_for_review" && current.workerId==hello.workerId) {
                    var pending=Pending();
                    if(pending!=null && pending.status=="queued" && pending.approved)state.nextRequested=true;
                }
                if(state.nextRequested && current!=null && current.workerId==hello.workerId)
                    return new WorkerReply {command="close",job=Wire.Copy(current.job),lease=current.lease,status=current.Status()};
                if(current!=null) {
                    if(current.status=="injecting" && current.awaitingWorker && current.workerId==hello.workerId)
                        return new WorkerReply {command="inject",job=Wire.Copy(current.job),lease=current.lease,status=current.Status()};
                    if(current.status=="queued" && current.approved && current.workerId==hello.workerId) {
                        current.awaitingWorker=true;Set(current,"injecting","Checking saved progress");return new WorkerReply {command="inject",job=Wire.Copy(current.job),lease=current.lease,status=current.Status()};
                    }
                    return new WorkerReply {command="wait",status=current.Status()};
                }
                if(!hello.available)return new WorkerReply {command="wait"};
                // FIFO: held arrivals need explicit approval or the user enabling Pinad mode.
                var next=Pending();
                if(next==null||!next.approved||next.status!="queued")return new WorkerReply {command="wait"};
                next.workerId=hello.workerId;next.lease=Wire.Token();next.awaitingWorker=true;state.currentId=next.job.submissionId;Set(next,"injecting","Opening COSTAR");
                return new WorkerReply {command="inject",job=Wire.Copy(next.job),lease=next.lease,status=next.Status()};
            });
        }
    }
}
