using System;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Threading;

namespace TempeCostar {
    // COSTAR shows its branch in every window title: "COSTAR:  11 Tempe Tyres Tempe   v5.7.6.0
    // (sql-Server:Tempe)" for the main window, "RepairOrder Branch 11 Tempe Tyres Tempe" for an
    // order. Until 2.3.0 only Branch 11 was accepted. Now any branch open in this session can be
    // selected, and every Repair Order the helper touches must belong to the selected branch.
    internal static class Branches {
        static readonly Regex MainPattern=new Regex(@"^COSTAR:\s*(\d{1,3})\s+(\S.*)$",RegexOptions.IgnoreCase);
        static readonly Regex OrderPattern=new Regex(@"^RepairOrder\s+Branch\s+(\d{1,3})(?=\s|$)",RegexOptions.IgnoreCase);
        static readonly Regex VersionTail=new Regex(@"\s+v\d+(?:\.\d+)+.*$",RegexOptions.IgnoreCase);
        static readonly Regex StateTail=new Regex(@"\s+(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)$");
        static int Number(Match m) { int n; return m.Success&&Int32.TryParse(m.Groups[1].Value,NumberStyles.Integer,CultureInfo.InvariantCulture,out n)&&n>0?n:0; }
        // Branch number in a COSTAR main-window title, or 0 if it is not one.
        internal static int OfMain(string title) { return Number(MainPattern.Match(title??"")); }
        // "Tempe Tyres Tempe" from the main-window title (without the version and server).
        internal static string NameOfMain(string title) {
            var m=MainPattern.Match(title??"");
            return m.Success?Regex.Replace(VersionTail.Replace(m.Groups[2].Value,""),@"\s+"," ").Trim():"";
        }
        // Branch number in a Repair Order title, or 0 if it is not one.
        internal static int OfOrder(string title) { return Number(OrderPattern.Match(title??"")); }
        internal static bool MainTitle(string title,int branch) { return branch>0 && OfMain(title)==branch; }
        internal static bool OrderTitle(string title,int branch) { return branch>0 && OfOrder(title)==branch; }
        // Before 2.3.0 everything was Branch 11, so a saved job without a branch is Branch 11.
        internal static int OrLegacy(int branch) { return branch>0?branch:11; }
        // The place in a branch name: "Tempe Tyres Tempe" -> "TEMPE".
        internal static string Place(string branchName) {
            string n=Order.Norm(branchName);
            if(n.StartsWith("TEMPE TYRES ",StringComparison.Ordinal)) n=n.Substring(12).Trim();
            return n;
        }
        // Does an online order's store ("Tempe NSW") belong to this branch ("Tempe Tyres Tempe")?
        // Strict: the store's place must equal the branch's place. Anything else is confirmed by
        // a person before entry.
        internal static bool StoreMatches(string store,string branchName) {
            string s=StateTail.Replace(Order.Norm(store),"").Trim(),b=Place(branchName);
            Func<string,string> squash=delegate(string v){return Regex.Replace(v,"[^A-Z0-9]","");};
            return s.Length>0 && b.Length>0 && squash(s)==squash(b);
        }
    }
    internal sealed class CostarInstance {
        internal readonly int Pid,Session,Branch;
        internal readonly long MainWindow,Started;
        internal readonly string Title,BranchName;
        internal CostarInstance(int pid,long window,long started,int session,string title) {
            Pid=pid;MainWindow=window;Started=started;Session=session;Title=title;
            Branch=Branches.OfMain(title);BranchName=Branches.NameOfMain(title);
        }
        internal bool Same(CostarInstance other) { return other!=null && Pid==other.Pid && MainWindow==other.MainWindow && Started==other.Started && Session==other.Session && Branch==other.Branch; }
        // "Branch 11 (Tempe)" for messages.
        internal string Label { get { string place=Branches.Place(BranchName); return "Branch "+Branch+(place.Length>0?" ("+place+")":""); } }
        public override string ToString() { return Label+" | PID "+Pid+" | Window "+MainWindow+" | "+Title+(OrderCheckLink.IsWipWindow(this)?" | Order Check's WIP window (not used for entry)":""); }
    }
    // UI selection, mobile dispatch and online entry share this gate. A lease
    // freezes the selected instance until the entire run (including cleanup) ends.
    internal sealed class EntryCoordinator {
        readonly object gate=new object();CostarInstance selected;EntryLease active;bool paused;
        internal CostarInstance Selected {get{lock(gate)return selected;}}
        internal bool Busy {get{lock(gate)return active!=null;}}
        internal string Owner {get{lock(gate)return active==null?"":active.Owner;}}
        internal bool MobilePaused {get{lock(gate)return paused;}set{lock(gate)paused=value;}}
        internal void Select(CostarInstance target) {lock(gate){Order.Require(active==null,"Wait for the current entry to finish before changing COSTAR.");selected=target;}}
        internal EntryLease TryBegin(string owner,bool mobile) {
            lock(gate) {
                if(active!=null || selected==null || (mobile&&paused))return null;
                active=new EntryLease(this,selected,owner);return active;
            }
        }
        internal void Release(EntryLease lease) {lock(gate){if(Object.ReferenceEquals(active,lease))active=null;}}
    }
    internal sealed class EntryLease:IDisposable {
        readonly EntryCoordinator coordinator;
        internal readonly CostarInstance Target;internal readonly string Owner;
        internal EntryLease(EntryCoordinator owner,CostarInstance target,string name){coordinator=owner;Target=target;Owner=name;}
        public void Dispose(){coordinator.Release(this);}
    }
    internal sealed class CostarInputLock:IDisposable {
        internal const string Name=@"Local\TempeCostarAutofill_v01";
        readonly Mutex mutex;bool held;
        internal CostarInputLock() {
            mutex=new Mutex(false,Name);
            try {
                try{held=mutex.WaitOne(0);}catch(AbandonedMutexException){held=true;}
                Order.Require(held,"Another COSTAR helper is entering data or the old standalone autofill is open. Close the old helper and try again.");
            } catch {mutex.Dispose();throw;}
        }
        public void Dispose(){if(held){held=false;mutex.ReleaseMutex();}mutex.Dispose();}
        internal static bool LegacyOpen(){Mutex m;try{if(Mutex.TryOpenExisting(Name,out m)){m.Dispose();return true;}}catch(UnauthorizedAccessException){return true;}return false;}
    }
}
