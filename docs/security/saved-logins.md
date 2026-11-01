# Saved logins: threat model

Pista can sign in to a website for you without the AI seeing the password. It describes what the code does and where the limits are. The design does not rely on secrecy of the source.

## What is stored, and where

Logins live in `logins.json` in the desktop app's user-data folder (file mode 0600 on macOS and Linux). Label, origin, login URL and username are stored in the clear so Settings can list them. The password is not: origin, username and password are encrypted together with Electron `safeStorage`.

- **macOS:** the key is held in the login Keychain.
- **Windows:** protected with DPAPI. DPAPI is per user, not per app: any program running as you can decrypt the blob.
- **Linux:** libsecret or KWallet. If Electron reports the plaintext fallback (`basic_text`) or no keychain, Pista refuses to save anything and says so.

Login URLs must be `https://`  (`http://` only for localhost). One login is kept per origin.

## What the model can and cannot see

The model gets one tool, `browser_login`, taking the saved login's name. It returns `ok` and a fixed sentence such as "Signed in." or "The page is not the saved site." Success means only that the password field went away. If the name is unknown, the reply also lists the saved labels; if the page is the wrong site, it names the expected origin. Credentials are never returned.

The call goes through the approval gate, which shows "signs in with a login the owner saved". The ask is skipped in full-access mode or after "Always allow", and the call is blocked in read-only mode. The audit event records the tool name and the `site` argument as the model passed it, plus all arguments if argument logging is on.

Only the app's own interface can reach the vault.

## How a fill is bound to the saved origin

The fill engine compares the pane's top-frame origin (scheme, host and port, exact match) with the saved origin before every step, and again right before the password is typed. Any top-frame navigation away from the saved origin stops the fill for good, even if the page returns. The form locator runs in an isolated JavaScript world. It confirms the intended field has focus in the top document, then types with `insertText`; the password is never put into a script.

Once the password is submitted, the guard is released. Sites may redirect through single sign-on, so afterwards the engine types nothing and only polls the page. A recognised one-time-code field makes it stop and tell the model to ask the owner. A small race remains: a script on the saved site itself could move focus just before the keystrokes.

## Attacks considered

- **Tampered vault file.** Origin and username are sealed inside the encrypted record and compared to the plain entry on every use. Re-pointing an entry or swapping blobs between entries gives "damaged" and nothing is filled. The label and login URL are not sealed, and an older valid entry can be swapped back in. A file writer can also delete entries.
- **Fake login form elsewhere.** The origin check fails; nothing is typed.
- **Open redirect mid-fill.** Each step re-checks the origin and a navigation away is remembered. A redirect before the password is typed ends the fill.
- **Prompt-injected sign-ins.** A hostile page can ask the model to call `browser_login`. Normally the user is asked, and it works only on the saved site's own page, so the worst outcome is being signed in to a site you chose to save. The loop guard blocks a third identical call; there is no other rate limit.
- **Lookalike domains.** Origins are compared exactly, with no suffix or wildcard matching. Lookalike hostnames parse to a different origin.
- **Iframe forms.** The locator reads the top document only, subframe navigations are ignored, and the field must be focused in the top document. A form in an embedded frame is never filled.
- **A page reading the filled value.** Not prevented. Once typed, the value is in the saved site's own page, which is the site you trust with it. Other sites never receive it.
- **The invoice job reading the vault with tools.** The standalone invoice thread has no shell. Its `read` and `ls` tools are limited to the project folder, and paths starting with `~` or `@` are refused. The vault is outside the project and encrypted regardless.
- **Password exports in a project folder.** A CSV exported from a password manager that sits inside a project folder is readable by tools limited to that folder. Keep exports out of project folders; Pista does not scan for them.

## Not protected

- **A compromised user account.** Malware running as you can use the keychain or DPAPI, or log keystrokes.
- **Ordinary threads.** Outside the invoice job the model can run commands as you. It can read `logins.json` (usernames and origins, not passwords). On Windows, DPAPI also lets any process you run decrypt the blob. Approval is the only control.
- **`browser_eval`.** The model has a general script tool in the pane. A script could read a password left on the page after a failed sign-in.
- **Pi's `auth.json`.** Model-provider credentials are still stored as plain JSON until they move behind `safeStorage`.

## Reporting a problem

Report vulnerabilities privately as described in [SECURITY.md](../../SECURITY.md).
