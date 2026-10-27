# Invent a messenger

Everyone has WhatsApp and Telegram, and everyone has the same problems with them: the one important message is
buried under 38 unread ones in a muted group, the question you meant to answer scrolled away, the address is
somewhere in a voice message, and you find out you owe someone money when they remind you a third time.

**Invent a messenger that is genuinely more convenient, and build a working prototype of it.** Not a clone with a
different colour: rethink what a messenger should do for its user, keep what already works, and make the main flows
feel effortless. You decide what the product is.

This is an MVP for testing an idea with real people, not production code: there is one user, no real network, no
encryption, no accounts to manage. What matters is what people feel when they use it for five minutes.

## What people will try

People compare prototypes by different agents side by side and pick the one they'd rather use. They will open it
as Alex (the signed-in user) and try things like:

- In one minute, find out what people are waiting for from Alex, and answer the most urgent thing.
- Find a piece of information buried in a busy chat (when the water is off in the building, how much Alex owes for
  a gift, where dinner is tonight).
- Reply to a specific message, react to one, attach a file, send a voice note.
- Notice new messages arriving while they are in another chat, and deal with them without losing their place.
- Do all of it on a phone.

## Data (`/work/data`)

- `me.json`: the user (Alex Morgan) and `now`, the moment the prototype starts at: show times relative to it (the
  data's timestamps are in UTC; Alex is in Lisbon).
- `contacts.json`: 34 people in the address book: name, username, phone, bio, last seen, some birthdays.
- `chats.json`: 24 conversations: direct chats, groups and channels; `pinned`, `muted`, `archived`, and
  `last_read_message_id` (the messages after it from others are unread).
- `messages.json`: 572 messages, oldest first. `from` is a contact id, `u0` (Alex) or the chat's own id (a channel
  or an unknown number). Some have `reply_to`, `reactions`, `edited`, or an `attachment`: `photo` (no image file:
  draw a placeholder, use the caption), `file`, `voice` (with `duration_s` and a `transcript`), `location`, `link`
  or `poll`.
- `incoming.json`: the world going on. There are no other real users, so play these events from the moment the app
  starts: at `after_s` seconds, a `message` arrives in `chat_id` from `from`, or `from` is `typing` for `for_s`
  seconds. Start the clock per browser session: everyone who opens the app sees them arrive.

What Alex sends, edits or deletes is kept (in the browser or on the server) and survives a reload.

## How it is checked

There is no fixed API and no list of features to tick off. The automatic checks only gate the run: the app starts,
`/` serves HTML, and right after start the first screen shows Alex's most recent conversations (their titles,
whatever the layout). The score of a run that passes them is 100. The ranking comes from people: the pages are
screenshotted on a desktop and a phone, and people use the live apps of two agents side by side in blind votes.
