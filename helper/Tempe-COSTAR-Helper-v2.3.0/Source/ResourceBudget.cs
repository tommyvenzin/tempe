using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace TempeCostar {
    // Returns memory to Windows after each job, so a worker left running all day sits at
    // a small footprint between jobs instead of its peak. Shared RDP servers benefit too.
    internal static class Memory {
        [DllImport("psapi.dll")] static extern bool EmptyWorkingSet(IntPtr process);
        [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
        // 1.8.0 emptied the whole working set after every job, so the next job started
        // cold (pages faulted back in): slower. Now memory is only collected when it has
        // actually grown, and the working set is left alone.
        internal static void Trim() {
            try {
                if(GC.GetTotalMemory(false)>96L*1024*1024) GC.Collect();
            } catch {
                // Housekeeping only; never affects entry.
            }
        }
    }
    // Query only the requested PID. Do not obtain a system-wide ProcessInfo
    // snapshot just to read ProcessName / SessionId during each idle poll.
    internal sealed class ProcessIdentity {
        internal readonly int Pid,Session;
        internal readonly long Started;
        internal readonly string Name;
        internal ProcessIdentity(int pid,int session,long started,string name) {Pid=pid;Session=session;Started=started;Name=name;}
    }
    internal static class LocalProcess {
        [DllImport("kernel32.dll")] internal static extern uint GetCurrentProcessId();
        [DllImport("kernel32.dll")] static extern bool ProcessIdToSessionId(uint pid,out uint session);
        [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder path,ref uint size);
        [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        internal static readonly int Session=ReadSession();
        static int ReadSession(){uint session;return ProcessIdToSessionId(GetCurrentProcessId(),out session)?(int)session:-1;}
        internal static bool TryRead(int pid,out ProcessIdentity identity) {
            identity=null;if(pid<=0||Session<0)return false;
            IntPtr handle=OpenProcess(0x1000,false,(uint)pid); // PROCESS_QUERY_LIMITED_INFORMATION
            if(handle==IntPtr.Zero)return false;
            try {
                uint session;if(!ProcessIdToSessionId((uint)pid,out session)||session!=(uint)Session)return false;
                long created,exited,kernel,user;if(!GetProcessTimes(handle,out created,out exited,out kernel,out user))return false;
                var path=new StringBuilder(2048);uint size=(uint)path.Capacity;
                if(!QueryFullProcessImageName(handle,0,path,ref size))return false;
                identity=new ProcessIdentity(pid,(int)session,DateTime.FromFileTimeUtc(created).Ticks,Path.GetFileNameWithoutExtension(path.ToString()));return true;
            } finally {CloseHandle(handle);}
        }
        internal static bool IsNamed(int pid,string name,out ProcessIdentity identity) {
            return TryRead(pid,out identity)&&String.Equals(identity.Name,name,StringComparison.OrdinalIgnoreCase);
        }
    }

    // Producers never post a UI message for every field. The one UI timer
    // drains a bounded tail, so a busy/frozen UI cannot build an unbounded queue.
    internal sealed class BoundedLog {
        internal const int PendingLimit=16384,VisibleLimit=65536,MessageLimit=2048;
        readonly object gate=new object();readonly StringBuilder pending=new StringBuilder();
        internal void Add(string text) {
            text=text??"";if(text.Length>MessageLimit)text=text.Substring(0,MessageLimit)+" [truncated]";
            string line=DateTime.Now.ToString("HH:mm:ss")+"  "+text+Environment.NewLine;
            lock(gate) {
                int excess=pending.Length+line.Length-PendingLimit;
                if(excess>0)pending.Remove(0,excess);
                pending.Append(line);
            }
        }
        internal string Drain(){lock(gate){if(pending.Length==0)return "";string value=pending.ToString();pending.Clear();return value;}}
        internal void Flush(TextBox box) {
            string text=Drain();if(text.Length==0)return;
            if(box.MaxLength!=VisibleLimit)box.MaxLength=VisibleLimit;
            if(box.TextLength+text.Length>VisibleLimit) {
                string previous=box.Text;int keep=Math.Min(previous.Length,VisibleLimit-text.Length);
                box.Text=previous.Substring(previous.Length-keep);box.SelectionStart=box.TextLength;
            }
            box.AppendText(text);
        }
    }

    internal static class OrderClipboard {
        internal const int CharacterLimit=200000;
        [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
        [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
        [DllImport("user32.dll")] static extern bool CloseClipboard();
        [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
        [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr memory);
        [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr memory);
        [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr memory);
        internal static string Read(IntPtr owner) {
            const uint unicodeText=13;
            if(!IsClipboardFormatAvailable(unicodeText))return null;
            if(!OpenClipboard(owner))throw new ExternalException("Clipboard is busy.");
            try {
                var memory=GetClipboardData(unicodeText);
                Order.Require(memory!=IntPtr.Zero,"Clipboard text is unavailable. Copy the order again.");
                ulong bytes=GlobalSize(memory).ToUInt64();
                Order.Require(bytes>=2&&bytes<=2UL*(CharacterLimit+1)+4096,"Clipboard text is too large. Copy just one order using Send to COSTAR.");
                var pointer=GlobalLock(memory);Order.Require(pointer!=IntPtr.Zero,"Clipboard text could not be read.");
                try {
                    // Bound the managed allocation before reading clipboard text.
                    string text=Marshal.PtrToStringUni(pointer,(int)Math.Min(bytes/2,(ulong)CharacterLimit+1));
                    int end=text.IndexOf('\0');Order.Require(end>=0&&end<=CharacterLimit,"The copied order is too large or incomplete.");
                    return text.Substring(0,end);
                } finally {GlobalUnlock(memory);}
            } finally {CloseClipboard();}
        }
    }
}
