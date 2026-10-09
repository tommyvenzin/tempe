# Team sharing through GitHub (about 10 minutes, once)

The board on the RDP PC **encrypts** its results with a team passphrase and saves
**one file** to a public GitHub repo. Everyone else opens your GitHub page and types
the passphrase once on their device. GitHub only ever holds scrambled data: without
the passphrase the file is unreadable, and any change to it is detected.

## 1. Make the data repo (on GitHub)

1. **New repository** named `tempe-board-data`, **Public**, tick **Add a README file**, Create.
   (Public is required so phones can download the file without a GitHub login. It only
   ever contains the encrypted file and a README.)

## 2. Make a token for the RDP PC (on GitHub)

2. Your picture > **Settings > Developer settings > Personal access tokens > Fine-grained tokens >
   Generate new token**.
   - Name: `Order Check`. Expiration: up to 1 year (put a reminder in your calendar).
   - Repository access: **Only select repositories > tempe-board-data**.
   - Permissions > Repository permissions > **Contents: Read and write**. Nothing else.
   - Generate, then copy the token (it's shown once). Don't paste it anywhere else.

## 3. Upload the board (on GitHub)

3. Upload these 5 files from `Board` to your `tempe` repo, next to `Project_C.html`:
   `Order_Check.html`, `order-rules.js`, `order-check.js`, `share.js`, `share-config.js`.
   **Don't upload `Tests`**: its fixture has real doc numbers, totals and comments.

## 4. Start sharing (on the RDP PC)

4. With Order Check running, press **Open board**. Click **Set up sharing** (top right).
5. Paste the token, press **Suggest a passphrase** (or type your own, 16+ characters),
   **write the passphrase down**, then **Start sharing**. The top right says **Sharing with the team**.
6. Pin that tab and leave it open. It checks picking and saves for everyone
   (only when something changed, at most once a minute, plus a check-in every 4 minutes).

## 5. Everyone else

7. Open `https://tommyvenzin.github.io/tempe/Order_Check.html#by=THEIR-INITIALS`,
   type the passphrase once, bookmark it. Works on phones too.
8. Updates reach them within about 5 minutes (GitHub caches the file briefly).

## Checking what the team sees

Use your **phone** (or a PC without Order Check). Only the RDP board should ever say
"This PC shares the board"; on any other device that says it, press **Stop sharing**.

## Clearing a job

- On the RDP board: **Mark OK** (comes back if the job changes).
- Anyone: put **HOLD** in the COSTAR comment (the job moves to Waiting as "On hold").
  **NO ORDER**, **SERVICE ONLY**, **ALIGNMENT ONLY**, **FIT ONLY**, **REPAIR ONLY**, **OWN TYRES** and
  **NOT NEEDED** also work and show as "No order needed".

## Day to day

- **Someone leaves:** on the RDP board press **Stop sharing**, then **Share with the team** again with a
  new passphrase. Everyone else is asked for the new one; tell the people who should still have it.
- **Token expired:** the RDP board says GitHub refused it. Make a new token and set up again.
- **RDP tab closed:** everyone's board says when it stopped updating.
- **Stop sharing completely:** press **Stop sharing**, then delete the `tempe-board-data` repo.

If GitHub ever stops working for this, the Firebase version is in `firebase-last-resort`.
