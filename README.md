# 🍕 Pizza Party Planner

A tiny, free site for pizza-making parties. Guests sign in with Google, say what ingredients they're bringing, note any dietary needs, build pizzas from what's actually coming, name them, and vote.

**Private and reusable:** each party has a secret code in its invite link (`https://…/pizza-party-planner/#pepperoni-k3x9q2mf7a`). Only people with the link who sign in can see or edit that party, and hosts can make a party invite-only. The code is never in the repo, and the part after `#` isn't even sent to GitHub's servers. Hosts click **Host a new party** for a fresh code each time. Only emails you list under `hosts` in Firebase can host, so strangers can't fill your database with their own parties.

- Hosting: **GitHub Pages** (free)
- Shared data: **Firebase Realtime Database** (free "Spark" plan, no credit card)
- No build step: plain HTML/CSS/JS

Until Firebase is set up, the site runs in **demo mode** with no sign-in (data saved only in your own browser), so you can try it right away. Serve the folder locally, for example with `python3 -m http.server`, and open it.

## 1. Set up Firebase (about 5 minutes)

1. Go to <https://console.firebase.google.com> → create a project (Google Analytics: off).
2. Left sidebar → **Databases & Storage → Realtime Database** → **Create database** → any location → **Start in locked mode**.
3. Open the **Rules** tab, paste the contents of [`database.rules.json`](database.rules.json), and click **Publish**.
4. Copy the database address from the **Data** tab (like `https://your-project-default-rtdb.firebaseio.com`). You'll need it in a moment.
5. Security → **Authentication** → Sign-in method → enable **Google**.
6. **Choose who can host parties.** In the **Data** tab, add a `hosts` key at the top level, and under it one entry per host: the Google email in lowercase with every `.` swapped for `,`, set to `true`. For example, `sam.lee@gmail.com` becomes `sam,lee@gmail,com: true`. Only these people can create parties. Anyone else who signs in can still join a party they've been invited to, but can't start one. Nobody can add themselves from the website.
7. Project settings → **Your apps** → add a Web app. For running locally, copy [`config.example.js`](config.example.js) to `config.js` and fill in your values. `config.js` is gitignored, so your keys and project never end up in the repo, and anyone can reuse this repo with their own Firebase project.

> These values aren't really secrets: the live site has to send them to every visitor's browser so it can talk to Firebase. Keeping the key out of the repo just stops it showing up in GitHub's code search and secret scanners. What actually protects the data is the database rules, plus the authorized-domains list for sign-in.

## 2. Publish on GitHub Pages

1. Push this folder to a GitHub repo.
2. Repo → **Settings → Secrets and variables → Actions** → add four repository secrets from your Firebase web config: `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_PROJECT_ID` and `FIREBASE_DATABASE_URL`.
3. Repo → **Settings → Pages** → Source: **GitHub Actions**.
4. Every push to `main` runs the tests, builds `config.js` from the secrets, and publishes ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)). It's live at `https://<your-username>.github.io/<repo-name>/`.
5. Firebase → **Authentication → Settings → Authorized domains** → add `<your-username>.github.io`, or Google sign-in won't work on the live site.

## Hosting a party

1. Open the site → **Host a new party** → type a name and when/where.
2. Click **🔗 Copy invite link** and send it to your group chat.
3. As the host, you can edit the party name and details with ✏️, and use 🔒 Guest list to make it invite-only.

## Good to know

- The invite link works like a password: share it with friends only. Anyone who has it and signs in can add items, propose pizzas and vote. If it leaks, turn on invite-only or host a new party.
- The site itself is public (GitHub Pages), but without a code it only shows the join/host screen. The database refuses to list parties, so codes can't be discovered.
- Everyone signs in with Google. The database rules check that ID, so only the host can edit the party, people can only edit or delete their own ingredients, dietary notes and pizzas, and each person gets one vote per pizza. Anyone at the party can rename a pizza or change its look.
- **Invite-only (optional):** the host can tap 🔒 Guest list, add friends' Google emails, and switch on invite-only. Then nobody else can see or change the party, even with the link.
- **Privacy:** other guests see your name and Google profile photo, never your email. The guest list is only readable by the host. As the Firebase project owner, the host can also see who signed in under Authentication → Users.
- To clean up old parties: Firebase console → Realtime Database → `parties` → delete the ones you don't need.
