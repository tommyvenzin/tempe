using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace TempeCostar {
    public sealed class Customer {
        public string name, streetAddress, address2, suburb, state, postcode, phone, email;
    }
    public sealed class Shipping {
        public string name, streetAddress, address2, suburb, state, postcode, contact, businessPhone, mobilePhone, email, shipVia, instructions;
    }
    public sealed class OrderLine {
        public string kind, sourceSku, code, description;
        public int quantity, unitCents, totalCents;
    }
    internal sealed class ItemStep {
        internal OrderLine Line;
        internal string Code;
    }
    public sealed class Order {
        public int schema, totalCents;
        public string createdUtc, orderId, vehicle, rego, pickupDate, pickupTime, comment;
        public string type, deliveryMethod, deliveringBranch, paymentMethod;
        // The website store of a pickup ("Tempe NSW"); sent by the Tempe Orders page from 2.3.0.
        public string store;
        public int freightCents, surchargeCents, discountCents;
        public bool requiresReview;
        public Customer customer;
        public Shipping shipping;
        public List<OrderLine> lines;
        internal bool IsDelivery { get { return schema==2 && type=="delivery"; } }
        internal List<ItemStep> ItemSteps(bool includeFitting) {
            // Wheel dimensions distinguish wheel rows from tyre sizes such as
            // 275/65R17 or 35X12.5R17. Keep source order within each group.
            var steps=lines.Where(l=>l.kind!="service").OrderBy(l=>
                l.kind=="package" || Regex.IsMatch(Norm(l.description),@"\b(?:1[0-9]|2[0-9])(?:\.\d+)?\s*[X\u00D7]\s*\d{1,2}(?:\.\d+)?J?(?=\s|$)") ||
                Regex.IsMatch(Norm(l.description),@"\b(?:ALLOY|STEEL) WHEELS?\b") ? 0 : 1)
                .Select(l=>new ItemStep { Line=l,Code=l.code }).ToList();
            if(!IsDelivery && includeFitting && lines.Any(l=>l.kind=="product")) steps.Add(new ItemStep { Code="M FB" });
            steps.AddRange(lines.Where(l=>l.kind=="service").Select(l=>new ItemStep { Line=l,Code=l.code }));
            return steps;
        }
        internal int TotalBeforeSurchargeCents { get { return totalCents-surchargeCents; } }
        internal bool MatchesCostarTotal(int actualCents) {
            // COSTAR owns the surcharge. Its Repair Order total may show the
            // amount before or after that automatic fee; never enter it twice.
            return actualCents==totalCents || (surchargeCents>0 && actualCents==TotalBeforeSurchargeCents);
        }
        internal string DeliveryVehicleNote { get { return Clean(vehicle)+(String.IsNullOrWhiteSpace(rego)?"":" | REGO: "+rego); } }
        internal static string Clean(string s) { return (s ?? "").Trim(); }
        internal static string EntryText(string s) { return (s ?? "").ToUpperInvariant(); }
        internal static string Norm(string s) { return Regex.Replace(Clean(s), @"\s+", " ").ToUpperInvariant(); }
        // COSTAR shows Time in as "8:08 am". Booking "10:30" -> "10:30 am", "13:05" -> "1:05 pm".
        // DET goes in first, on line 6 with its notes under it, and the tyres, M FB and alignment
        // then fill the lines above it (Tommy, 9 Oct 2026: COSTAR can lose DET's notes when DET
        // is entered last). An order with more than 4 item lines moves DET down so one empty
        // line always stays between the last item and DET.
        internal static int DetLine(int itemLines) { return Math.Max(6, itemLines + 2); }
        internal static string TimeInText(string hhmm) {
            DateTime t;
            if(!DateTime.TryParseExact((hhmm??"").Trim(),"HH:mm",CultureInfo.InvariantCulture,DateTimeStyles.None,out t)) return null;
            return t.ToString("h:mm",CultureInfo.InvariantCulture)+(t.Hour<12?" am":" pm");
        }
        // Minutes after midnight for "10:30 am", "10:30 AM", "10:30am", "22:30"; -1 if not a time.
        internal static int ClockMinutes(string text) {
            var m=Regex.Match((text??"").Trim().ToUpperInvariant(),@"^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|A\.M\.|P\.M\.)?$");
            if(!m.Success) return -1;
            int h=Int32.Parse(m.Groups[1].Value,CultureInfo.InvariantCulture),min=Int32.Parse(m.Groups[2].Value,CultureInfo.InvariantCulture);
            string half=m.Groups[3].Value;
            if(min>59) return -1;
            if(half.Length>0) { if(h<1||h>12) return -1; h=h%12+(half.StartsWith("P")?12:0); }
            else if(h>23) return -1;
            return h*60+min;
        }
        internal static string Phone(string s) { return Regex.Replace(s ?? "", @"\D", ""); }
        internal static void Require(bool yes, string message) { if (!yes) throw new InvalidOperationException(message); }
        internal static void Safe(string text, string field, int limit) {
            Require((text ?? "").Length <= limit && !(text ?? "").Any(Char.IsControl), "Check " + field + ": invalid length or control characters.");
        }
        public void Validate(bool fresh) {
            Require((schema == 1 || schema == 3 || IsDelivery) && Regex.IsMatch(orderId ?? "", @"^TTW\d{1,20}$"), "Unsupported order data. Update both the HTML page and Windows helper.");
            // Schema 3 (2.3.0): a pickup at another store; it must say which store.
            Require(schema != 3 || !String.IsNullOrWhiteSpace(store), "This pickup does not say which store it belongs to. Reload the Tempe Orders page and send it again.");
            DateTimeOffset created;
            Require(DateTimeOffset.TryParse(createdUtc, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out created), "Order timestamp is missing.");
            if (fresh) Require(created <= DateTimeOffset.UtcNow.AddMinutes(2) && created >= DateTimeOffset.UtcNow.AddMinutes(-30), "Click Send to COSTAR again to refresh this order.");
            Require(customer != null && !String.IsNullOrWhiteSpace(customer.name) && Phone(customer.phone).Length >= 8, "Customer name and a valid phone number are required.");
            Safe(customer.name, "name", 200); Safe(customer.streetAddress, "address", 240); Safe(customer.suburb, "suburb", 120);
            Safe(customer.postcode, "postcode", 12); Safe(customer.phone, "phone", 30); Safe(customer.email, "email", 240);
            Safe(customer.address2,"second address line",240); Safe(customer.state,"state",30);
            Safe(vehicle, "vehicle", 400); Safe(rego, "rego", 30); Safe(comment, "comment", 240); Safe(store, "store", 80);
            Require(surchargeCents>=0 && surchargeCents<=100000000,"The online card surcharge is invalid.");
            Require(discountCents==0,"Nonzero discounts still need their COSTAR entry mapped.");
            if(IsDelivery) {
                Require(shipping!=null && (deliveryMethod=="WITHIN AUSTRALIA" || deliveryMethod=="FITTING PARTNER"),"Delivery details are missing or unsupported.");
                Safe(shipping.name,"delivery recipient",200); Safe(shipping.streetAddress,"delivery street",240); Safe(shipping.address2,"delivery address line 2",240);
                Safe(shipping.suburb,"delivery suburb",120); Safe(shipping.state,"delivery state",30); Safe(shipping.postcode,"delivery postcode",12);
                Safe(shipping.contact,"delivery contact",120); Safe(shipping.businessPhone,"delivery phone",30); Safe(shipping.mobilePhone,"delivery mobile",30);
                Safe(shipping.email,"delivery email",240); Safe(shipping.shipVia,"Ship Via",40); Safe(shipping.instructions,"shipping instructions",200);
                Safe(deliveringBranch,"delivering branch",80); Safe(paymentMethod,"payment method",80);
                Require(!String.IsNullOrWhiteSpace(shipping.name) && !String.IsNullOrWhiteSpace(shipping.streetAddress) && !String.IsNullOrWhiteSpace(shipping.suburb),"Delivery recipient/address is incomplete.");
                Require(!String.IsNullOrWhiteSpace(customer.streetAddress) && !String.IsNullOrWhiteSpace(customer.suburb),"Billing address is incomplete.");
                Require(Regex.IsMatch(shipping.state??"",@"^(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)$") && Regex.IsMatch(customer.state??"",@"^(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)$") && Regex.IsMatch(shipping.postcode??"",@"^\d{4}$") && Regex.IsMatch(customer.postcode??"",@"^\d{4}$"),"Billing/delivery state or postcode is invalid.");
                Require(freightCents>=0 && freightCents<=100000000,"Freight is invalid.");
                Require(comment=="DFE"+(requiresReview?" - PACKAGE REVIEW":""),"Delivery comment does not match the review status. Update the HTML page and send the order again.");
            } else {
                DateTime pickup;
                Require(DateTime.TryParseExact(pickupDate + " " + pickupTime, "yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out pickup), "Pickup date/time is invalid.");
                string expected = (String.IsNullOrWhiteSpace(rego) ? "" : rego + " - ") + pickup.DayOfWeek.ToString().ToUpperInvariant() + " - ONLINE " + pickupTime;
                Require(comment == expected, "Pickup comment does not match the order.");
                Require(!requiresReview && freightCents==0,"Pickup totals require complete product/service lines and no freight.");
            }
            Require(lines != null && lines.Count > 0 && lines.Count <= 12, "This test version supports 1-12 priced lines.");
            long total = 0;
            foreach (OrderLine line in lines) {
                Require(line != null, "Missing order line.");
                Safe(line.description, "product description", 500);
                Require(!String.IsNullOrWhiteSpace(line.description), "Product description is missing.");
                Require(line.quantity > 0 && line.quantity <= 100 && line.unitCents > 0 && line.unitCents <= 100000000, "Invalid quantity or unit price.");
                Require((long)line.quantity * line.unitCents == line.totalCents, "Line quantity/price does not match its total.");
                if (line.kind == "service") {
                    // Match the HTML parser's empty-SKU/service-prefix normalization.
                    string d = Regex.Replace(Norm(line.description), @"^[:\s]*(?:SERVICES?\s*:[\s:]*)?", "");
                    d = Regex.Replace(d.Replace("(", " ").Replace(")", " "), @"\s+", " ").Trim();
                    bool front = Regex.IsMatch(d, @"^(FRONT (WHEEL )?ALIGNMENT|(WHEEL )?ALIGNMENT FRONT( ONLY)?)$");
                    bool both = Regex.IsMatch(d, @"^(FRONT (&|AND) REAR (WHEEL )?ALIGNMENT|(WHEEL )?ALIGNMENT FRONT (&|AND) REAR)$");
                    Require((front && line.code == "WA") || (both && line.code == "WAFR"), "Alignment description/code mismatch.");
                } else {
                    Require((line.kind == "product" || (IsDelivery && line.kind=="package")) && Regex.IsMatch(line.code ?? "", @"^[A-Z0-9][A-Z0-9._-]{0,39}$") && line.code == line.sourceSku,
                        "Invalid product code.");
                    Require(!Regex.IsMatch(line.code, @"^(F|M|DET|WA|WAFR|SERVICES?)$") && !Regex.IsMatch(Norm(line.description), @"\bALIGNMENT\b|\bSERVICES?\s*:"), "A service must have an explicit mapping.");
                    bool package=Regex.IsMatch(Norm(line.description),@"\bPACKAGE\b") && Regex.IsMatch(Norm(line.description),@"\bWITH TYRES?\b");
                    Require(package==(line.kind=="package"),"A wheel/tyre package must be marked for manual completion.");
                }
                total += line.totalCents;
            }
            Require(requiresReview==lines.Any(l=>l.kind=="package"),"Manual review is allowed only for incomplete package lines.");
            Require(total + freightCents + surchargeCents == totalCents && totalCents > 0 && totalCents <= 100000000, "Online total differs from the exported line totals, freight and card surcharge.");
        }
    }

    internal static class CustomerEntry {
        internal static bool LookupResolved(string account,string name,string phone,string requestedPhone) {
            return Order.Phone(phone)==Order.Phone(requestedPhone) && Order.Phone(requestedPhone).Length>=8 &&
                (String.IsNullOrWhiteSpace(account) || !String.IsNullOrWhiteSpace(name));
        }
        internal static bool HasMatch(string account,string name,string phone,string requestedPhone) {
            return LookupResolved(account,name,phone,requestedPhone) && !String.IsNullOrWhiteSpace(name);
        }
        internal static string NameForEntry(string costarName,string incomingName) {
            return String.IsNullOrWhiteSpace(costarName)?Order.EntryText(incomingName):costarName;
        }
        internal static bool SameIdentity(string account,string name,string phone,string expectedAccount,string expectedName,string expectedPhone) {
            return account==expectedAccount && name==expectedName && Order.Phone(phone)==Order.Phone(expectedPhone);
        }
    }

    public sealed class ControlInfo {
        public long Handle, Root, Parent;
        public int Style;
        public string Class;
        public bool Visible, Enabled, Password;
        public int[] Bounds, RelativeBounds;
        string text, textState;
        // A snapshot may deliberately skip reading a control's text ("skipped"). If any
        // code then asks for it, Late reads it on the spot, so a missed field costs one
        // extra read (logged), never a wrong or missing value.
        internal Action<ControlInfo> Late;
        public string Text { get { Load(); return text; } set { text = value; } }
        public string TextState { get { Load(); return textState; } set { textState = value; } }
        // The text only if it was already read; never triggers a read. For label searches.
        internal string Peek { get { return textState == "read" ? text : null; } }
        internal bool Skipped { get { return textState == "skipped"; } }
        void Load() { var late = Late; if (late != null && textState == "skipped") { Late = null; late(this); } }
        internal int X { get { return RelativeBounds[0]; } }
        internal int Y { get { return RelativeBounds[1]; } }
        internal int W { get { return RelativeBounds[2]; } }
        internal int H { get { return RelativeBounds[3]; } }
        internal bool Edit { get { return Visible && Enabled && !Password && Class.IndexOf("EDIT", StringComparison.OrdinalIgnoreCase) >= 0 && W > 20 && H > 10; } }
        internal bool Static { get { return Visible && Class.IndexOf("STATIC", StringComparison.OrdinalIgnoreCase) >= 0; } }
        internal string Value { get { Order.Require(TextState == "read", "A COSTAR field is still loading. Try again after it is ready."); return Order.Clean(Text); } }
    }
    internal sealed class FieldMap {
        internal ControlInfo Name, Account, Address, Address2, Suburb, State, Postcode, Phone, Email, PO, Comment;
    }
    internal sealed class ShippingMap {
        internal ControlInfo Name, Account, Address, Address2, Suburb, State, Postcode, Contact, BusinessPhone, MobilePhone, Email, ShipVia, Instructions;
    }
    internal sealed class Grid {
        internal ControlInfo Item, Description, Quantity, Net, ListPrice;
        internal long Parent;
        internal List<ControlInfo> Rows;
        // COSTAR's item grid is 25 lines, 19 px apart, each line its own box (checked in real
        // captures). Line N is then the Nth box from the top, but only while they are evenly
        // spaced, so anything typed on a numbered line checks this first.
        internal bool EvenLines {
            get {
                if(Rows==null || Rows.Count==0) return false;
                if(Rows.Count==1) return true;
                int pitch=Rows[1].Y-Rows[0].Y;
                if(pitch<=0) return false;
                for(int i=2;i<Rows.Count;i++) if(Math.Abs(Rows[i].Y-Rows[i-1].Y-pitch)>1) return false;
                return true;
            }
        }
        // The 1-based line of an item box, or 0 if it is not in this grid.
        internal int LineOf(long handle) { int i=Rows==null?-1:Rows.FindIndex(r=>r.Handle==handle); return i<0?0:i+1; }
    }
    internal sealed class MemoTarget {
        internal ControlInfo Row, Editor;
    }
    // A popup shown during customer lookup, classified without side effects.
    internal sealed class ChooserInfo {
        internal bool IsChooser, EnterAllowed;
        internal ControlInfo Accept;
        internal long ListBox;
        internal string Reason = "";
    }
    // Online orders copied while another one is being entered wait here, in order,
    // once each. Orders already entered in this session are refused, so a second
    // "Send to COSTAR" click can never create a duplicate Repair Order.
    internal sealed class OrderQueue {
        readonly Queue<Order> waiting = new Queue<Order>();
        readonly HashSet<string> queued = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        readonly HashSet<string> entered = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        internal int Count { get { return waiting.Count; } }
        // "queued", "duplicate" (already waiting or current) or "entered" (done earlier).
        internal string Add(Order order, string currentId) {
            string id = order.orderId ?? "";
            if (entered.Contains(id)) return "entered";
            if (queued.Contains(id) || String.Equals(id, currentId, StringComparison.OrdinalIgnoreCase)) return "duplicate";
            queued.Add(id); waiting.Enqueue(order); return "queued";
        }
        internal Order Next() { if (waiting.Count == 0) return null; var o = waiting.Dequeue(); queued.Remove(o.orderId ?? ""); return o; }
        internal void Entered(string id) { if (!String.IsNullOrEmpty(id)) entered.Add(id); }
        internal bool WasEntered(string id) { return !String.IsNullOrEmpty(id) && entered.Contains(id); }
        internal void Clear() { waiting.Clear(); queued.Clear(); }
    }
    public static class Selectors {
        internal static bool CustomerSearchInProgress(List<ControlInfo> s) {
            return s.Any(c=>c.Static && c.TextState=="read" && Order.Norm(c.Text).TrimEnd('.','\u2026')=="SEARCHING");
        }
        // Which grid controls must be read for the engine's grid logic: the five header
        // labels and the editable cells under them (item code, description, quantity,
        // net, list). Other cells, display labels and buttons are never consulted.
        // Returns null (read everything) if a remembered label has gone.
        internal static HashSet<long> GridReadSet(List<ControlInfo> s, long[] labels) {
            if (labels == null) return null;
            var byHandle = new Dictionary<long, ControlInfo>(s.Count);
            foreach (var c in s) byHandle[c.Handle] = c;
            var columns = new List<ControlInfo>(labels.Length);
            foreach (long h in labels) { ControlInfo c; if (!byHandle.TryGetValue(h, out c) || !c.Static) return null; columns.Add(c); }
            var wanted = new HashSet<long>(labels);
            foreach (var c in s) {
                if (!c.Edit) continue;
                foreach (var col in columns) if (Near(c.X, col.X, Math.Max(6, col.H / 3))) { wanted.Add(c.Handle); break; }
            }
            return wanted;
        }
        static readonly string[] AcceptCaptions = { "OK", "SELECT", "CHOOSE", "USE", "ACCEPT", "LOAD", "OPEN", "USE SELECTED", "SELECT CUSTOMER" };
        static bool Risky(string caption) {
            string t = Order.Norm(caption).Replace("&", "");
            return t == "YES" || t == "NO" || t.Contains("DELETE") || t.Contains("REMOVE") || t.Contains("SAVE") || t.Contains("CONFIRM") ||
                t.Contains("NEW") || t.Contains("CREATE") || t.Contains("ADD") || t.Contains("MERGE");
        }
        // A phone with two or more COSTAR accounts opens a selection list. Recognises that
        // list (a list box/view, or a WinForms form with a large list area and an
        // OK/Select button) and never a plain message box (#32770 with text and buttons).
        internal static ChooserInfo AccountChooser(string windowClass, List<ControlInfo> s) {
            var info = new ChooserInfo();
            var buttons = s.Where(c => c.Visible && c.Class.IndexOf("BUTTON", StringComparison.OrdinalIgnoreCase) >= 0).ToList();
            var list = s.FirstOrDefault(c => c.Visible && (c.Class.IndexOf("LISTBOX", StringComparison.OrdinalIgnoreCase) >= 0 ||
                c.Class.IndexOf("LISTVIEW", StringComparison.OrdinalIgnoreCase) >= 0 || c.Class.IndexOf("SysListView32", StringComparison.OrdinalIgnoreCase) >= 0));
            bool listArea = s.Any(c => c.Visible && c.Class.IndexOf("WindowsForms10.Window", StringComparison.OrdinalIgnoreCase) >= 0 &&
                c.RelativeBounds != null && c.W >= 200 && c.H >= 60);
            bool dataGridScroll = s.Any(c => c.Visible && c.Class.IndexOf("SCROLLBAR", StringComparison.OrdinalIgnoreCase) >= 0);
            if (list != null && list.Class.IndexOf("LISTBOX", StringComparison.OrdinalIgnoreCase) >= 0) info.ListBox = list.Handle;
            // OK may be greyed out until a row is highlighted (COSTAR's customer Search list).
            var accepts = buttons.Where(c => c.TextState == "read" && AcceptCaptions.Contains(Order.Norm(c.Text).Replace("&", ""))).ToList();
            info.Accept = accepts.Count == 1 ? accepts[0] : null;
            bool risky = buttons.Any(c => c.TextState == "read" && Risky(c.Text));
            bool dialogClass = (windowClass ?? "").StartsWith("#32770", StringComparison.Ordinal);
            if (list != null) { info.IsChooser = true; info.Reason = "list control"; }
            else if (!dialogClass && (listArea || dataGridScroll) && info.Accept != null) { info.IsChooser = true; info.Reason = "list area with " + Order.Norm(info.Accept.Text).Replace("&", ""); }
            else { info.Reason = dialogClass ? "message box" : "no list"; return info; }
            info.EnterAllowed = !risky;
            return info;
        }
        internal static bool CustomerNotFoundNotice(List<ControlInfo> s) {
            var messages=s.Where(c=>c.Static && c.TextState=="read" && !String.IsNullOrWhiteSpace(c.Text)).ToList();
            var buttons=s.Where(c=>c.Visible && c.Class.IndexOf("BUTTON",StringComparison.OrdinalIgnoreCase)>=0).ToList();
            return messages.Count==1 && Order.Norm(messages[0].Text).TrimEnd('.','!')=="CUSTOMER NOT FOUND" &&
                buttons.Count==1 && buttons[0].Enabled && buttons[0].TextState=="read" && Order.Norm(buttons[0].Text).Replace("&","")=="OK";
        }
        internal static ControlInfo CustomerCancelButton(List<ControlInfo> s) {
            var buttons=s.Where(c=>c.Visible && c.Enabled && c.TextState=="read" && c.Class.IndexOf("BUTTON",StringComparison.OrdinalIgnoreCase)>=0).ToList();
            foreach(string caption in new[]{"CANCEL","CLOSE"}) {
                var matches=buttons.Where(c=>Order.Norm(c.Text).Replace("&","")==caption).ToList();
                if(matches.Count==1) return matches[0];
                if(matches.Count>1) return null;
            }
            return null;
        }
        internal static ControlInfo One(IEnumerable<ControlInfo> controls, string field) {
            var matches = controls.ToList();
            Order.Require(matches.Count == 1, "Could not uniquely locate " + field + " in this COSTAR layout (" + matches.Count + " matches).");
            return matches[0];
        }
        internal static bool Near(int a, int b, int tolerance) { return Math.Abs(a-b) <= tolerance; }
        internal static ControlInfo Label(List<ControlInfo> s, string text, long parent) {
            return One(s.Where(c => c.Static && (parent == 0 || c.Parent == parent) && Order.Norm(c.Peek) == text), text + " label");
        }
        // COSTAR's "Time in": a time box (combo with an edit inside) under its label, next to
        // Promised and PO#. Optional: null when the layout is different.
        internal static ControlInfo TimeIn(List<ControlInfo> s) {
            var labels = s.Where(c => c.Static && Order.Norm(c.Peek) == "TIME IN").ToList();
            if (labels.Count != 1) return null;
            var label = labels[0]; int t = Math.Max(4, label.H / 3);
            var combos = s.Where(c => c.Visible && c.Parent == label.Parent && c.Class.IndexOf("COMBOBOX", StringComparison.OrdinalIgnoreCase) >= 0 &&
                Near(c.X, label.X, t) && Near(c.Y, label.Y + label.H, t)).ToList();
            if (combos.Count != 1) return null;
            var edits = s.Where(c => c.Edit && c.Parent == combos[0].Handle).ToList();
            return edits.Count == 1 ? edits[0] : null;
        }
        // COSTAR's "Search for an Existing Customer" window shows "Nothing found!" when the
        // search returned no accounts.
        internal static bool NothingFound(List<ControlInfo> s) {
            return s.Any(c => c.Static && c.TextState == "read" && Order.Norm(c.Text).StartsWith("NOTHING FOUND"));
        }
        // A text box to the right of its label (the Search window: "Phone", "Branch" ...).
        internal static ControlInfo FieldRightOf(List<ControlInfo> s, string label) {
            var labels = s.Where(c => c.Static && Order.Norm(c.Peek) == label).ToList();
            if (labels.Count != 1) return null;
            var l = labels[0]; int mid = l.Y + l.H / 2;
            var boxes = s.Where(c => c.Edit && c.X >= l.X + l.W - 6 && c.X <= l.X + l.W + 40 && Math.Abs(c.Y + c.H / 2 - mid) <= 6).ToList();
            return boxes.Count == 1 ? boxes[0] : null;
        }
        // The Repair Order's Ship Via box (under its label in the Ship to panel). Null if absent.
        internal static ControlInfo ShipVia(List<ControlInfo> s) {
            var labels = s.Where(c => c.Static && Order.Norm(c.Peek) == "SHIP VIA").ToList();
            if (labels.Count != 1) return null;
            var label = labels[0]; int t = Math.Max(4, label.H / 3);
            var boxes = s.Where(c => c.Edit && c.Parent == label.Parent && Near(c.X, label.X, t) && Near(c.Y, label.Y + label.H, t)).ToList();
            return boxes.Count == 1 ? boxes[0] : null;
        }
        internal static ControlInfo Under(List<ControlInfo> s, ControlInfo label) {
            int tolerance = Math.Max(4, label.H / 3);
            return One(s.Where(c => c.Edit && c.Parent == label.Parent && Near(c.X,label.X,tolerance) && Near(c.Y,label.Y+label.H,tolerance)), label.Text);
        }
        internal static FieldMap Header(List<ControlInfo> s) {
            var label = One(s.Where(c => c.Static && Order.Norm(c.Peek).StartsWith("ACCOUNT#") && Order.Norm(c.Peek).EndsWith("NAME")), "customer name/account label");
            int t = Math.Max(4, label.H/3);
            var children = s.Where(c => c.Edit && c.Parent == label.Parent).ToList();
            var first = children.Where(c => Near(c.Y,label.Y+label.H,t)).OrderBy(c => c.X).ToList();
            Order.Require(first.Count == 2 && first[0].W < first[1].W && Near(first[0].X,label.X,t), "Customer name/account layout is unfamiliar.");
            var m = new FieldMap { Account=first[0], Name=first[1] };
            m.Address = One(children.Where(c => Near(c.X,label.X,t) && Near(c.Y,m.Name.Y+m.Name.H,t) && c.W > m.Name.W), "address");
            m.Address2 = One(children.Where(c => Near(c.X,label.X,t) && Near(c.Y,m.Address.Y+m.Address.H,t) && Near(c.W,m.Address.W,t)), "second address line");
            var city = children.Where(c => Near(c.Y,m.Address2.Y+m.Address2.H,t)).OrderBy(c => c.X).ToList();
            Order.Require(city.Count == 3 && Near(city[0].X,label.X,t) && city[0].W > city[1].W && city[2].W > city[1].W, "Suburb/state/postcode layout is unfamiliar.");
            m.Suburb=city[0]; m.State=city[1]; m.Postcode=city[2];
            m.Phone=Under(s,Label(s,"MOBILE PH",label.Parent)); m.Email=Under(s,Label(s,"EMAIL",label.Parent)); m.PO=Under(s,Label(s,"PO#",label.Parent));
            var comment = Label(s,"COMMENT",0);
            m.Comment=One(s.Where(c => c.Edit && c.Parent==comment.Parent && Near(c.Y,comment.Y,t) && c.X>=comment.X+comment.W && c.X<comment.X+comment.W+120*t/4), "comment");
            return m;
        }
        internal static ShippingMap Delivery(List<ControlInfo> s) {
            var anchor=Label(s,"SHIP VIA",0); var header=Header(s);
            var children=s.Where(c=>c.Edit && c.Parent==anchor.Parent).ToList(); int t=Math.Max(4,anchor.H/3);
            var first=children.Where(c=>Near(c.Y,header.Name.Y,t)).OrderBy(c=>c.X).ToList();
            Order.Require(first.Count==2 && Near(first[0].X,anchor.X,t) && first[0].W<first[1].W,"Delivery name/account layout is unfamiliar.");
            var m=new ShippingMap { Account=first[0],Name=first[1] };
            m.Address=One(children.Where(c=>Near(c.X,anchor.X,t) && Near(c.Y,m.Name.Y+m.Name.H,t) && c.W>m.Name.W),"delivery address");
            m.Address2=One(children.Where(c=>Near(c.X,anchor.X,t) && Near(c.Y,m.Address.Y+m.Address.H,t) && Near(c.W,m.Address.W,t)),"delivery second address line");
            var city=children.Where(c=>Near(c.Y,m.Address2.Y+m.Address2.H,t)).OrderBy(c=>c.X).ToList();
            Order.Require(city.Count==3 && Near(city[0].X,anchor.X,t) && city[0].W>city[1].W && city[2].W>city[1].W,"Delivery suburb/state/postcode layout is unfamiliar.");
            m.Suburb=city[0];m.State=city[1];m.Postcode=city[2];
            m.Contact=Under(s,Label(s,"CONTACT",anchor.Parent));m.BusinessPhone=Under(s,Label(s,"BUS PH",anchor.Parent));
            m.MobilePhone=Under(s,Label(s,"MOBILE PH",anchor.Parent));m.Email=Under(s,Label(s,"EMAIL",anchor.Parent));
            m.ShipVia=Under(s,anchor);m.Instructions=Under(s,Label(s,"SHIPPING INSTRUCTIONS",anchor.Parent));return m;
        }
        // A new Repair Order shows its branch's own suburb (TEMPE in Branch 11). Branch 11 keeps
        // the observed default; other branches (2.3.0+) accept their own single default suburb,
        // because every customer field around it must still be empty.
        internal static bool DefaultSuburb(string suburb,int branch) {
            string v=Order.Norm(suburb);
            return v.Length==0 || (branch==11 ? v=="TEMPE" : v.Length<=40);
        }
        internal static bool DefaultState(string state,int branch) {
            string v=Order.Norm(state);
            return v.Length==0 || (branch==11 ? v=="NSW" : Regex.IsMatch(v,@"^(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)$"));
        }
        internal static void BlankDelivery(List<ControlInfo> s,int branch) {
            var m=Delivery(s);
            foreach(var c in new[]{m.Account,m.Name,m.Address,m.Address2,m.Postcode,m.Contact,m.BusinessPhone,m.MobilePhone,m.Email,m.ShipVia,m.Instructions})
                Order.Require(c.Value.Length==0,"Open a NEW, empty Repair Order. Delivery fields already contain data.");
            Order.Require(DefaultSuburb(m.Suburb.Value,branch),"Delivery suburb is not blank/default.");
            Order.Require(DefaultState(m.State.Value,branch),"Delivery state is not blank/default.");
        }
        internal static Grid ProductGrid(List<ControlInfo> s) {
            var h = Label(s,"ITEM",0);
            var g = new Grid { Item=h, Parent=h.Parent, Description=Label(s,"DESCRIPTION",h.Parent), Quantity=Label(s,"QTY OR HRS",h.Parent), Net=Label(s,"NET",h.Parent), ListPrice=Label(s,"LIST",h.Parent) };
            var panels=new HashSet<long>(s.Where(c=>c.Parent==h.Parent).Select(c=>c.Handle));
            int tolerance=Math.Max(6,h.H/3);
            g.Rows=s.Where(c=>c.Edit && panels.Contains(c.Parent) && Near(c.X,h.X,tolerance) && c.Y>=h.Y+h.H-3 && c.W>h.W).OrderBy(c=>c.Y).ToList();
            Order.Require(g.Rows.Count>0 && g.Rows.Select(c=>c.Y).Distinct().Count()==g.Rows.Count,"The item grid is not ready or has overlapping rows.");
            return g;
        }
        internal static ControlInfo Cell(List<ControlInfo> s, ControlInfo row, ControlInfo column) {
            return One(s.Where(c=>c.Edit && c.Parent==row.Parent && Near(c.X,column.X,Math.Max(6,column.H/3)) && Near(c.Y,row.Y,Math.Max(3,row.H/4))), column.Text + " cell");
        }
        internal static MemoTarget FindMemo(List<ControlInfo> s, string prefix, string code) {
            var g=ProductGrid(s);
            var matches=g.Rows.Where(r=>Order.Norm(r.Value)==code)
                .Select(r=>new MemoTarget { Row=r,Editor=Cell(s,r,g.Description) })
                .Where(t=>Order.Norm(t.Editor.Value).StartsWith(prefix+":",StringComparison.Ordinal)).ToList();
            Order.Require(matches.Count<=1,"More than one " + prefix + " note exists.");
            return matches.Count==1 ? matches[0] : null;
        }
        internal static string MemoSignature(MemoTarget target) {
            return target.Row.Handle + ":" + target.Editor.Handle + ":" + target.Editor.Parent + ":" +
                String.Join(",",target.Row.Bounds.Select(n=>n.ToString(CultureInfo.InvariantCulture))) + ":" +
                String.Join(",",target.Editor.Bounds.Select(n=>n.ToString(CultureInfo.InvariantCulture)));
        }
        internal static int Cents(ControlInfo c) {
            decimal n; string text=c.Value.Replace("$","").Replace(",","").Trim();
            Order.Require(Decimal.TryParse(text,NumberStyles.Number,CultureInfo.InvariantCulture,out n) && n>=0 && n<=1000000,"Could not read a COSTAR amount.");
            return Decimal.ToInt32(Decimal.Round(n*100,0,MidpointRounding.AwayFromZero));
        }
        internal static int Total(List<ControlInfo> s) {
            var h=Label(s,"TAX IN",0);
            var c=One(s.Where(x=>x.Static && x.Parent==h.Parent && Near(x.X,h.X,Math.Max(5,h.H/3)) && Near(x.Y,h.Y+h.H,Math.Max(4,h.H/3))),"tax-inclusive total");
            return Cents(c);
        }
        // A Repair Order that already holds THIS order's customer (same phone) and
        // nothing else of another order: PO#/comment empty or this order's, no item
        // rows and a zero total. Entry continues and updates differing details.
        // A Repair Order this order was already started in: its PO# is the order number and the
        // phone is the order's phone (items may already be there). Used to resume a stopped fill.
        internal static bool SameOrderInProgress(List<ControlInfo> s,Order order) {
            var m=Header(s);
            if(Order.Norm(m.PO.Value)!=Order.Norm(order.orderId) || order.orderId.Trim().Length==0) return false;
            string phone=Order.Phone(m.Phone.Value);
            if(phone.Length<8 || phone!=Order.Phone(order.customer.phone)) return false;
            return m.Comment.Value.Length==0 || Order.Norm(m.Comment.Value)==Order.Norm(order.comment);
        }
        internal static bool SameCustomerStart(List<ControlInfo> s,Order order) {
            var m=Header(s);string phone=Order.Phone(m.Phone.Value);
            if(phone.Length<8 || phone!=Order.Phone(order.customer.phone)) return false;
            if(m.PO.Value.Length>0 && Order.Norm(m.PO.Value)!=Order.Norm(order.orderId)) return false;
            if(m.Comment.Value.Length>0 && Order.Norm(m.Comment.Value)!=Order.Norm(order.comment)) return false;
            return ProductGrid(s).Rows.All(c=>c.Value.Length==0) && Total(s)==0;
        }
        internal static void Blank(List<ControlInfo> s,int branch) {
            FieldMap m=Header(s);
            foreach(var c in new[]{m.Account,m.Name,m.Address,m.Address2,m.Postcode,m.Phone,m.Email,m.PO,m.Comment})
                Order.Require(c.Value.Length==0,"Open a NEW, empty Repair Order. A customer/order field already contains data.");
            Order.Require(DefaultSuburb(m.Suburb.Value,branch),"Open a NEW, empty Repair Order. A suburb other than this branch's default is already present.");
            Order.Require(ProductGrid(s).Rows.All(c=>c.Value.Length==0) && Total(s)==0,"Open a NEW, empty Repair Order. This form already contains items or a total.");
        }
        internal static void DirectCustomerStart(List<ControlInfo> s,Order order) {
            var m=Header(s);
            Order.Require(m.Account.Value.Length==0,"Direct entry must start without a selected customer account.");
            Order.Require((m.Name.Value.Length==0 || Order.Norm(m.Name.Value)==Order.Norm(order.customer.name)) &&
                (m.Phone.Value.Length==0 || Order.Phone(m.Phone.Value)==Order.Phone(order.customer.phone)),"The existing customer name/phone belongs to another order. Open an empty Repair Order.");
            Order.Require((m.PO.Value.Length==0 || Order.Norm(m.PO.Value)==order.orderId) && (m.Comment.Value.Length==0 || Order.Norm(m.Comment.Value)==Order.Norm(order.comment)),"This Repair Order has a different PO# or comment.");
            Order.Require(ProductGrid(s).Rows.All(c=>c.Value.Length==0) && Total(s)==0,"Direct customer entry cannot replace an order that already has product rows or a total.");
        }
        // Read-only diagnostic entry point used by Check-Recorder-Layout.ps1.
        public static string CheckRecordedLayout(List<ControlInfo> snapshot) {
            var m=Header(snapshot); var g=ProductGrid(snapshot);
            foreach(var r in g.Rows.Where(c=>c.Value.Length>0)) Cell(snapshot,r,g.Description);
            return "Mapped name, address, suburb, postcode, phone, email, PO, comment and " + g.Rows.Count + " item rows. Tax-in total: " + (Total(snapshot)/100m).ToString("0.00",CultureInfo.InvariantCulture) + (CustomerSearchInProgress(snapshot)?". Customer lookup: Searching... (cancellation recovery available)":"");
        }
    }
}
