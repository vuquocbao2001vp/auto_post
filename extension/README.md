# Extension setup

1. Open `chrome://extensions`.
2. Turn on `Developer mode`.
3. Choose `Load unpacked`.
4. Select the `extension` folder from this repository.
5. Open the popup.
6. Paste your Supabase URL and anon key.
7. Sign in with the same email/password used in the web app.
8. Keep Chrome signed into Facebook on the profile that has this extension installed.

Notes:

- The extension runs a poll every minute.
- You can also click `Run poll now` in the popup to test immediately.
- This MVP uses broad host permissions because the Supabase project URL is configurable at runtime.
- Facebook selectors can change. When they do, failures will show up in the `Logs` page.
