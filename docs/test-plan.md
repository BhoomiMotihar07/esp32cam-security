# Test plan

Three layers: automated tests (run on every change), simulator smoke runs (no hardware), and
hardware checks you perform in the room. Record hardware numbers in the README tables.

## 1. Automated (`npm run check`)

| suite | file | what it pins |
|---|---|---|
| state machine | `shared/test/state-machine.test.ts` | DISARMED→EXIT_COUNTDOWN→ARMED→ALARM, ack keeps armed, candidates ignored during countdown, disarm from everywhere |
| schedule | `shared/test/schedule.test.ts` | windows crossing midnight, day lists, same-day windows, disabled/empty |
| roles | `api/test/roles.test.ts` | owner/member/viewer over the HTTP API, cross-household isolation, single-use invites, last-owner rule, revoked tokens |
| offline | `api/test/offline.test.ts` | flagged once after 180 s, cleared and auto-acknowledged on return, `offline:true` view without the timer, never for devices that never spoke |
| alerts | `api/test/alerts.test.ts` | photo + buttons on first alert, 30 s reminders capped by `ALERT_MAX_REPEATS`, ack sends C2D `ack` and removes buttons, unclaimed devices stay silent, photo-name scoping |
| SAS scope | `api/test/sas.test.ts` | device key required, local token bound to blob + permission + expiry, Azure SAS `sp=cw` for upload / `sp=r` for read, cross-household read refused |
| Telegram | `api/test/telegram.test.ts` | unlinked chats refused, one-time link codes, viewer role refused for commands and buttons, buttons scoped to household devices, webhook secret header |
| ingest | `api/test/ingest.test.ts` | state message beats heartbeat latency, transport device id wins, snapshot read URL |

## 2. Simulator smoke (local mode)

Terminal 1: `npm run dev:api` · Terminal 2: `npm run dev:app` · Terminal 3: simulator.

| step | command / action | expect |
|---|---|---|
| S1 register + claim | app → First setup → Family → Devices (`cam-01`, key `dev-upload-key-123`) | device listed, OFFLINE until the simulator starts |
| S2 heartbeat | `npm run sim -- --heartbeat 5` | Status shows DISARMED, RSSI, uptime, reset reason within 5 s |
| S3 arm with countdown | tap Arm in the app | countdown ticks from 30; simulator logs `EXIT_COUNTDOWN (app)` then `ARMED` |
| S4 motion | press `m` in the simulator | event with 3 photos in the feed within ~3 s, state ALARM, red "Acknowledge" |
| S5 ack | tap Acknowledge | simulator logs `command ack`, state back to ARMED |
| S6 sound / tamper | `s`, `t`, `c` | three more event types with photos |
| S7 zones + sliders | draw two zones, move sliders, Save | simulator logs `config vN applied (2 zones)`; Status shows `vN applied` |
| S8 schedule | add a window that starts in 1–2 min, Save | simulator arms with `(schedule)` and no countdown at that minute |
| S9 auto-dark | enable auto-arm, press `d` (dark) | after 5 min simulator arms with `(auto_dark)` |
| S10 snapshot / ping | Snapshot now, "I see you" | image appears; simulator logs the chirp line |
| S11 offline | press `o` (pause heartbeats), wait > 3 min | OFFLINE banner, `offline` event, Telegram "Device offline" (if linked); press `o` again → auto-acknowledged |
| S12 brown-out | press `r` | next heartbeat shows `BROWNOUT` and the warning banner |
| S13 roles | invite a viewer in a second browser | Arm button disabled, settings read-only, feed visible |
| S14 Telegram | link with `/link CODE`, trigger motion | photo with buttons; `/status`, `/arm`, `/disarm`, `/snapshot` work; buttons act |
| S15 repeat | leave an alarm unacknowledged | reminders every 30 s, stop at the cap and on ack |

Scripted variant used in CI-style checks:
`npm run sim -- --script "arm0,wait:1,motion,wait:1,sound,wait:2,quit" --heartbeat 5`

## 3. Hardware (ESP32-CAM in the room)

| id | check | how | record |
|---|---|---|---|
| H1 bring-up | serial shows camera init, Wi-Fi, NTP, `iothub connected` | `pio device monitor` | boot time to first heartbeat |
| H2 fps | `stats:` line every 10 s | gray QQVGA fps with exposure locked | README table |
| H3 burst timing | trigger motion | `burst: 3 photos, N bytes, reinit X ms, total Y ms` | X, Y, bytes |
| H4 upload timing | same event | `upload: … in Z ms` ×3 and `event …: 3/3 photos uploaded in T ms` | T |
| H5 event-to-phone latency | stopwatch from wave to Telegram/app notification | 5 trials | median, max |
| H6 zone correctness | zone only on the door; walk past the window | no event; walk through the door → event with zone "Door" | |
| H7 exposure lock | switch a lamp on while armed | log `scene change … re-referencing`, no alarm | |
| H8 tamper covered | cover the lens 3 s | `tamper_dark` event | |
| H9 tamper moved | turn the camera 30° for 5 s | `tamper_moved` event; a lamp toggle alone must not trigger it | |
| H10 sound | clap / drop a book at 2 m | `sound:` log, event when armed; check the baseline settles in 10 s | pulses, baseline |
| H11 night | lights off 5 min with auto-arm on | arms with `auto_dark`; flash fires only after a trigger | brightness value |
| H12 button | press → countdown; press again → disarm; in ALARM press → disarm | LEDs/buzzer per pin-map.md | |
| H13 offline behaviour | unplug the router while armed; trigger motion | siren and LEDs still work; event queued; after Wi-Fi returns the event arrives with photos; two-blink Wi-Fi code visible | |
| H14 power | 20 bursts in a row | no `BROWNOUT` in heartbeats | reset count |
| H15 48 h run | armed in a real room | README: events, false alarms by type, resets, uptime | |
| H16 stale commands | send `arm` while the device is off, power it on > 10 min later | log `c2d: stale arm ignored` | |
| H17 IoT quota | one day | Azure portal → IoT Hub → messages used (< 8,000) | messages/day |
