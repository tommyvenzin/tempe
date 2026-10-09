using System;
using System.IO;
using System.Net;
using System.Security.Principal;
using System.Threading;
using System.Windows.Forms;

namespace TempeCostar {
    internal static class Program {
        [STAThread] static int Main(string[] args) {
            try {
                ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
                ServicePointManager.Expect100Continue=false;
                if(args.Length>0&&args[0]=="--self-test") {
                    string result=MobileTests.Run();
                    // Order Check is part of this app since 2.0.0: its tests run here too.
                    string orderCheckReport=Path.Combine(Path.GetTempPath(),"TempeOrderCheck-selftest-"+Guid.NewGuid().ToString("N")+".txt");
                    int orderCheck=TempeOrderCheck.SelfTests.Run(orderCheckReport);
                    string orderCheckText=File.Exists(orderCheckReport)?File.ReadAllText(orderCheckReport):"Order Check self-tests wrote no report.";
                    try{File.Delete(orderCheckReport);}catch(IOException){}
                    File.WriteAllText(args[1],result+Environment.NewLine+Environment.NewLine+orderCheckText);
                    return orderCheck==0?0:1;
                }
                try{System.Runtime.GCSettings.LatencyMode=System.Runtime.GCLatencyMode.SustainedLowLatency;}catch(Exception){} // fewer blocking full collections
                Native.SetProcessDPIAware();Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
                string mode=args.Length==0?"--desk":args[0];bool onlineFirst=mode=="--online";if(onlineFirst)mode="--worker";
                string folder=Path.Combine(PrivateFiles.Home,mode=="--worker"?"worker":"desk");PrivateFiles.DirectoryReady(folder);
                string configPath=Path.Combine(folder,"settings.dat");
                if(mode=="--init") {
                    Order.Require(args.Length==4,"Setup arguments are incomplete.");
                    IPAddress ip;Order.Require(IPAddress.TryParse(args[1],out ip)&&NetworkRules.Private(ip)&&!IPAddress.IsLoopback(ip),"Use a private LAN address.");
                    var settings=PrivateFiles.Load<ReceiverSettings>(configPath)??new ReceiverSettings {phoneToken=Wire.Token(),workerToken=Wire.Token(),workerId=Guid.NewGuid().ToString("N"),webUrl=""};
                    settings.address=args[1];settings.certificateThumbprint=args[2];
                    string certificate=Path.Combine(folder,"Tempe-Mobile-Root.cer");if(Path.GetFullPath(args[3])!=certificate)File.Copy(args[3],certificate,true);
                    PrivateFiles.Save(configPath,settings);return 0;
                }
                AppLog.Start(mode=="--worker"?(onlineFirst?"worker-online":"worker"):"desk");
                Updater.LaunchMode=mode=="--worker"?(onlineFirst?"Online":"RDP"):"Desk";
                bool created;string mutexName=@"Global\TempeMobile_"+(mode=="--worker"?"Worker_":"Desk_")+WindowsIdentity.GetCurrent().User.Value;
                using(var instance=new Mutex(true,mutexName,out created)) {
                    if(!created){if(mode=="--worker"){if(!WorkerForm.ShowExisting(onlineFirst))MessageBox.Show("Close the older RDP worker once, then launch this combined helper.");}else MessageBox.Show("The desk receiver is already open.");return 0;}
                    try {
                        if(mode=="--worker") {
                            string imported=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"worker-connection.json");
                            var settings=PrivateFiles.Load<WorkerSettings>(configPath);
                            if(File.Exists(imported)) {settings=Wire.Read<WorkerSettings>(File.ReadAllText(imported));NetworkRules.Worker(settings);PrivateFiles.Save(configPath,settings);}
                            Application.Run(new WorkerForm(settings,folder,onlineFirst));
                        } else {
                            var settings=PrivateFiles.Load<ReceiverSettings>(configPath);Order.Require(settings!=null,"Run Setup-Desk.cmd first on your normal Windows desktop.");
                            string site=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..","Website"));
                            Order.Require(File.Exists(Path.Combine(site,"Fitment_Planner.html")),"The Website folder is missing beside the bin folder.");
                            Application.Run(new DeskForm(settings,folder,site));
                        }
                    }finally{instance.ReleaseMutex();}
                }
                AppLog.Note("app_exit","normal");
                return 0;
            }catch(Exception e) {
                if(args.Length>1&&args[0]=="--self-test") {File.WriteAllText(args[1],e.ToString());return 1;}
                AppLog.Crash("startup",e);
                MessageBox.Show(e.Message,"Tempe Mobile — stopped",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;
            }
        }
    }
}
