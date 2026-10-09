using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace TempeCostar {
    // Auto-update (2.2.0). The helper reads helper/latest.json on Tommy's GitHub page. When it
    // names a newer version the helper offers it; on "Yes" it downloads the ZIP, checks its
    // SHA-256 against latest.json, checks every file against the package's own manifest, and
    // installs it beside this version under %LOCALAPPDATA%\TempeMobileCostar\packages, then
    // restarts into it. Every launcher from 2.2.0 on hands over to the newest installed
    // version, so existing folders and shortcuts start it too. Never updates during entry.
    internal static class Updater {
        internal const string Feed="https://tommyvenzin.github.io/tempe/helper/latest.json";
        const string Allowed="https://tommyvenzin.github.io/tempe/helper/";
        static readonly Regex ZipName=new Regex(@"^Tempe-COSTAR-Helper-v(\d+\.\d+\.\d+)\.zip$");
        public sealed class Release { public string version,name,zip,sha256,notes; public long size; }
        internal static volatile Release Available;
        // RDP, Online or Desk: which launcher to restart with.
        internal static string LaunchMode="RDP";
        internal static string Home { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TempeMobileCostar"); } }
        internal static string Packages { get { return Path.Combine(Home,"packages"); } }
        internal static Version Parse(string text) {
            var m=Regex.Match(text??"",@"^\s*v?(\d+)\.(\d+)\.(\d+)");
            if(!m.Success) return new Version(0,0,0);
            return new Version(Int32.Parse(m.Groups[1].Value,CultureInfo.InvariantCulture),Int32.Parse(m.Groups[2].Value,CultureInfo.InvariantCulture),Int32.Parse(m.Groups[3].Value,CultureInfo.InvariantCulture));
        }
        internal static Version Current { get { return Parse(AutofillForm.Version); } }
        // Checks once in the background; calls found (on a background thread) for a newer release.
        internal static void CheckInBackground(Action<Release> found) {
            ThreadPool.QueueUserWorkItem(delegate {
                try {
                    var release=Validate(Wire.Read<Release>(Encoding.UTF8.GetString(Download(Feed,64*1024))));
                    if(Parse(release.version)>Current) { Available=release;AppLog.Note("update_available",release.version);found(release); }
                } catch(Exception e) { AppLog.Note("update_check_failed",e.Message); }
            });
        }
        internal static Release Validate(Release r) {
            Order.Require(r!=null && Parse(r.version)>new Version(0,0,0),"The update file has no version.");
            var m=ZipName.Match(r.zip??"");
            Order.Require(m.Success && Parse(m.Groups[1].Value)==Parse(r.version),"The update file names an unexpected download.");
            Order.Require(Regex.IsMatch(r.sha256??"","^[0-9a-fA-F]{64}$"),"The update file has no valid fingerprint.");
            Order.Require(r.size>10000 && r.size<50L*1024*1024,"The update file gives an unexpected size.");
            return r;
        }
        static byte[] Download(string url,long limit) {
            Order.Require(url.StartsWith(Allowed,StringComparison.Ordinal),"Updates come only from the helper folder on Tommy's GitHub page.");
            ServicePointManager.SecurityProtocol=ServicePointManager.SecurityProtocol|SecurityProtocolType.Tls12;
            var request=(HttpWebRequest)WebRequest.Create(url);
            request.Method="GET";request.Timeout=20000;request.ReadWriteTimeout=60000;request.AllowAutoRedirect=false;
            request.CachePolicy=new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            using(var response=(HttpWebResponse)request.GetResponse())
            using(var stream=response.GetResponseStream())
            using(var buffer=new MemoryStream()) {
                Order.Require(response.StatusCode==HttpStatusCode.OK,"The update server answered "+((int)response.StatusCode).ToString(CultureInfo.InvariantCulture)+".");
                var chunk=new byte[65536];int read;
                while((read=stream.Read(chunk,0,chunk.Length))>0) {
                    buffer.Write(chunk,0,read);
                    Order.Require(buffer.Length<=limit,"The download is larger than expected; stopped.");
                }
                return buffer.ToArray();
            }
        }
        internal static string Sha256(byte[] data) {
            using(var sha=SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(data)).Replace("-","").ToLowerInvariant();
        }
        // Downloads, checks and installs; returns the new package folder.
        internal static string Install(Release r,Action<string> say) {
            say("Downloading "+r.zip+" ...");
            byte[] zip=Download(new Uri(new Uri(Feed),r.zip).AbsoluteUri,r.size);
            Order.Require(zip.LongLength==r.size && Sha256(zip)==r.sha256.ToLowerInvariant(),"The download does not match its published fingerprint. Nothing was installed.");
            string name="Tempe-COSTAR-Helper-v"+Parse(r.version).ToString(3);
            Directory.CreateDirectory(Packages);
            string target=Path.Combine(Packages,name);
            if(Directory.Exists(target)) {
                try { VerifyManifest(target); } catch(InvalidOperationException) { Directory.Delete(target,true); }
            }
            if(!Directory.Exists(target)) {
                string temp=Path.Combine(Packages,"incoming-"+Guid.NewGuid().ToString("N"));
                try {
                    say("Checking every file ...");
                    Extract(zip,temp);
                    string extracted=Path.Combine(temp,name);
                    Order.Require(Directory.Exists(extracted),"The update has an unexpected layout. Nothing was installed.");
                    VerifyManifest(extracted);
                    Directory.Move(extracted,target);
                } finally {
                    try { if(Directory.Exists(temp)) Directory.Delete(temp,true); } catch(IOException) { } catch(UnauthorizedAccessException) { }
                }
            }
            File.WriteAllText(Path.Combine(Packages,"current.txt"),target,new UTF8Encoding(false));
            AppLog.Note("update_installed",r.version);
            return target;
        }
        // Extracts without letting any entry escape the folder.
        internal static void Extract(byte[] zip,string folder) {
            string root=Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            Directory.CreateDirectory(root);
            using(var archive=new ZipArchive(new MemoryStream(zip),ZipArchiveMode.Read)) {
                foreach(var entry in archive.Entries) {
                    string path=Path.GetFullPath(Path.Combine(root,entry.FullName));
                    Order.Require(path.StartsWith(root,StringComparison.OrdinalIgnoreCase),"The update contains an unsafe path. Nothing was installed.");
                    if(entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\")) { Directory.CreateDirectory(path); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    entry.ExtractToFile(path,true);
                }
            }
        }
        internal static void VerifyManifest(string folder) {
            string manifest=Path.Combine(folder,"PACKAGE-SHA256.json");
            Order.Require(File.Exists(manifest),"The update has no file list.");
            var files=Wire.Read<Dictionary<string,string>>(File.ReadAllText(manifest,Encoding.UTF8));
            Order.Require(files!=null && files.Count>10,"The update's file list is empty.");
            string root=Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            foreach(var file in files) {
                string path=Path.GetFullPath(Path.Combine(root,file.Key.Replace('/',Path.DirectorySeparatorChar)));
                Order.Require(path.StartsWith(root,StringComparison.OrdinalIgnoreCase) && File.Exists(path) && Sha256(File.ReadAllBytes(path))==(file.Value??"").ToLowerInvariant(),
                    "Update file "+file.Key+" failed its check. Nothing was switched over.");
            }
        }
        // Starts the new version's launcher a few seconds after this helper has closed.
        internal static void RestartInto(string target) {
            string launcher=LaunchMode=="Desk"?"Start-Desk.cmd":LaunchMode=="Online"?"Start-Online.cmd":"Start-RDP.cmd";
            string path=Path.Combine(target,launcher);
            Order.Require(File.Exists(path),"The new version has no "+launcher+".");
            var start=new ProcessStartInfo("cmd.exe","/c timeout /t 3 /nobreak >nul & start \"\" \""+path+"\"") { UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=target };
            Process.Start(start);
        }
    }
}
