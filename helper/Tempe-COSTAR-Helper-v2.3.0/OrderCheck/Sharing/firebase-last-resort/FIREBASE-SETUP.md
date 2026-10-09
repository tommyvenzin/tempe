# Team sharing setup (about 20 minutes, once)

Order Check shares its results through **Firebase** (Google). The data is stored in
**Sydney**, and only people you add can sign in and read it. The free plan covers it.

> **Before step 10:** get the boss's OK. Customer names, totals and comments
> (with regos) will be stored in Google's Sydney data centre, readable only by
> the staff you list.

## In the Firebase console (console.firebase.google.com)

1. **Create a project** called `tempe-order-check`. Turn Google Analytics off.
2. **Build > Firestore Database > Create database.** Choose the Standard edition if asked,
   location **australia-southeast1 (Sydney)**, and **production mode**.
   The location can't be changed later.
3. **Firestore > Rules:** replace everything with the contents of `firestore.rules`
   (in this folder) and press **Publish**.
4. **Build > Authentication > Get started > Sign-in method > Email/Password:**
   turn on the first switch (not "Email link") and save.
5. **Authentication > Settings:**
   - **Authorized domains > Add domain:** `tommyvenzin.github.io`
   - **User actions:** untick **Enable create (sign-up)** if you see it, so only accounts you add can exist.
6. **Authentication > Users > Add user** for yourself and each salesperson and manager
   (email + a temporary password). Tell people their password in person.
7. **Firestore > Data > Start collection:** collection ID `config`, document ID `access`, then add:
   - field `publishers`, type **array**: your email (lowercase);
   - field `viewers`, type **array**: everyone else's email (lowercase).
8. **Project settings (gear) > General > Your apps > Web (</>):** nickname `Order Check`,
   no Hosting, **Register app**. Copy `apiKey`, `authDomain`, `projectId` and `appId`
   into `Board/share-config.js`. These values are public by design; the rules protect the data.

## On GitHub

9. Upload these 5 files from `Board` to your `tempe` repo, next to `Project_C.html`:
   `Order_Check.html`, `order-rules.js`, `order-check.js`, `share.js`, `share-config.js`.
   **Don't upload `Tests`**: its fixture has real doc numbers, totals and comments.

## Start sharing

10. On the RDP PC, with Order Check running, press **Open board**. It opens
    `https://tommyvenzin.github.io/tempe/Order_Check.html`. Click **Sign in to share with the team**
    and use your account. The top right then says **Sharing with the team**.
    Pin that tab and leave it open: it's the one that checks picking and updates everyone.
11. Everyone else opens the same link, signs in and bookmarks their own view,
    for example `…/Order_Check.html#by=MOR`. Works on phones too.

## Day to day

- **Add someone:** Authentication > Add user, then add their email to `viewers`.
- **Remove someone:** take their email out of `config/access` (instant), then delete the user.
- **If the RDP tab is closed**, everyone's board says when it stopped updating.
- **Stop sharing completely:** sign out on the RDP board, then delete the `wip` collection.

## Optional hardening

Google Cloud console > APIs & Services > Credentials > the "Browser key (auto created by Firebase)" >
**Application restrictions: Websites** > add `https://tommyvenzin.github.io/*`.

## Usage

The RDP board writes only rows that changed, plus a small "still alive" note every 2 minutes.
Expect roughly 1,000 writes and a few thousand reads a day. The free plan allows 20,000 writes
and 50,000 reads a day.
