# Tiến Lên Online

Play **Tiến Lên** (Vietnamese “Thirteen”, Southern rules / Miền Nam) with 4 players in the browser, on a computer or a phone.

- No install and no accounts. One person creates a room and sends the invite link to the other three.
- It runs entirely as a static website, so you can host it for free on GitHub Pages.
- Players connect directly to each other with WebRTC (via [PeerJS](https://peerjs.com/)). The **host's browser runs the game**: it shuffles, deals, checks every move and sends each player only their own cards.

---

## 1. Put it on GitHub Pages

You need a free GitHub account: <https://github.com/signup>

### Create the repository
1. Go to <https://github.com/new>.
2. **Repository name**: for example `tienlen`.
3. Choose **Public** (GitHub Pages is free for public repositories).
4. Click **Create repository**.

### Upload the files
1. On the new repository page, click **uploading an existing file** (or **Add file → Upload files**).
2. Open the game folder on your computer, select **everything inside it** (`index.html`, `style.css`, `tests.html`, `README.md` and the `js` folder) and drag it onto the GitHub page.
   - Drag the **contents** of the folder, not the folder itself, so that `index.html` ends up at the top level of the repository.
   - Make sure the `js` folder was uploaded with its 6 files (`main.js`, `network.js`, `game.js`, `ui.js`, `config.js`, `tests.js`).
3. Scroll down and click **Commit changes**.

### Turn on GitHub Pages
1. In the repository, open **Settings → Pages** (in the left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Under **Branch**, choose **main** and folder **/ (root)**, then click **Save**.
4. Wait 1–2 minutes and refresh the page. A box appears at the top: **“Your site is live at …”**.

Your game address will be:

```
https://<your-github-username>.github.io/<repository-name>/
```

for example `https://lan-nguyen.github.io/tienlen/`.

> To update the game later, upload the changed files again (same steps). GitHub Pages republishes automatically within a minute or two.

---

## 2. Play with friends

1. Open your game address and click **Create Room**. Enter your name. You are the **host**.
2. Click **Copy invite link** (or **Share** on a phone) and send the link to your 3 friends, for example in Zalo or Messenger.
   The link looks like `https://lan-nguyen.github.io/tienlen/?room=ABC123`.
3. Each friend opens the link, enters a name and joins. They can also open the site, click **Join Room** and type the 6-letter code.
4. When all 4 seats are filled, the host clicks **Start Game**.

Tips:
- **The host must keep their tab open.** If the host closes it, the game ends for everyone. The host should ideally play on a computer, or keep their phone screen on with the game open.
- **On phones, open the link in Chrome or Safari**, not in Zalo/Messenger/Facebook's built-in browser (tap ⋯ → *Open in browser*).
- If a player's connection drops, or they switch apps for too long, they just open the link again and join **with the same name**. They get their seat and cards back.
- The host can change the timer, instant win, chopping and points in the lobby before starting.

---

## 3. If some players can't connect (relay server)

Most home Wi-Fi works fine. Some networks, especially **mobile data (4G/5G)** and strict office/school Wi-Fi, block direct connections between devices. Such a player sees *“Couldn't connect to the room.”*

The fix is a **relay (TURN) server** that forwards the traffic. It's free for small use:

1. Sign up at <https://www.metered.ca/> (free plan → *TURN Server*). Create a credential and note the **username** and **credential** (password).
2. Open `js/config.js`, remove the `//` at the start of the 4 lines in `TURN_SERVERS`, and replace `PASTE_USERNAME` / `PASTE_CREDENTIAL` with your values.
3. Upload `js/config.js` to GitHub again.

Nothing else needs to change.

---

## 4. Test on your own computer (optional)

Browsers won't run this game when you double-click `index.html`, because the code is split into modules, which need a web server. Start a tiny local server in the game folder instead:

```bash
# If you have Python installed:
python -m http.server 8000
# …or with Node.js:
npx serve .
```

Then open <http://localhost:8000>. To try multiplayer alone, open the invite link in **3 more tabs or windows**. Each tab counts as a separate player.

**Rules tests:** open <http://localhost:8000/tests.html> (or `/tests.html` on your GitHub Pages site) to run the unit tests for the rules engine.

---

## Rules implemented

| | |
|---|---|
| **Hidden information** | You only see your own hand and the play currently on the table. Other players' card counts and the history of played cards are not shown or sent to anyone, so no card counting |
| **Card order** | 3 4 5 6 7 8 9 10 J Q K A 2 · suits ♠ < ♣ < ♦ < ♥ (3♠ lowest, 2♥ highest) |
| **Combinations** | single · pair · triple (Sám) · four of a kind (Tứ quý) · straight of 3+ (Sảnh, no 2s, A only on top) · 3+ consecutive pairs (Đôi thông, no 2s) |
| **Beating** | same type and number of cards, higher top card (rank, then suit) |
| **Chopping (Chặt)** | single 2 ← 3 consecutive pairs / four of a kind / 4 consecutive pairs · pair of 2s ← four of a kind / 4 consecutive pairs · 3 consecutive pairs ← higher 3 consecutive pairs / four of a kind / 4 consecutive pairs · four of a kind ← higher four / 4 consecutive pairs · 4 consecutive pairs ← higher 4 consecutive pairs |
| **Turn order** | counter-clockwise (host can switch to clockwise) |
| **First game** | the 3♠ holder leads and must include 3♠. Later games: the previous winner leads with anything |
| **Passing** | locks you out until the round ends (host option: passed players may still chop) |
| **Round end** | when everyone else passes, the last player who played leads. If they already finished, the next player in turn order leads |
| **Timer** | 30 s by default (host can change or turn off). On timeout: auto-pass, or play the lowest card when leading. If the timer is off, a *disconnected* player is auto-played after 30 s so the game never gets stuck |
| **Places** | 1st (Nhất), 2nd (Nhì), 3rd (Ba), last player is 4th (Bét). Points +3 / +1 / −1 / −3 by default (host can change) |
| **Instant win (Tới trắng)** | checked after dealing (host can turn off): four 2s, dragon straight 3→A, 5 consecutive pairs, or 6 pairs (a four of a kind counts as 2 pairs). If two players qualify, the stronger hand wins in that order; ties go to the player closest to the 3♠ holder. The others are ranked in turn order after the winner |

Not included: penalties for leftover 2s/bombs (thối 2 / thối heo) and bonus points for chop chains.

---

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout (all screens) |
| `style.css` | Look and feel, cards drawn with CSS, phone layout |
| `js/game.js` | Rules engine, pure functions only (combos, comparing, chopping, turns, finishing, instant win) |
| `js/network.js` | PeerJS connection code. **The message protocol is documented at the top** |
| `js/main.js` | Host room logic (seats, settings, scores, timer) and guest client |
| `js/ui.js` | Drawing the screens and handling taps/clicks |
| `js/config.js` | Optional relay (TURN) server settings |
| `js/tests.js`, `tests.html` | Unit tests for the rules |
