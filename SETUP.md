# TaskFlow — Setup Guide (about 10 minutes)

Your app now uses **Supabase** for accounts and shared data. Follow these steps once.

---

## Step 1 — Create a free Supabase project

1. Go to **https://supabase.com** and sign up (free).
2. Click **New Project**. Give it a name (e.g. "TaskFlow") and a database password (save it somewhere).
3. Pick the region closest to you. Click **Create new project** and wait ~2 minutes.

---

## Step 2 — Create the database tables

1. In your Supabase project, open **SQL Editor** (left sidebar) → **New query**.
2. Open the file **`supabase-schema.sql`** (included in this folder), copy ALL of it, paste into the editor.
3. Click **Run**. You should see "Success". This builds your tables and security rules.

---

## Step 3 — Get your keys and paste them in

1. In Supabase, go to **Project Settings** (gear icon) → **API**.
2. Copy these two values:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - **anon public** key (a long string)
3. Open **`config.js`** in this folder and paste them in:

```js
const SUPABASE_URL      = "https://abcdxyz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGci...your-long-key...";
```

Save the file.

---

## Step 4 — (Recommended) Turn off email confirmation for easy testing

By default Supabase makes new users confirm their email before logging in.
To let you and your team log in instantly:

1. Supabase → **Authentication** → **Sign In / Providers** → **Email**.
2. Turn **OFF** "Confirm email". Save.

> Leave it ON if you prefer the extra security — users will just get a
> confirmation email they must click before their first login.

---

## Step 5 — Tell Supabase your website address

1. Supabase → **Authentication** → **URL Configuration**.
2. Set **Site URL** to your Netlify address (e.g. `https://hinafayyazdashboard.netlify.app`).
3. Save.

---

## Step 6 — Deploy to Netlify

Upload the whole folder (or the zip) to Netlify the same way you did before
(drag-and-drop on the Netlify dashboard, or push to your connected repo).

The folder must contain:
```
index.html
style.css
app.js
config.js          ← your keys are in here
netlify.toml
supabase-schema.sql (not served, just for reference)
```

---

## How it works now

- **Login / Sign up** — anyone visiting the site can create an account with
  email + password. Each person gets their own private board.
- **Folders & tasks** — every user creates their own folders and tasks.
- **Sharing** — click **Share**, pick a task / folder / whole board, type a
  teammate's email, choose **View only** or **View & edit**, and click
  **Share & Send Invite**.
  - A pre-written invite email opens in your mail app — just hit send.
  - When your teammate logs in (or signs up) **with that same email**, the
    shared item appears in their sidebar under **"Shared with me."**
  - With **edit** permission they can change the task and you'll both see the
    update (refresh to pull the latest).

---

## A couple of notes

- **The invite email is sent from *your* email app.** The app pre-fills the
  message and link; you click send. (This avoids extra paid email services.)
  If you later want the app to send invites automatically, that's possible with
  a Supabase "Edge Function" — ask and it can be added.
- **Attachments** are stored in the database (max 2 MB each) and are shared
  along with the task.
- **Live updates:** changes save instantly to the database. The other person
  sees them after a page refresh. (Real-time auto-refresh can be added later
  with Supabase Realtime if you want it.)

---

Enjoy! If anything doesn't connect, the most common cause is a typo in
`config.js` — double-check the URL and key.
