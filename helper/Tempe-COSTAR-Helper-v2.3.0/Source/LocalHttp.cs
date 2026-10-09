using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;

namespace TempeCostar {
    public sealed class ReceiverSettings {
        public string address,certificateThumbprint,phoneToken,workerToken,workerId,webUrl;
        public int port=8790,trustPort=8791;
        internal string Origin {get{return "https://"+address+":"+port;}}
    }
    public sealed class WorkerSettings {public string baseUrl,token,workerId,certificateHash;}
    internal static class NetworkRules {
        internal static bool Private(IPAddress a) {
            if(IPAddress.IsLoopback(a))return true;
            if(a.AddressFamily!=AddressFamily.InterNetwork)return false;
            byte[] b=a.GetAddressBytes();return b[0]==10||(b[0]==192&&b[1]==168)||(b[0]==172&&b[1]>=16&&b[1]<=31);
        }
        internal static string Website(string value) {
            if(String.IsNullOrWhiteSpace(value))return "";
            Uri u;Order.Require(Uri.TryCreate(value.Trim(),UriKind.Absolute,out u)&&u.Scheme=="https"&&u.UserInfo==""&&u.Query==""&&u.Fragment==""&&!PrivateHost(u.Host),"Use the public HTTPS website URL, without a query or fragment.");
            if(!u.AbsolutePath.EndsWith("/",StringComparison.Ordinal)&&Path.GetExtension(u.AbsolutePath)=="")u=new Uri(u.AbsoluteUri+"/");
            return new Uri(u,"Fitment_Planner.html").AbsoluteUri;
        }
        static bool PrivateHost(string host) {IPAddress ip;return host.Equals("localhost",StringComparison.OrdinalIgnoreCase)||(IPAddress.TryParse(host,out ip)&&Private(ip));}
        internal static void Worker(WorkerSettings c) {
            Uri u;IPAddress ip;
            Order.Require(c!=null&&Uri.TryCreate(c.baseUrl,UriKind.Absolute,out u)&&u.Scheme=="https"&&IPAddress.TryParse(u.Host,out ip)&&Private(ip)&&u.AbsolutePath=="/"&&u.UserInfo==""&&u.Query==""&&u.Fragment=="","Invalid receiver connection address.");
            Order.Require(c.token!=null&&c.token.Length>=32&&c.workerId!=null&&c.certificateHash!=null&&c.certificateHash.Length==64,"Incomplete worker connection file.");
        }
        internal static bool TyreUrl(Uri u) {return u!=null&&u.Scheme=="https"&&u.Port==443&&u.UserInfo==""&&(u.Host=="tempetyres.com.au"||u.Host=="www.tempetyres.com.au")&&new[]{"/tyres","/tyreproducts","/search"}.Contains(u.AbsolutePath);}
        internal static string FetchTyres(string target) {
            Uri url;Order.Require(Uri.TryCreate(target,UriKind.Absolute,out url)&&TyreUrl(url),"Only Tempe tyre searches and product pages are allowed.");
            for(int redirects=0;redirects<4;redirects++) {
                var req=(HttpWebRequest)WebRequest.Create(url);req.Method="GET";req.AllowAutoRedirect=false;req.Timeout=12000;req.ReadWriteTimeout=12000;req.UserAgent="TempeMobileJobCard/1.0";req.Accept="text/html";req.AutomaticDecompression=DecompressionMethods.GZip|DecompressionMethods.Deflate;
                using(var response=(HttpWebResponse)req.GetResponse()) {
                    int status=(int)response.StatusCode;
                    if(status>=300&&status<400){url=new Uri(url,response.Headers["Location"]??"");Order.Require(TyreUrl(url),"Tempe redirected outside the permitted product pages.");continue;}
                    Order.Require(status>=200&&status<300,"Tempe returned an unsuccessful response.");
                    using(var stream=response.GetResponseStream())using(var memory=new MemoryStream()) {
                        byte[] buffer=new byte[16384];int n;
                        while((n=stream.Read(buffer,0,buffer.Length))>0){Order.Require(memory.Length+n<=8000000,"Product page is too large.");memory.Write(buffer,0,n);}
                        return Encoding.UTF8.GetString(memory.ToArray());
                    }
                }
            }
            throw new InvalidOperationException("Too many product-page redirects.");
        }
    }
    internal sealed class HttpInput {internal string method,path;internal Dictionary<string,string> headers;internal string body;}
    internal sealed class HttpOutput {
        internal int status=200;internal string type="application/json; charset=utf-8";internal byte[] bytes;
        internal Dictionary<string,string> headers=new Dictionary<string,string>();
        internal static HttpOutput Json(object value,int code=200) {return new HttpOutput {status=code,bytes=Encoding.UTF8.GetBytes(Wire.Json(value))};}
        internal static HttpOutput Text(string text,string type) {return new HttpOutput {bytes=Encoding.UTF8.GetBytes(text),type=type};}
    }
    internal sealed class LocalServer : IDisposable {
        readonly TcpListener listener;readonly X509Certificate2 certificate;readonly string expectedHost;
        readonly Func<HttpInput,HttpOutput> route;readonly SemaphoreSlim capacity=new SemaphoreSlim(12);volatile bool stopped;
        internal LocalServer(string address,int port,X509Certificate2 cert,Func<HttpInput,HttpOutput> handler) {
            IPAddress ip=IPAddress.Parse(address);Order.Require(NetworkRules.Private(ip)&&!IPAddress.IsLoopback(ip),"Choose the desk PC's private LAN IPv4 address.");
            listener=new TcpListener(ip,port);certificate=cert;route=handler;expectedHost=address+":"+port;
        }
        internal void Start(){listener.Start(20);var t=new Thread(Accept);t.IsBackground=true;t.Start();}
        void Accept() {
            while(!stopped)try {
                var client=listener.AcceptTcpClient();if(!capacity.Wait(0)){client.Close();continue;}
                ThreadPool.QueueUserWorkItem(delegate {try {Serve(client);}finally {client.Close();capacity.Release();}});
            }catch(SocketException){if(!stopped)Thread.Sleep(200);}catch(ObjectDisposedException){return;}
        }
        void Serve(TcpClient client) {
            if(!NetworkRules.Private(((IPEndPoint)client.Client.RemoteEndPoint).Address))return;
            client.ReceiveTimeout=10000;client.SendTimeout=10000;
            Stream stream=client.GetStream();SslStream tls=null;
            try {
                if(certificate!=null) {tls=new SslStream(stream,false);tls.ReadTimeout=10000;tls.WriteTimeout=10000;tls.AuthenticateAsServer(certificate,false,SslProtocols.Tls12,false);stream=tls;}
                HttpOutput result;
                try {
                    var request=Read(stream);string host;
                    Order.Require(request.headers.TryGetValue("host",out host)&&host.Equals(expectedHost,StringComparison.OrdinalIgnoreCase),"Invalid request host.");
                    result=route(request);
                } catch(Exception e) {result=HttpOutput.Json(new{error=e is InvalidOperationException?e.Message:"Request could not be processed."},400);}
                Write(stream,result);
            }catch(IOException){}catch(AuthenticationException){}catch(ObjectDisposedException){}
            catch(Exception e){System.Diagnostics.Trace.WriteLine("Receiver connection failed: "+e.GetType().Name);}
            finally{if(tls!=null)tls.Dispose();}
        }
        static HttpInput Read(Stream stream) {
            using(var header=new MemoryStream()) {
                int b,matched=0;byte[] ending={13,10,13,10};
                while(matched<4) {
                    b=stream.ReadByte();Order.Require(b>=0&&header.Length<16384,"Invalid or oversized HTTP headers.");header.WriteByte((byte)b);
                    matched=b==ending[matched]?matched+1:(b==13?1:0);
                }
                string[] lines=Encoding.ASCII.GetString(header.ToArray()).Split(new[]{"\r\n"},StringSplitOptions.None);
                string[] start=lines[0].Split(' ');Order.Require(start.Length==3&&start[2]=="HTTP/1.1"&&start[1].StartsWith("/",StringComparison.Ordinal)&&!start[1].StartsWith("//",StringComparison.Ordinal),"Invalid request line.");
                var headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                foreach(string line in lines.Skip(1).Where(x=>x.Length>0)) {
                    int colon=line.IndexOf(':');Order.Require(colon>0&&!Char.IsWhiteSpace(line[0]),"Invalid header.");
                    string key=line.Substring(0,colon).Trim();Order.Require(!headers.ContainsKey(key),"Duplicate header.");headers.Add(key,line.Substring(colon+1).Trim());
                }
                Order.Require(!headers.ContainsKey("transfer-encoding")&&!headers.ContainsKey("expect"),"Chunked or deferred bodies are unsupported.");
                int length=0;string size;
                if(headers.TryGetValue("content-length",out size))Order.Require(Int32.TryParse(size,out length)&&length>=0&&length<=65536,"Invalid request size.");
                byte[] body=new byte[length];int offset=0;
                while(offset<length){int n=stream.Read(body,offset,length-offset);Order.Require(n>0,"Incomplete request body.");offset+=n;}
                return new HttpInput {method=start[0],path=start[1],headers=headers,body=new UTF8Encoding(false,true).GetString(body)};
            }
        }
        static void Write(Stream stream,HttpOutput r) {
            byte[] body=r.bytes??new byte[0];
            var b=new StringBuilder("HTTP/1.1 "+r.status+" "+(r.status==200?"OK":r.status==204?"No Content":"Response")+"\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n");
            b.Append("Content-Type: ").Append(r.type).Append("\r\nContent-Length: ").Append(body.Length).Append("\r\n");
            foreach(var pair in r.headers)b.Append(pair.Key).Append(": ").Append(pair.Value).Append("\r\n");
            b.Append("\r\n");byte[] head=Encoding.ASCII.GetBytes(b.ToString());stream.Write(head,0,head.Length);stream.Write(body,0,body.Length);stream.Flush();
        }
        public void Dispose(){stopped=true;listener.Stop();}
    }
    internal sealed class ReceiverApi {
        internal readonly JobQueue Queue;internal readonly ReceiverSettings Settings;
        internal volatile bool Receiving=true;internal volatile bool WorkerAccepting,WorkerAvailable;
        internal DateTime LastWorker=DateTime.MinValue;internal string WorkerDetail="RDP worker not connected";
        readonly string website;readonly Func<bool> idle;readonly Action<string> incoming;readonly object workerGate=new object();
        internal ReceiverApi(ReceiverSettings settings,JobQueue queue,string site,Func<bool> isIdle,Action<string> onIncoming) {Settings=settings;Queue=queue;website=site;idle=isIdle;incoming=onIncoming;}
        internal bool Connected {get {lock(workerGate)return DateTime.UtcNow-LastWorker<TimeSpan.FromSeconds(15)&&WorkerAccepting;}}
        internal HttpOutput Handle(HttpInput r) {
            string origin;bool hasOrigin=r.headers.TryGetValue("origin",out origin);
            string allowed=String.IsNullOrEmpty(Settings.webUrl)?null:new Uri(Settings.webUrl).GetLeftPart(UriPartial.Authority);
            if(hasOrigin && origin!=Settings.Origin && origin!=allowed)return HttpOutput.Json(new{error="Website origin is not paired with this PC."},403);
            HttpOutput output;
            try {output=Route(r);}catch(Exception e) {output=HttpOutput.Json(new{error=e is InvalidOperationException?e.Message:"Local request failed. Check the desk helper."},e.Message.StartsWith("CONFLICT:",StringComparison.Ordinal)?409:400);}
            if(hasOrigin) {output.headers["Access-Control-Allow-Origin"]=origin;output.headers["Vary"]="Origin";}
            return output;
        }
        HttpOutput Route(HttpInput r) {
            var uri=new Uri(Settings.Origin+r.path);string path=uri.AbsolutePath;
            if(r.method=="OPTIONS") {
                Order.Require(r.headers.ContainsKey("origin"),"Missing origin.");
                var o=new HttpOutput {status=204};o.headers["Access-Control-Allow-Methods"]="GET, POST, OPTIONS";o.headers["Access-Control-Allow-Headers"]="Authorization, Content-Type";o.headers["Access-Control-Allow-Private-Network"]="true";return o;
            }
            if(!path.StartsWith("/api/",StringComparison.Ordinal))return Static(path,r.method);
            string authorization;r.headers.TryGetValue("authorization",out authorization);
            bool worker=path=="/api/worker/v1/poll";
            if(!Wire.Equal(authorization,"Bearer "+(worker?Settings.workerToken:Settings.phoneToken)))return HttpOutput.Json(new{error="Pairing key is invalid."},401);
            if(r.method=="POST") {string type;Order.Require(r.headers.TryGetValue("content-type",out type)&&type.Split(';')[0].Trim()=="application/json","Expected JSON.");}
            if(worker&&r.method=="POST") {
                var hello=Wire.Read<WorkerHello>(r.body);Order.Require(hello!=null&&hello.workerId==Settings.workerId,"Wrong paired worker.");
                if(hello.report!=null){Order.Safe(hello.report.message,"worker message",2000);Order.Safe(hello.report.progress,"worker progress",1000);}
                hello.accepting=hello.accepting&&Receiving;
                var reply=Queue.Poll(hello);
                lock(workerGate){LastWorker=DateTime.UtcNow;WorkerAccepting=hello.accepting;WorkerAvailable=hello.available;WorkerDetail=hello.detail??"Connected";}
                return HttpOutput.Json(reply);
            }
            const string prefix="/api/mobile/v1";
            if(path==prefix+"/health"&&r.method=="GET")return HttpOutput.Json(new{service="tempe-mobile-jobcard",apiVersion=1,receiving=Receiving,workerConnected=Connected,pendingCount=Queue.List().Count(j=>!j.closed&&j.status!="ready_for_review")});
            if(path==prefix+"/jobs"&&r.method=="POST") {
                var job=Wire.Read<MobileJob>(r.body);Order.Require(job!=null,"Missing job.");
                var existing=Queue.Get(job.submissionId);
                Order.Require(existing!=null||(Receiving&&Connected),"The PC receiver or RDP worker is stopped/offline.");
                var status=Queue.Submit(job,idle());if(existing==null)incoming(job.submissionId);return HttpOutput.Json(status);
            }
            if(path.StartsWith(prefix+"/jobs/",StringComparison.Ordinal)) {
                string tail=path.Substring((prefix+"/jobs/").Length);bool retry=tail.EndsWith("/retry",StringComparison.Ordinal);string id=retry?tail.Substring(0,tail.Length-6):tail;
                if(retry&&r.method=="POST") {Order.Require(Receiving&&Connected,"The helper is offline.");var body=Wire.Read<Dictionary<string,string>>(r.body);Order.Require(body!=null&&body.ContainsKey("submissionId")&&body["submissionId"]==id,"Retry ID mismatch.");return HttpOutput.Json(Queue.Retry(id));}
                if(!retry&&r.method=="GET"){var status=Queue.Get(id);return status==null?HttpOutput.Json(new{error="Unknown submission"},404):HttpOutput.Json(status);}
            }
            if(path==prefix+"/tyres"&&r.method=="GET") {
                var query=System.Web.HttpUtility.ParseQueryString(uri.Query);string target=query["url"];
                Order.Require(target!=null&&target.Length<=2500,"Missing or oversized tyre URL.");
                return HttpOutput.Json(new{ok=true,status=200,text=NetworkRules.FetchTyres(target)});
            }
            return HttpOutput.Json(new{error="Route not found"},404);
        }
        HttpOutput Static(string path,string method) {
            if(method!="GET")return HttpOutput.Json(new{error="Method not allowed"},405);
            string relative=Uri.UnescapeDataString(path).TrimStart('/');if(relative=="")relative="Fitment_Planner.html";
            string root=Path.GetFullPath(website)+Path.DirectorySeparatorChar;string file=Path.GetFullPath(Path.Combine(root,relative.Replace('/',Path.DirectorySeparatorChar)));
            if(!file.StartsWith(root,StringComparison.OrdinalIgnoreCase)||!File.Exists(file))return HttpOutput.Json(new{error="File not found"},404);
            string ext=Path.GetExtension(file).ToLowerInvariant();string type;
            switch(ext){case ".html":type="text/html; charset=utf-8";break;case ".js":type="application/javascript; charset=utf-8";break;case ".css":type="text/css; charset=utf-8";break;case ".png":type="image/png";break;case ".jpg":case ".jpeg":type="image/jpeg";break;case ".svg":type="image/svg+xml";break;case ".ico":type="image/x-icon";break;default:return HttpOutput.Json(new{error="File type not served"},404);}
            for(string check=file;check!=null&&check.StartsWith(root,StringComparison.OrdinalIgnoreCase);check=Path.GetDirectoryName(check))if((File.GetAttributes(check)&FileAttributes.ReparsePoint)!=0)return HttpOutput.Json(new{error="Linked files are not served"},404);
            Order.Require(new FileInfo(file).Length<=10000000,"Website file too large.");return new HttpOutput {type=type,bytes=File.ReadAllBytes(file)};
        }
    }
}
