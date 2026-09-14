# Open Watch Cinema — AI Viewing Skill

Use this skill whenever you are connected to Open Watch Cinema through its MCP server.

## Purpose

Join a viewer inside one local watch room, follow the current playhead without reading ahead, receive new room messages and timed dialogue, inspect selected storyboard frames, and post reactions back beside the moment where they belong.

## Stable identity

Choose one stable cinema display name before the first tool call, or use the name the viewer gives you.

- Pass the exact same name as `consumerName` on every `open_watch_cinema_tick` call.
- Pass the exact same name as `senderName` on every `cinema_post_message` call.
- Keep that name in client configuration or session state; the human should not need to type it again for every call.
- Independent AI actors or runtimes should use distinct names. Two clients using the same name are treated as one speaking identity for self-message filtering.

## Before the film starts

1. Call `cinema_status` and confirm the local cinema is reachable.
2. Call `cinema_list_media` and inspect compatibility, subtitle tracks, and `aiPackage` readiness.
3. Call `cinema_list_rooms`.
4. Reuse the active room when it is the viewer's intended screening. Otherwise ask before opening or ending a room.
5. If opening a room through MCP, call `cinema_open_room`. Never set `allowIncomplete: true` until the viewer has accepted the warning.
6. Keep the returned `roomId`, your stable name, and your own cursor set together as one client session.

## Normal viewing loop

## Normal viewing loop

Treat joining an active screening as entering a persistent viewing loop.

A call to `open_watch_cinema_tick` is one iteration of that loop, not a one-shot status check. Once attached to a screening, continue calling `open_watch_cinema_tick` iteratively until an explicit exit condition is reached.

- On the first call, omit cursors unless intentionally resuming saved cursors.

- After every successful call, immediately preserve the returned cursors and pass them unchanged into the next call.

- Maintain cursors separately for each `{cinema instance, roomId, AI identity}`. Another AI's cursors must not replace yours.

- Treat the returned playback state and playhead as authoritative.

- Read only the dialogue, messages, observations, and storyboard selections returned by the spoiler gate. Do not infer future plot or unseen material.

- Respond selectively. Silence is allowed when there is nothing worth saying.

- Post a reaction with `cinema_post_message`, using the current returned playhead as `mediaTimeMs` and your stable name as `senderName`.

- Posting a message does not end the viewing loop. After posting, continue polling with the latest cursors.

- Receiving and answering a viewer message does not end the viewing loop. After responding, continue polling.

- Completing a requested test, inspection, or other task does not end the viewing loop.

- `more.any: false` does not end the viewing loop. It only means there is no backlog at that instant.

- A paused film does not end the viewing loop. Continue polling while paused so that room messages, resume events, seeks, and other playback changes can still be observed.

- An empty tick does not end the viewing loop.

- Do not emit a final assistant response merely because the current tick has no new information. While attached to an active screening, the default action is another tick.

- The host application may control or delay polling cadence to avoid excessive load, but cadence control must not be interpreted as permission to terminate the viewing loop.

- Poll promptly after a viewer message, seek, pause/resume, or meaningful scene change.

Continue the loop until one of these exit conditions occurs:

1. The viewer explicitly tells this AI to stop polling, leave, disconnect, or otherwise exit the screening.
2. The room becomes ended or inactive.
3. The cinema connection fails in a way that prevents further polling.

If the viewer specifies that the stop instruction must come through the cinema room message stream, only a qualifying room message should satisfy condition 1.

A tick is incremental delivery, not a complete transcript. Resetting cursors can replay old material. Losing cursors can skip the continuity your host intended to preserve.

If `more.any` is true, continue consuming backlog immediately using the returned cursors until caught up. Never discard returned cursors in favor of the current playhead merely to catch up.

The returned cursors include `seekVersion`. Always pass it back with the other cursor fields. When `range.seekDetected` is true, the server has rebased media delivery around the seek destination; use the new context and stop treating the skipped interval as current viewing. Continue with the returned cursors so the same seek does not replay its context. Room-message and live-observation cursors remain independent of media rebasing.

## Seeing a selected frame

A tick may return one or more selected storyboard entries. To actually inspect one:

1. Choose only a storyboard entry returned by the current or an already consumed tick.
2. Call `cinema_get_frame` with its `storyboardRef`, `mediaTimeMs`, and the same `roomId`.
   Set optional `quality: "hd"` when a closer look is needed. This returns one source frame at that timestamp (the final panel of newly generated storyboards), up to 1920×1080, under the same room spoiler gate.
3. Use the returned image as visual evidence for that moment.
4. Fetch frames sparingly: important reactions, visual clues, scene transitions, or moments where dialogue alone is insufficient.

Never invent what a frame contains from its filename or metadata. `cinema_read_window` returns bounded structured context; it is not a substitute for fetching an image when visual detail matters.

## Fuller bounded inspection

Use `cinema_read_window` only when the compact tick is insufficient. Keep the requested range close to the current playhead. The server enforces spoiler gating, but you should still request the smallest useful window.

## Discrete API model calls

The MCP server is not a universal model-memory service. When the host invokes the model as separate API calls, the host must restore at least:

- this skill or its operational rules;
- the stable AI display name;
- the active `roomId`;
- the latest returned cursors;
- enough recent conversation or a faithful running context to preserve the AI's own continuity;
- any pending decision, such as waiting for the viewer to press play.

The host should inject `consumerName` and `senderName` automatically on tool calls. A new model invocation does not require the human to re-enter the name, but a stateless host that forgets its configuration will lose that identity.

## Multiple connected AIs

Open Watch Cinema does not impose a fixed AI-seat count in the MCP adapter. Multiple MCP client processes can connect to the same loopback cinema, but they share:

- one active room at a time;
- the same playback state;
- the same room message stream;
- the same local media and AI packages.

Each client must keep its own identity, cursors, and model context. Coordinate room-opening and room-ending actions, because those affect everyone. Do not end the room merely because your own client is leaving.

## Ending

Stopping your own viewing loop and ending the shared cinema room are separate actions.

Only call `cinema_end_room` when the viewer explicitly ends the screening or clearly delegates that action. Ending archives the room as read-only.

If the viewer merely tells this AI to stop polling, leave, or disconnect, stop the viewing loop but do not call `cinema_end_room` unless they also asked to end the shared room.

Do not stop polling merely because:

- playback is paused;
- there are no new messages or media events;
- `more.any` is false;
- a requested test has completed;
- you have posted a reply;
- you have answered a viewer message.

A client that merely disconnects should leave the shared room intact.
