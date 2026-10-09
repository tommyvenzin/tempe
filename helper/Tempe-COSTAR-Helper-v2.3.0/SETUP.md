# First installation only

Existing users should follow README.md instead.

## What runs where

| Location | Run | Purpose |
| --- | --- | --- |
| Normal desk Windows desktop | `Setup-Desk.cmd` once, then `Start-Desk.cmd` | Receives phone jobs, checks desk activity, shows approvals and Next Order. |
| Inside the RDP session containing COSTAR | `Start-RDP.cmd` | Opens Branch 11 Repair Orders and fills their native controls. |
| Phone on permitted work Wi-Fi | QR link from the desk helper | Existing F Alt Tab and Job Card workflow. |

The desk PC and RDP host must be able to reach each other on the selected desk LAN address. RDP being connected by itself does not establish that reverse connection. Keep the RDP desktop connected, unlocked, visible, and COSTAR available at its normal permission level.

The launchers use Windows PowerShell and the installed .NET Framework compiler; no Python, Node, installer, service or scheduled startup is required. Target Windows 10/11 for the desk receiver and a compatible Windows RDP host with .NET Framework 4.8. They do not elevate themselves or change firewall rules.

## Set up the desk receiver

1. Extract the whole folder somewhere you can write, outside the ZIP. Run `Check-Build.cmd` and verify it passes.
2. Run `Setup-Desk.cmd` on the normal desktop, **outside RDP**. If several addresses appear, choose the Ethernet/work LAN address reachable from the phone and RDP host.
3. Setup creates a local certificate authority and server certificate under your Windows user, trusts that authority for that user, saves receiver settings, and opens the receiver. Windows may request confirmation for installing the local trust certificate.
4. In the receiver, enter your existing GitHub Pages website address and choose **Save website**. It resolves the address to `Fitment_Planner.html`. Leave it blank only if you want the included local copy.
5. Choose **Export RDP connection**. Explorer selects `worker-connection.json`.

The receiver uses private LAN TCP **8790** for HTTPS and **8791** for downloading its public certificate. If the network or Windows firewall blocks either endpoint, arrange the appropriate work-network access; setup does not alter those restrictions. No public port forwarding is part of this setup.

## Connect the RDP worker

1. Copy/extract this package inside RDP and copy the exported `worker-connection.json` into that extracted folder, beside `Start-RDP.cmd`.
2. Open COSTAR Branch 11 at Work-in-Progress. Select that instance in the combined app; other instances can remain open.
3. Run `Start-RDP.cmd` **inside RDP**. It builds/checks the same EXE, imports the connection file, and starts the worker.
4. The worker should say **PC receiver connected**; the desk receiver should show **RDP worker online**. COSTAR availability appears separately. An existing Repair Order in the selected instance blocks a new mobile order.

The connection file contains a private worker key. Keep it off GitHub and out of report uploads. After a successful import, the worker retains an encrypted copy; you can remove `worker-connection.json` from the package root and `bin` copies. The next launch will use the saved connection.

## Pair the phone

1. Choose **Show phone QR** on the desk receiver. The pairing page is generated locally.
2. Scan the certificate QR. Install the profile containing this PC's **Tempe Mobile Local Root** certificate, checking its displayed name against the desk page.
3. On iPhone, go to **Settings → General → About → Certificate Trust Settings** and enable trust for that specific certificate. Installing a certificate profile alone does not enable SSL trust. See [Apple's instructions](https://support.apple.com/en-au/102390).
4. Scan the **GitHub Job Card** QR if you entered your working website address. Otherwise scan the local Job Card QR. If the browser requests access to the local network, permit access for this helper.
5. Use F Alt Tab and Job Card on that same website address. The local website and GitHub website have separate browser drafts; switching between them does not migrate saved tyres.

Pairing uses a private token in the QR fragment, then an Authorization header. No password screen is added. **Reset phone pairing** revokes the old phone key and generates a new QR, preserving queued jobs. Keep the QR private.

The local `Website` folder contains the seven existing Job Card/F Alt Tab files. Other navigation destinations remain on your existing GitHub site; they are not included in this local fallback. You can copy your existing companion pages/assets into `Website` if you also want to serve them locally.

