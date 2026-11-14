# Keysprint

A real-time typing race for events. Up to 10 racers join from their own laptops with a 6-digit PIN, the host starts the race from the big screen, and everyone types the same paragraph. Three rounds, points per round, podium at the end.

## Run it locally

```bash
npm install
npm start
```

- Players: http://localhost:3000
- Host / big screen: http://localhost:3000/admin (development password: `admin`)

To rehearse without ten people, open a game on the host screen, then fill the lobby with simulated racers:

```bash
node scripts/bots.js <PIN> 9
```

Run the game-logic tests with `npm test`.

## How a game runs

1. Host signs in at `/admin` and presses **Open a game**. The PIN and join address fill the big screen.
2. Each racer opens the site, enters the PIN, picks a nickname and presses **I'm ready**.
3. When everyone is ready the host presses **Start round 1** (or **Start without waiting**).
4. 3 · 2 · 1 · Go fires at the same moment on every device.
5. Racers type the paragraph word by word. A mistake turns red and has to be fixed before moving on. Pasting is blocked.
6. The round ends when every connected racer finishes, at the 5-minute cap, or when the host presses **End round now**.
7. The leaderboard shows between rounds; after round 3 the host screen reveals the podium.

If a round went wrong (someone was not ready, a laptop froze), press **Replay round N** on the leaderboard, or on the final screen for the last round. That round's points are removed and everyone races the same text again after a new countdown.

## Scoring

| | |
|---|---|
| Finishing position | 1st 1000, 2nd 900 … 10th 100 |
| Accuracy bonus | up to +100, finishers only |
| Did not finish | position points only, ranked after finishers by progress; 0 if nothing was typed |
| Tie on total points | lower total finish time ranks higher |

Speed is shown as WPM = (characters ÷ 5) ÷ minutes. Finish times are stamped by the server.

## Changing the paragraphs

Either edit `server/texts.js`, or open **Round texts** in the host lobby and save before starting. The number of entries in `server/texts.js` sets the number of rounds. Curly quotes and long dashes are converted to plain keyboard characters automatically.

## Deploy (Render)

1. Push this folder to a GitHub repository.
2. On render.com choose **New → Blueprint** and select the repository (`render.yaml` is picked up).
3. Set `ADMIN_PASSWORD` when prompted.
4. Share the resulting URL with players; the host uses `<url>/admin`.

Any Node host that supports WebSockets works the same way: `npm install`, `npm start`, set `ADMIN_PASSWORD` and `PORT`.

Notes for event day:

- The game lives in memory on one server process. Do not restart or redeploy during a game.
- Free hosting tiers go to sleep when idle; open the site a few minutes before the event to wake it.
- A racer who refreshes or loses Wi-Fi rejoins automatically with their progress.
- New racers cannot join after round 1 has started.
