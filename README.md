# Empty Threats Song Board

A mobile-friendly, shared song board for the band. Songs move from **Suggestions** to **To Be Practiced** to **Gig Ready**. Members can add, edit, move, search, and delete songs without email addresses or passwords.

## How access works

The band admin sets one long, private access code in Supabase. Each member enters their name and that code once per browser. Supabase creates an anonymous account for that browser; the database remembers that browser as a member. The code is checked on the server and is **not** stored in the website files.

Anyone who learns the code can join the board. Share it only with band members. Clearing browser data or using a new device means entering the code again. Changing the code stops new joins with the old code but does not remove existing members; see **Manage access** below.

## Files

- `index.html` — the page and forms
- `styles.css` — responsive design
- `app.js` — song board, band code entry, live updates
- `config.js` — public Supabase project URL and publishable key
- `supabase.sql` — tables, access rules, and live update setup

The page is plain HTML, CSS, and JavaScript. It needs no build step and works from the root of a GitHub Pages repository or a project subpath.

## Set up Supabase

1. Create a [Supabase project](https://supabase.com/dashboard). In **Authentication → Providers**, enable **Anonymous Sign-Ins**. Supabase's [anonymous sign-in guide](https://supabase.com/docs/guides/auth/auth-anonymous) describes this setting.
2. Open **SQL Editor**, paste the entire contents of `supabase.sql`, and run it once in a new project.
3. In SQL Editor, generate a random band code:

   ```sql
   select replace(gen_random_uuid()::text, '-', '') as band_code;
   ```

   Copy the 32-character result. Then run this statement with your result in place of `PASTE-CODE-HERE`:

   ```sql
   update public.band_settings
   set code_hash = encode(sha256(convert_to('PASTE-CODE-HERE', 'UTF8')), 'hex')
   where id = true;
   ```

   Keep the code somewhere private and share it directly with band members. The board stays locked until this step is done.

4. In the project's **Connect** dialog or **Settings → API Keys**, copy the **Project URL** and **publishable key**. A legacy `anon` key also works. Fill in `config.js`:

   ```js
   window.EMPTY_THREATS_CONFIG = {
     supabaseUrl: "https://YOUR-PROJECT.supabase.co",
     supabasePublishableKey: "YOUR-PUBLISHABLE-KEY"
   };
   ```

   This key is designed to be public in browser code. **Never put the band code, a secret key, or a service role key in `config.js`.** The SQL row level security rules protect the songs.

You do not need to configure email templates, SMTP, or authentication redirect URLs for this version.

## Publish on GitHub Pages

1. Put all six app and setup files in a GitHub repository's root and commit them.
2. In the repository's **Settings → Pages**, choose **Deploy from a branch**, select the branch containing the files, and use `/ (root)`.
3. Open the Pages URL. Enter your name and the band code to join. Have another member open the same URL on their device and use the same code to confirm that songs sync.

For a quick local preview, open `index.html` in a browser. If `config.js` is blank, the app runs in clearly labeled **Demo mode** with sample songs saved only in that browser. Entering Supabase settings switches it to the shared board. Once configured, serve the files over HTTP for reliable local testing, for example with `python -m http.server 8000`.

## Manage access

To see joined devices, run this in SQL Editor:

```sql
select user_id, display_name, joined_at
from public.band_members
order by joined_at;
```

To remove one device's access, delete its `user_id` from `public.band_members`. A member can join again if they still know the band code. To stop that, generate a new code and update `public.band_settings` as above. Then remove any memberships that should no longer have access.

## Notes

- Use **Refresh** if a change from another device does not appear immediately. The SQL also enables Supabase Realtime so changes normally show up automatically.
- Song text is displayed as text, so members' notes cannot inject HTML into the board.
- The CDN-hosted Supabase library and the Supabase backend require an internet connection.
