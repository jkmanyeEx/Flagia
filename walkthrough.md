# WebSocket session lock walkthrough

## Disconnected or rejected session

![Disconnected writing session](walkthrough-assets/session-disconnected.jpg)

- The status remains red and reports the session failure instead of treating `auth_ok` as a complete connection.
- The timer displays a lock and remained at `30:00` throughout a 2.2-second observation.
- The template and writing pane are covered by a blocking overlay.
- The editor rendered with `contenteditable="false"`.
- The submit action remained disabled and displayed `연결 대기 중`.

## Confirmed session

![Connected writing session](walkthrough-assets/session-connected.jpg)

- The status turns green only after the server sends `session_ready`.
- The timer advanced from `29:54` to `29:52` during a 2.2-second observation.
- The template is readable and the blocking overlay is removed.
- The editor rendered with `contenteditable="true"`.

## Verification environment

The states above were exercised against a local WebSocket/API mock using an Admin identity. The disconnected case returned a session error after successful socket authentication; the connected case returned `session_ready`.

The active connection was also interrupted and restored:

- On disconnect, the overlay returned and the timer remained at `29:04` for a 2.2-second observation.
- After automatic reconnect and a new `session_ready`, the overlay cleared and the timer advanced from `28:57` to `28:55`.
- No browser console warnings or errors were produced during the tested states.
