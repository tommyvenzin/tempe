using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace TempeCostar {
    internal static class DeskActivity {
        [StructLayout(LayoutKind.Sequential)]struct InputInfo {internal uint cbSize,dwTime;}
        [DllImport("user32.dll")]static extern bool GetLastInputInfo(ref InputInfo info);
        internal static bool Idle() {var i=new InputInfo {cbSize=(uint)Marshal.SizeOf(typeof(InputInfo))};if(!GetLastInputInfo(ref i))return false;return unchecked((uint)Environment.TickCount-i.dwTime)>=30000;}
    }
    internal sealed class DeskForm:Form {
        readonly ReceiverSettings settings;readonly string folder,site;readonly X509Certificate2 cert;
        readonly Label status=new Label {AutoSize=true,MaximumSize=new Size(750,0)};
        readonly CheckBox pinad=new CheckBox {AutoSize=true,Text="Pinad mode — auto-approve and continue queue"};bool syncingPinad;
        readonly TextBox website=new TextBox {Width=570};readonly ListBox jobs=new ListBox {Width=755,Height=245};
        readonly Button deleteCompleted=new Button {Text="Delete selected",Width=170,Height=33,Enabled=false};
        readonly Button clearCompleted=new Button {Text="Clear completed",Width=170,Height=33,Enabled=false};
        readonly NotifyIcon tray=new NotifyIcon {Icon=SystemIcons.Application,Visible=true,Text="Tempe Mobile Job Card"};
        readonly System.Windows.Forms.Timer refresh=new System.Windows.Forms.Timer {Interval=1000};
        LocalServer server,trust;ReceiverApi api;JobQueue queue;
        internal DeskForm(ReceiverSettings config,string data,string sitePath) {
            settings=config;folder=data;site=sitePath;cert=Certificate(config.certificateThumbprint);
            queue=new JobQueue(PrivateFiles.Load<QueueState>(Path.Combine(folder,"queue.dat")),s=>PrivateFiles.Save(Path.Combine(folder,"queue.dat"),s));
            Text="Tempe Mobile — Desk PC Receiver";Size=new Size(820,750);StartPosition=FormStartPosition.CenterScreen;Font=new Font("Segoe UI",10);
            var layout=new FlowLayoutPanel {Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoScroll=true,Padding=new Padding(14)};Controls.Add(layout);
            layout.Controls.Add(new Label {Text="Local Job Card: "+settings.Origin+"/Fitment_Planner.html",AutoSize=true});
            layout.Controls.Add(new Label {Text="GitHub Pages website (optional; leave blank to use the local copy)",AutoSize=true});
            var urlRow=new FlowLayoutPanel {Width=770,Height=39};website.Text=settings.webUrl??"";urlRow.Controls.Add(website);Button save=new Button {Text="Save website",Width=160};urlRow.Controls.Add(save);layout.Controls.Add(urlRow);
            var buttons=new FlowLayoutPanel {Width=770,Height=43};
            Add(buttons,"Show phone QR",delegate{PairingPage();});Add(buttons,"Export RDP connection",delegate{ExportWorker();},195);
            Add(buttons,"Start receiving",delegate{api.Receiving=true;});Add(buttons,"Stop receiving",delegate{api.Receiving=false;});layout.Controls.Add(buttons);
            pinad.Checked=queue.PinadMode;layout.Controls.Add(pinad);
            layout.Controls.Add(new Label {AutoSize=true,MaximumSize=new Size(750,0),Text="Approves new and waiting jobs, then moves to the next queued job after filling finishes. Completed orders can be reviewed later in COSTAR. This choice is remembered."});
            layout.Controls.Add(status);
            layout.Controls.Add(new Label {AutoSize=true,Text="Queue and latest 20 completed jobs — find completed orders by customer/reference in COSTAR."});
            layout.Controls.Add(jobs);
            var actions=new FlowLayoutPanel {Width=770,Height=43};
            Add(actions,"Approve selected",delegate{queue.Approve(Selected());},170);
            Add(actions,"Retry selected",delegate{queue.Retry(Selected());},160);
            Add(actions,"Next Order",delegate{queue.Next();},150);layout.Controls.Add(actions);
            Add(actions,"Reset phone pairing",delegate{ResetPhonePairing();},190);
            var cleanup=new FlowLayoutPanel {Width=770,Height=43};cleanup.Controls.Add(deleteCompleted);cleanup.Controls.Add(clearCompleted);
            cleanup.Controls.Add(new Label {AutoSize=true,Text="Removes completed entries from this list only.\r\nOrders in COSTAR are kept."});layout.Controls.Add(cleanup);
            deleteCompleted.Click+=delegate {Attempt(delegate{queue.DeleteCompleted(Selected());UpdateStatus();});};
            clearCompleted.Click+=delegate {Attempt(delegate{queue.ClearCompleted();UpdateStatus();});};
            jobs.SelectedIndexChanged+=delegate {var choice=jobs.SelectedItem as JobChoice;deleteCompleted.Enabled=choice!=null&&choice.Completed;};
            layout.Controls.Add(new Label {AutoSize=true,MaximumSize=new Size(750,0),Text="Pinad mode closes a completed window only when another approved job is waiting. With Pinad mode off, use Next Order after review. COSTAR prompts still need your response. Close the original online-order helper before mobile injection."});
            save.Click+=delegate {Attempt(delegate{settings.webUrl=NetworkRules.Website(website.Text);PrivateFiles.Save(Path.Combine(folder,"settings.dat"),settings);website.Text=settings.webUrl;});};
            api=new ReceiverApi(settings,queue,site,DeskActivity.Idle,Incoming);
            pinad.CheckedChanged+=delegate {if(!syncingPinad)Attempt(ChangePinadMode);};
            server=new LocalServer(settings.address,settings.port,cert,api.Handle);
            trust=new LocalServer(settings.address,settings.trustPort,null,Trust);
            Shown+=delegate {try{server.Start();trust.Start();refresh.Start();UpdateStatus();}catch(Exception e){api.Receiving=false;server.Dispose();trust.Dispose();status.Text="Receiver could not start: "+e.Message;MessageBox.Show(status.Text,"Tempe Mobile");}};
            refresh.Tick+=delegate{UpdateStatus();};tray.BalloonTipClicked+=delegate{Show();WindowState=FormWindowState.Normal;Activate();};
            FormClosed+=delegate{refresh.Dispose();tray.Dispose();server.Dispose();trust.Dispose();cert.Dispose();};
        }
        static X509Certificate2 Certificate(string thumbprint) {
            using(var store=new X509Store(StoreName.My,StoreLocation.CurrentUser)) {
                store.Open(OpenFlags.ReadOnly);var found=store.Certificates.Find(X509FindType.FindByThumbprint,thumbprint,false);
                Order.Require(found.Count==1&&found[0].HasPrivateKey&&found[0].NotAfter>DateTime.Now,"Receiver certificate is missing/expired. Run Setup-Desk.cmd under this Windows user.");return found[0];
            }
        }
        internal static void Add(FlowLayoutPanel panel,string label,Action action,int width=160) {var b=new Button {Text=label,Width=width,Height=33};b.Click+=delegate{Attempt(action);};panel.Controls.Add(b);}
        internal static void Attempt(Action action){try{action();}catch(Exception e){MessageBox.Show(e.Message,"Tempe Mobile",MessageBoxButtons.OK,MessageBoxIcon.Information);}}
        string Selected(){var selected=jobs.SelectedItem as JobChoice;Order.Require(selected!=null,"Select a queued job first.");return selected.Id;}
        sealed class JobChoice {internal string Id,Text;internal bool Completed;public override string ToString(){return Text;}}
        void ChangePinadMode() {
            try{queue.SetPinadMode(pinad.Checked);}
            catch{syncingPinad=true;try{pinad.Checked=queue.PinadMode;}finally{syncingPinad=false;}throw;}
            UpdateStatus();
        }
        void UpdateStatus() {
            string selected=jobs.SelectedItem is JobChoice?((JobChoice)jobs.SelectedItem).Id:null;
            var receipts=queue.List().Where(x=>!x.hiddenFromList).ToList();
            jobs.BeginUpdate();jobs.Items.Clear();foreach(var r in receipts.Where(x=>!x.closed).Concat(receipts.Where(x=>x.closed).Reverse().Take(20))) {
                int i=jobs.Items.Add(new JobChoice {Id=r.job.submissionId,Completed=r.status=="ready_for_review",Text=r.job.Reference+"  |  "+r.job.customer.name+"  |  "+(r.closed?"Completed — review in COSTAR":r.status)+"  |  "+r.message});
                if(r.job.submissionId==selected)jobs.SelectedIndex=i;
            }jobs.EndUpdate();
            clearCompleted.Enabled=receipts.Any(r=>r.status=="ready_for_review");
            status.Text=(api.Receiving?"Receiving ON":"Receiving stopped")+" | "+(queue.PinadMode?"Pinad mode ON":"Pinad mode OFF")+" | "+(api.Connected?"RDP worker online":"RDP worker offline/stopped")+"\r\n"+api.WorkerDetail;
        }
        void Incoming(string id) {
            if(IsDisposed)return;try{BeginInvoke(new Action(delegate {
                var job=queue.Get(id);if(job!=null&&job.status=="awaiting_approval")tray.ShowBalloonTip(6000,"Job Card waiting","A mobile job needs approval. Open this helper and select Approve.",ToolTipIcon.Info);
                UpdateStatus();
            }));}catch(InvalidOperationException){}
        }
        HttpOutput Trust(HttpInput r) {
            if(r.method=="GET"&&r.path=="/trust.cer")return new HttpOutput {type="application/x-x509-ca-cert",bytes=File.ReadAllBytes(Path.Combine(folder,"Tempe-Mobile-Root.cer"))};
            return HttpOutput.Text("This port only supplies this PC's public trust certificate at /trust.cer. The order receiver uses HTTPS on port "+settings.port+".","text/plain; charset=utf-8");
        }
        void ExportWorker() {
            var connection=new WorkerSettings {baseUrl=settings.Origin,token=settings.workerToken,workerId=settings.workerId,certificateHash=Wire.Hash(cert.RawData)};
            string file=Path.Combine(folder,"worker-connection.json");File.WriteAllText(file,Wire.Json(connection),new UTF8Encoding(false));
            Process.Start("explorer.exe","/select,\""+file+"\"");
            MessageBox.Show("Copy worker-connection.json into the extracted package INSIDE RDP, then run Start-RDP.cmd there. This file contains a private pairing key; keep it off GitHub.","Connect RDP worker");
        }
        void ResetPhonePairing() {
            string previous=settings.phoneToken;settings.phoneToken=Wire.Token();
            try{PrivateFiles.Save(Path.Combine(folder,"settings.dat"),settings);}catch{settings.phoneToken=previous;throw;}
            PairingPage();MessageBox.Show("The old phone QR/key has been revoked. Scan the new Job Card QR on your phone. Existing queued jobs are kept.","Phone pairing reset");
        }
        void PairingPage() {
            string query="#pc="+Uri.EscapeDataString(settings.Origin)+"&key="+Uri.EscapeDataString(settings.phoneToken);
            string local=settings.Origin+"/Fitment_Planner.html"+query;
            string publicUrl=String.IsNullOrEmpty(settings.webUrl)?"":settings.webUrl+query;
            string certificateUrl="http://"+settings.address+":"+settings.trustPort+"/trust.cer";
            string qr;using(var reader=new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("TempeQR.js")))qr=reader.ReadToEnd();
            string links=Wire.Json(new[]{certificateUrl,local,publicUrl}).Replace("<","\\u003c").Replace(">","\\u003e").Replace("&","\\u0026");
            string html="<!doctype html><meta charset='utf-8'><title>Pair Tempe Mobile</title><style>body{font:17px system-ui;max-width:1000px;margin:30px auto;padding:20px;background:#111827;color:white}section{display:inline-block;vertical-align:top;width:290px;margin:15px}svg{display:block;background:white;width:260px;height:260px}a{color:#93c5fd;overflow-wrap:anywhere}p{line-height:1.5}</style><h1>Connect your iPhone</h1><p>Use the permitted work Wi-Fi. First install this PC's certificate, then enable full trust in Settings → General → About → Certificate Trust Settings. Only trust the certificate you created with Setup-Desk.cmd. Then scan the Job Card QR.</p><p>The local and GitHub websites have separate saved drafts. Keep using the same website for F Alt Tab and the Job Card.</p><main id='codes'></main><script>"+qr+"\nvar links="+links+";var titles=['1. Install this PC certificate','2. Open local Job Card','Or use your GitHub Job Card'];for(var i=0;i<links.length;i++){if(!links[i])continue;var s=document.createElement('section'),h=document.createElement('h2');h.textContent=titles[i];s.appendChild(h);var q=new TempeQR(-1,1);q.addData(links[i]);q.make();var n=q.getModuleCount(),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','-4 -4 '+(n+8)+' '+(n+8));var d='';for(var y=0;y<n;y++)for(var x=0;x<n;x++)if(q.isDark(y,x))d+='M'+x+' '+y+'h1v1h-1z';var p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);svg.appendChild(p);s.appendChild(svg);var a=document.createElement('a');a.href=links[i];a.textContent='Open this link';s.appendChild(a);document.getElementById('codes').appendChild(s);}</script>";
            using(var rootCertificate=new X509Certificate2(Path.Combine(folder,"Tempe-Mobile-Root.cer")))
                html=html.Replace("<main id='codes'>","<p>Certificate: "+System.Web.HttpUtility.HtmlEncode(rootCertificate.Subject)+"<br>SHA-256: <code>"+Wire.Hash(rootCertificate.RawData)+"</code></p><main id='codes'>");
            string path=Path.Combine(folder,"Pair-Phone.html");File.WriteAllText(path,html,new UTF8Encoding(false));Process.Start(path);
        }
    }
    internal sealed class WorkerForm:Form {
        internal const string AppTitle="Tempe COSTAR — Mobile + Online";
        readonly EntryCoordinator coordinator=new EntryCoordinator();
        readonly WorkerEngine engine;AutofillForm online;
        readonly BoundedLog messages=new BoundedLog();
        readonly TextBox log=new TextBox {Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
        readonly Label status=new Label {AutoSize=true,MaximumSize=new Size(790,0)};
        readonly Label targetStatus=new Label {AutoSize=true,MaximumSize=new Size(790,0)};
        readonly ComboBox targets=new ComboBox {DropDownStyle=ComboBoxStyle.DropDownList,Width=795};
        readonly TabControl tabs=new TabControl {Dock=DockStyle.Fill};
        readonly TabPage onlinePage=new TabPage("Online orders");
        readonly TabPage orderCheckPage=new TabPage("Order Check");
        TempeOrderCheck.MainForm orderCheck;
        readonly Button startMobile=new Button {Text="Start / resume mobile",Width=210,Height=33};
        readonly Button resetUnstarted=new Button {Text="Reset unstarted job",Width=220,Height=33,Enabled=false};
        readonly Button refreshTargets=new Button {Text="Refresh COSTAR list",Width=150,Height=30};
        readonly Button showTarget=new Button {Text="Show selected COSTAR",Width=165,Height=30};
        readonly Button entryReports=new Button {Text="Entry reports",Width=115,Height=30};
        readonly Button saveDiagnostics=new Button {Text="Save diagnostics",Width=140,Height=30};
        readonly Button addNote=new Button {Text="Add note",Width=85,Height=30};
        readonly Button bossReport=new Button {Text="Boss report",Width=105,Height=30};
        readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer {Interval=1000};
        bool syncingTargets,hotkey,refreshing,deadPin;int perfTicks,updateTicks;
        // A newer helper version found on GitHub (null if none).
        Updater.Release updateOffer;Font updateFont;
        internal WorkerForm(WorkerSettings settings,string folder,bool onlineFirst=false) {
            Text=AppTitle+" | "+AutofillForm.Version;Size=new Size(865,950);MinimumSize=new Size(845,735);Font=new Font("Segoe UI",10);StartPosition=FormStartPosition.CenterScreen;
            if(settings!=null)engine=new WorkerEngine(settings,folder,Append,coordinator);
            var top=new FlowLayoutPanel {Dock=DockStyle.Top,Height=156,FlowDirection=FlowDirection.TopDown,WrapContents=false,Padding=new Padding(12)};
            top.Controls.Add(new Label {AutoSize=true,Text="Select the COSTAR (any open branch) used for mobile and online orders."});top.Controls.Add(targets);
            var targetButtons=new FlowLayoutPanel {Width=800,Height=36};targetButtons.Controls.Add(refreshTargets);targetButtons.Controls.Add(showTarget);targetButtons.Controls.Add(entryReports);targetButtons.Controls.Add(saveDiagnostics);targetButtons.Controls.Add(addNote);targetButtons.Controls.Add(bossReport);top.Controls.Add(targetButtons);top.Controls.Add(targetStatus);
            var mobilePage=new TabPage("Mobile jobs");tabs.TabPages.Add(mobilePage);tabs.TabPages.Add(onlinePage);tabs.TabPages.Add(orderCheckPage);Controls.Add(tabs);Controls.Add(top);
            var mobileLayout=new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=1,RowCount=4,Padding=new Padding(12)};
            mobileLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
            mobileLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));mobileLayout.RowStyles.Add(new RowStyle(SizeType.Absolute,84));mobileLayout.RowStyles.Add(new RowStyle(SizeType.Percent,100));mobileLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));mobilePage.Controls.Add(mobileLayout);
            mobileLayout.Controls.Add(status,0,0);
            var buttons=new FlowLayoutPanel {Dock=DockStyle.Fill};
            buttons.Controls.Add(startMobile);startMobile.Click+=delegate{if(engine!=null&&EnsureTarget()){tabs.SelectedIndex=0;engine.Start();UpdateStatus();}};
            DeskForm.Add(buttons,"Stop all entry",StopAll,160);DeskForm.Add(buttons,"Save worker report",SaveReport,190);
            buttons.Controls.Add(resetUnstarted);resetUnstarted.Click+=delegate{DeskForm.Attempt(ResetUnstartedJob);};
            mobileLayout.Controls.Add(buttons,0,1);mobileLayout.Controls.Add(log,0,2);
            mobileLayout.Controls.Add(new Label {AutoSize=true,MaximumSize=new Size(790,0),Text="Ctrl+Alt+F10 stops entry. Keep the selected COSTAR visible and unobstructed during entry. Other COSTAR instances can stay open."},0,3);
            tabs.SelectedIndexChanged+=delegate{ChangeTab();};
            tabs.SelectedIndex=onlineFirst?1:0;coordinator.MobilePaused=onlineFirst;
            targets.SelectedIndexChanged+=delegate{
                if(syncingTargets)return;
                try{
                    var chosen=targets.SelectedItem as CostarInstance;
                    if(chosen!=null && OrderCheckLink.IsWipWindow(chosen)) {
                        Append("That COSTAR is Order Check's Work-in-Progress window. The helper never types into it; choose another COSTAR.");
                        syncingTargets=true;try{targets.SelectedItem=coordinator.Selected;}finally{syncingTargets=false;}
                        return;
                    }
                    var previous=coordinator.Selected;
                    coordinator.Select(chosen);
                    if(chosen!=null) {
                        RememberBranch(chosen.Branch);AppLog.Note("branch_selected",chosen.Label);
                        if(previous!=null && previous.Branch!=chosen.Branch && engine!=null && engine.Enabled) {
                            // Mobile jobs carry no branch: never let them follow a branch switch silently.
                            engine.Stop();AppLog.Note("branch_switch_mobile_paused",previous.Branch+" -> "+chosen.Branch);
                            Append("Switched to "+chosen.Label+". Mobile jobs are paused so they don't go into the wrong branch. Click Start / resume mobile to take mobile jobs into "+chosen.Label+".");
                        } else if(previous==null || previous.Branch!=chosen.Branch) Append("Using "+chosen.Label+" for new orders.");
                    }
                    UpdateStatus();
                }
                catch(Exception e){Append(e.Message);}
            };
            entryReports.Click+=delegate{Directory.CreateDirectory(Runner.ReportsRoot);Process.Start("explorer.exe",Runner.ReportsRoot);};
            refreshTargets.Click+=delegate{RefreshTargets();};
            saveDiagnostics.Click+=delegate{DeskForm.Attempt(SaveDiagnostics);};
            addNote.Click+=delegate{DeskForm.Attempt(AddNote);};
            bossReport.Click+=delegate{DeskForm.Attempt(delegate{string path=TimeSaved.SaveReport();Append("Time-saved report: "+path);AppLog.Note("report_boss","");Process.Start(path);});};
            showTarget.Click+=delegate{try{var h=CostarWindows.Main(coordinator.Selected);if(Native.IsIconic(h))Native.ShowWindow(h,9);Native.SetForegroundWindow(h);}catch(Exception e){Append(e.Message);}};
            Shown+=delegate{hotkey=Native.RegisterHotKey(Handle,1,3,0x79);ChangeTab();timer.Start();Append("Paused. Looking for COSTAR; click Start / resume mobile when ready.");ShowOrderCheckChoice();RefreshTargets();CheckForUpdate();if(!hotkey)Append("Stop shortcut unavailable; use Stop all entry.");};
            timer.Tick+=delegate{UpdateStatus();if(++perfTicks>=5){perfTicks=0;PerfMonitor.Sample();}if(++updateTicks>=6*3600){updateTicks=0;CheckForUpdate();}};
            targetStatus.Click+=delegate{if(updateOffer!=null)DeskForm.Attempt(InstallUpdate);};
            FormClosing+=delegate(object sender,FormClosingEventArgs e){if(coordinator.Busy||(online!=null&&online.Busy)||(engine!=null&&engine.Busy)){StopAll();e.Cancel=true;Append("Stopping safely. Close again once entry has stopped.");}};
            FormClosed+=delegate{if(hotkey)Native.UnregisterHotKey(Handle,1);timer.Dispose();if(orderCheck!=null)orderCheck.Shutdown();if(online!=null)online.Dispose();if(engine!=null)engine.Dispose();};
        }
        void ChangeTab() {
            bool active=tabs.SelectedIndex==1;coordinator.MobilePaused=active;AppLog.Note("tab",active?"online (mobile pickup paused)":tabs.SelectedIndex==2?"order check":"mobile");
            if(active&&online==null) {
                online=new AutofillForm(coordinator) {TopLevel=false,FormBorderStyle=FormBorderStyle.None,MinimumSize=Size.Empty,Dock=DockStyle.Fill};
                online.EnsureTarget=EnsureTarget;
                onlinePage.Controls.Add(online);online.Show();
            }
            if(online!=null)online.SetActive(active);UpdateStatus();
        }
        // Order Check (built in since 2.0.0) reads a second Tempe COSTAR's Work-in-Progress
        // list in the background, whichever tab is showing, and serves the board.
        // Order Check is OFF unless switched on (2.0.2). Off, it uses no memory, threads or
        // COSTAR time at all. The choice is remembered.
        static string OrderCheckFlag { get { return Path.Combine(PrivateFiles.Home,"order-check-on"); } }
        void ShowOrderCheckChoice() {
            orderCheckPage.Controls.Clear();
            bool on=File.Exists(OrderCheckFlag);
            var bar=new FlowLayoutPanel{Dock=DockStyle.Top,Height=46,Padding=new Padding(8,6,8,0),WrapContents=false};
            var toggle=new Button{Text=on?"Turn Order Check off":"Turn Order Check on",Width=200,Height=32};
            var note=new Label{AutoSize=true,Padding=new Padding(8,9,0,0),
                Text=on?"Reads a second Tempe COSTAR's Work-in-Progress list in the background.":"Off: uses no memory or COSTAR time. Turn it on to check WIP jobs against picking slips."};
            toggle.Click+=delegate{DeskForm.Attempt(ToggleOrderCheck);};
            bar.Controls.Add(toggle);bar.Controls.Add(note);
            orderCheckPage.Controls.Add(bar);
            if(on) StartOrderCheck();
        }
        void ToggleOrderCheck() {
            if(File.Exists(OrderCheckFlag)) {
                File.Delete(OrderCheckFlag);
                if(orderCheck!=null){orderCheck.Shutdown();orderCheck.Dispose();orderCheck=null;}
                TempeOrderCheck.Hosting.Store=null;
                AppLog.Note("order_check","turned off");
            } else {
                File.WriteAllText(OrderCheckFlag,"on");
                AppLog.Note("order_check","turned on");
            }
            ShowOrderCheckChoice();
        }
        void StartOrderCheck() {
            try {
                if(!TempeOrderCheck.Hosting.Claim()) {
                    var notice=new Label{Text="The separate Order Check app is still running. Close it (right-click its tray icon, Exit), then restart this helper: Order Check now runs here.",Dock=DockStyle.Fill,Padding=new Padding(12)};
                    orderCheckPage.Controls.Add(notice);notice.BringToFront();
                    AppLog.Note("order_check","separate Order Check app still running; built-in reader not started");
                    return;
                }
                TempeOrderCheck.Hosting.Hold=delegate{return coordinator.Busy;};
                TempeOrderCheck.Hosting.Entered=delegate{return EnteredOrders.Json();};
                TempeOrderCheck.Hosting.EntryPid=delegate{var entry=coordinator.Selected;return entry==null?0:entry.Pid;};
                string site=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..","Website"));
                orderCheck=new TempeOrderCheck.MainForm(TempeOrderCheck.Hosting.BoardAddress(site),true){TopLevel=false,FormBorderStyle=FormBorderStyle.None,Dock=DockStyle.Fill};
                orderCheck.TargetChanged=delegate{OrderCheckLink.Forget();RefreshTargets();};
                orderCheckPage.Controls.Add(orderCheck);orderCheck.BringToFront();orderCheck.Show();
                AppLog.Note("order_check","started inside the helper");
            } catch(Exception e) {
                Append("Order Check could not start: "+e.Message);
                AppLog.Note("order_check","start failed: "+e.Message);
            }
        }
        void CheckForUpdate() {
            Updater.CheckInBackground(delegate(Updater.Release found) {
                try { BeginInvoke(new Action(delegate {
                    if(updateOffer!=null && Updater.Parse(updateOffer.version)>=Updater.Parse(found.version)) return;
                    updateOffer=found;Append("Helper "+found.version+" is available. Click the status line at the top to install it.");UpdateStatus();
                })); } catch(InvalidOperationException) { }
            });
        }
        // Downloads, checks and installs the offered version, then restarts into it.
        void InstallUpdate() {
            var release=updateOffer;
            if(release==null) return;
            if(coordinator.Busy || (online!=null&&online.Busy) || (engine!=null&&engine.Busy)) { Append("Finish or stop the current entry first, then click again to update."); return; }
            string notes=String.IsNullOrWhiteSpace(release.notes)?"":"\r\n\r\n"+release.notes;
            if(MessageBox.Show(this,"Install helper "+release.version+" now?"+notes+"\r\n\r\nIt is downloaded, every file is checked, then the helper restarts into it.","Update the helper",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes) return;
            Append("Updating to "+release.version+" ...");AppLog.Note("update_started",release.version);
            ThreadPool.QueueUserWorkItem(delegate {
                try {
                    string target=Updater.Install(release,delegate(string message){ try{BeginInvoke(new Action(delegate{Append(message);}));}catch(InvalidOperationException){} });
                    BeginInvoke(new Action(delegate {
                        Append("Installed "+release.version+". Restarting into it ...");
                        try { Updater.RestartInto(target);Close(); }
                        catch(Exception e) { Append("Restart failed: "+e.Message+" Start the helper again: it opens the new version."); }
                    }));
                } catch(Exception e) {
                    AppLog.Note("update_failed",e.Message);
                    try { BeginInvoke(new Action(delegate{Append("Update failed: "+e.Message);})); } catch(InvalidOperationException) { }
                }
            });
        }
        void StopAll(){AppLog.Note("stop_pressed","stop all");if(engine!=null)engine.Stop();if(online!=null)online.StopEntry();UpdateStatus();}
        void ResetUnstartedJob() {
            if(engine==null)return;
            try {
                string job=engine.DescribeUnstartedReset();
                string message=job+"\r\n\r\nThe saved progress shows that the helper stopped before it entered any job fields. The original Repair Order window is closed.\r\n\r\nCheck COSTAR first: did you enter or complete this job manually? If so, choose No.\r\n\r\nAfter that check, reset this unstarted job so the next retry/resume can open a new blank Repair Order? The previous progress will be backed up.";
                if(MessageBox.Show(this,message,"Reset unstarted mobile job",MessageBoxButtons.YesNo,MessageBoxIcon.Question,MessageBoxDefaultButton.Button2)==DialogResult.Yes)engine.ResetUnstarted();
            } finally {UpdateStatus();}
        }
        void RefreshTargets() {
            if(coordinator.Busy||refreshing)return;
            refreshing=true;UpdateStatus();
            ThreadPool.QueueUserWorkItem(delegate(object unused) {
                List<CostarInstance> choices=null;string error=null;
                try{choices=CostarWindows.Choices();}catch(Exception e){error=e.Message;}
                if(IsDisposed)return;
                try{BeginInvoke(new Action(delegate{ApplyTargets(choices,error);}));}catch(InvalidOperationException){}
            });
        }
        void ApplyTargets(List<CostarInstance> choices,string error) {
            try {
                if(error!=null)throw new InvalidOperationException(error);
                if(coordinator.Busy)return;
                var prior=coordinator.Selected;
                if(prior!=null && OrderCheckLink.IsWipWindow(prior)) { prior=null; Append("The COSTAR the helper was using is now Order Check's WIP window; switching to another COSTAR."); }
                var selected=prior==null?null:choices.FirstOrDefault(c=>c.Same(prior));
                var pending=engine==null?null:engine.PendingCheckpoint;
                // A job pinned to a COSTAR that is no longer running (or whose Repair Order
                // window is gone) can never be resumed or closed in that COSTAR. It keeps its
                // own safety checks, but it must not stop the current COSTAR being used.
                bool pinned=engine!=null&&engine.TargetPinned;
                deadPin=pinned&&pending!=null&&(CostarWindows.OrderWindowGone(pending)||CostarWindows.PinnedProcessGone(pending));
                if(prior!=null&&selected==null){selected=prior;choices.Add(prior);} // Never silently switch to another process.
                if(selected==null&&pending!=null&&pending.window!=0&&!deadPin) {
                    var matching=choices.Where(c=>c.Pid==pending.processId&&c.Started==pending.processStart&&c.Session==pending.sessionId).ToList();
                    if(matching.Count==1)selected=matching[0];
                } else if(selected==null) {
                    // The branch you used last (remembered), else the only COSTAR open.
                    var usable=choices.Where(c=>!OrderCheckLink.IsWipWindow(c)).ToList();
                    int preferred=PreferredBranch();
                    var mine=usable.Where(c=>c.Branch==preferred).ToList();
                    if(mine.Count==1) selected=mine[0];
                    else if(usable.Count==1) selected=usable[0];
                    if(usable.Count<choices.Count) Append("Skipped the COSTAR that Order Check reads (its Work-in-Progress window); the helper never types into it.");
                }
                syncingTargets=true;targets.Items.Clear();foreach(var choice in choices)targets.Items.Add(choice);targets.SelectedItem=selected;coordinator.Select(selected);
                if(deadPin) {
                    string job=engine.PendingSummary;
                    AppLog.Note("mobile_pin_released",job+" belonged to a COSTAR that has closed");
                    Append("Earlier mobile job "+job+" was entered in a COSTAR that has since closed, so its Repair Order window is gone. It no longer locks the COSTAR list."+
                        (job.Contains("ready for review")?" Next Order on the desk receiver will release it; make sure it was saved in COSTAR.":""));
                }
                string scan=CostarWindows.LastScan;
                AppLog.Note(choices.Count==0?"costar_not_found":"costar_found",choices.Count+" COSTAR ("+String.Join(", ",choices.Select(c=>c.Label).ToArray())+")"+(selected!=null?", using "+selected.Label+" pid "+selected.Pid:", none selected")+" | "+scan);
                if(choices.Count==0)Append("No COSTAR found in this Remote Desktop session ("+scan+"). Open COSTAR here, then click Refresh COSTAR list.");
                else if(selected==null)Append(choices.Count+" COSTAR windows found ("+String.Join(", ",choices.Select(c=>c.Label).ToArray())+"): choose one in the list above.");
                else Append("Using "+selected.Label+" (PID "+selected.Pid+").");
            } catch(Exception e){Append(e.Message);AppLog.Note("costar_not_found","search failed: "+e.Message);} finally {syncingTargets=false;refreshing=false;UpdateStatus();}
        }
        // The branch chosen last, remembered between starts (2.3.0).
        static string BranchFile { get { return Path.Combine(PrivateFiles.Home,"preferred-branch.txt"); } }
        static int PreferredBranch() {
            try { int n; return File.Exists(BranchFile)&&Int32.TryParse(File.ReadAllText(BranchFile).Trim(),out n)&&n>0?n:0; }
            catch(Exception) { return 0; }
        }
        static void RememberBranch(int branch) {
            if(branch<=0 || branch==PreferredBranch()) return;
            try { Directory.CreateDirectory(PrivateFiles.Home);File.WriteAllText(BranchFile,branch.ToString()); } catch(Exception) { }
        }
        // Finds a COSTAR on the spot when an action needs one and none is chosen yet.
        internal bool EnsureTarget() {
            if(coordinator.Selected!=null) return true;
            if(coordinator.Busy) return false;
            List<CostarInstance> choices=null;string error=null;
            try{choices=CostarWindows.Choices();}catch(Exception e){error=e.Message;}
            ApplyTargets(choices,error);
            return coordinator.Selected!=null;
        }
        void UpdateStatus() {
            // Display cached state only. No window discovery, process snapshots,
            // clipboard read or journal serialization belongs on this timer.
            messages.Flush(log);if(online!=null)online.FlushLog();
            bool pinned=engine!=null&&engine.TargetPinned,busy=coordinator.Busy;var selected=coordinator.Selected;
            entryReports.Enabled=!busy;saveDiagnostics.Enabled=!busy;targets.Enabled=!busy&&(!pinned||deadPin)&&!refreshing;refreshTargets.Enabled=!busy&&!refreshing;showTarget.Enabled=!busy&&selected!=null;
            startMobile.Enabled=engine!=null&&!busy&&!refreshing&&selected!=null;
            resetUnstarted.Enabled=engine!=null&&!busy&&!engine.Busy&&engine.CanResetUnstarted;
            string targetDetail=refreshing?"Finding COSTAR windows...":selected==null?"Click Refresh COSTAR list and select a COSTAR.":"Selected "+selected.Label+" | PID "+selected.Pid+" (validated when used)";
            string saved=TimeSaved.TodayLine();
            bool offer=updateOffer!=null;
            targetStatus.Cursor=offer?Cursors.Hand:Cursors.Default;
            if(offer!=(targetStatus.BackColor==Color.Gold)) {
                // An offered update turns this line into a yellow, bold "button" (2.3.0).
                targetStatus.BackColor=offer?Color.Gold:Color.Empty;
                targetStatus.BorderStyle=offer?BorderStyle.FixedSingle:BorderStyle.None;
                targetStatus.Padding=offer?new Padding(6,4,6,4):Padding.Empty;
                targetStatus.Font=offer?(updateFont??(updateFont=new Font(Font,FontStyle.Bold))):Font;
            }
            if(offer) saved="UPDATE "+updateOffer.version+" READY - CLICK HERE TO INSTALL"+(saved.Length>0?" | "+saved:"");
            SetLabel(targetStatus,(saved.Length>0?saved+" | ":"")+(PerfMonitor.Line.Length>0?PerfMonitor.Line+" | ":"")+(busy?coordinator.Owner+" is entering data":targetDetail+(pinned&&!deadPin?" | Mobile job pinned to its original instance":"")+(pinned&&deadPin?" | Earlier mobile job's COSTAR has closed (not blocking)":"")));
            SetLabel(status,engine==null?"Mobile connection is not configured. Online Orders can still be used. Import your existing worker-connection.json and restart to connect mobile jobs.":
                engine.Connection+"\r\n"+(engine.Enabled?"Mobile enabled"+(selected!=null?": jobs go into "+selected.Label:""):"Mobile stopped")+(coordinator.MobilePaused?" | Paused while Online Orders is selected":"")+" | "+engine.Detail);
        }
        static void SetLabel(Label label,string text){if(label.Text!=text)label.Text=text;}
        void SaveReport(){UpdateStatus();using(var dialog=new SaveFileDialog{FileName="Tempe-COSTAR-Worker-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".txt",Filter="Text report|*.txt"})if(dialog.ShowDialog(this)==DialogResult.OK)File.WriteAllText(dialog.FileName,"Tempe COSTAR "+AutofillForm.Version+"\r\n"+targetStatus.Text+"\r\n"+status.Text+"\r\n\r\n"+log.Text,new UTF8Encoding(false));}
        void SaveDiagnostics() {
            AppLog.Note("report_saved","");
            string path=DiagnosticsBundle.Save();
            Append("Diagnostics saved (timings, stop reasons, today's day log; no customer details): "+path+". Upload this ZIP to Claude.");
            Process.Start("explorer.exe","/select,\""+path+"\"");
        }
        // A quick note for the end-of-day report, stored with the time it was written.
        void AddNote() {
            using(var dialog=new Form {Text="Note for the end-of-day report",ClientSize=new Size(540,128),StartPosition=FormStartPosition.CenterParent,
                FormBorderStyle=FormBorderStyle.FixedDialog,MinimizeBox=false,MaximizeBox=false,ShowInTaskbar=false,Font=Font}) {
                var help=new Label {Text="What happened? Please no customer names or numbers.",AutoSize=true,Location=new Point(12,12)};
                var text=new TextBox {Location=new Point(12,40),Width=516,MaxLength=300};
                var save=new Button {Text="Save note",DialogResult=DialogResult.OK,Location=new Point(318,80),Width=100,Height=34};
                var cancel=new Button {Text="Cancel",DialogResult=DialogResult.Cancel,Location=new Point(428,80),Width=100,Height=34};
                dialog.Controls.Add(help);dialog.Controls.Add(text);dialog.Controls.Add(save);dialog.Controls.Add(cancel);
                dialog.AcceptButton=save;dialog.CancelButton=cancel;
                if(dialog.ShowDialog(this)==DialogResult.OK && text.Text.Trim().Length>0) {
                    AppLog.Note("user_note",text.Text.Trim());
                    Append("Note saved for the end-of-day report.");
                }
            }
        }
        void Append(string text){messages.Add(text);}
        protected override void WndProc(ref Message m){if(m.Msg==0x312&&m.WParam.ToInt32()==1)StopAll();if(m.Msg==0x8001){if(m.WParam.ToInt32()==1)tabs.SelectedIndex=1;WindowState=FormWindowState.Normal;Activate();}base.WndProc(ref m);}
        internal static bool ShowExisting(bool onlineFirst) {
            bool found=false;Native.EnumWindows(delegate(IntPtr h,IntPtr unused){
                if(!Native.Caption(h).StartsWith(AppTitle,StringComparison.Ordinal))return true;
                try {ProcessIdentity identity;
                    if(!LocalProcess.IsNamed((int)Native.Pid(h),"TempeMobile",out identity))return true;
                    found=true;UIntPtr result;Native.WriteMessage(h,0x8001,new UIntPtr(onlineFirst?1u:0u),null,3,500,out result);Native.SetForegroundWindow(h);
                }catch{}return true;
            },IntPtr.Zero);return found;
        }
    }
}
