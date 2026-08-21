# GHL Conversation Archive

Archives every conversation and message in a HighLevel sub-account to a folder on
your machine. **Export only** — there is no import, for reasons set out below.

Separate from the workflow backup extension on purpose: different data, different
risk profile, different permissions.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this folder.

## Use

1. Open a HighLevel sub-account tab and sign in as normal.
2. Click the extension icon. It shows the sub-account and how many conversations
   it holds.
3. **Open the archiver…** — it runs in its own tab, because a full archive takes
   far longer than a popup stays open.

Three steps in that tab: grant durable access to this sub-account's origin, pick
a local folder, run.

```
<folder>/
├── manifest.json          counts, options, resume cursor, completed ids
├── contacts.json          contactId -> name, email, phone
├── conversations.jsonl    one conversation per line, metadata
├── messages.jsonl         one message per line
└── conversations/
    └── <contact>-<id>.json
```

Measured on a real sub-account: 2,058 conversations at ~81 messages each,
~2.4 KB per message — roughly 167,000 messages, 390–880 MB depending on which
outputs you enable, about 20 minutes. The projection in the progress panel
corrects itself from real bytes as it goes.

The run is **resumable**. `manifest.json` holds the search cursor and every
completed conversation id, so an interrupted run continues rather than starting
over. Keep that file with the folder.

For analysis, `messages.jsonl` loads directly:

```sh
duckdb -c "SELECT contactName, count(*) FROM read_json_auto('messages.jsonl') GROUP BY 1 ORDER BY 2 DESC LIMIT 20"
```

## How it works

| Purpose | Request |
|---|---|
| Conversation list | `GET services.leadconnectorhq.com/conversations/search?locationId=&limit=&startAfterDate=` |
| Messages in one thread | `GET .../conversations/{id}/messages?limit=&lastMessageId=` |
| Contact record | `GET .../contacts/{id}` |

**Paging.** Conversation search is cursor-paged, not offset-paged. `offset` and
`page` are accepted and *silently ignored* — they return page one again. The
cursor is the previous page's last conversation's `sort[0]`, passed back as
`startAfterDate`. Messages page separately on `lastMessageId`.

**The bulk endpoint.** `GET /conversations/messages/export` exists and is
purpose-built for this, with proper cursor pagination. It rejects a browser
session with `401 Can not fetch messages from non-OAuth channel`. It needs a
Private Integration or OAuth token. If you make one, that endpoint is a better
tool than this extension, and it would be a script rather than an extension.

## Design notes

**No credential handling.** The extension injects a function into the page's MAIN
world and borrows `window.SHELL_STORE.$http` — the app's own axios instance, whose
interceptor attaches the session token. The token is never read, copied, stored,
or sent anywhere.

**Permissions.** `activeTab` and `scripting`. Host access is declared *optional*
and requested at runtime for one origin only, when you start an archive — a run
that lasts twenty minutes needs access that outlives a popup click. Revoke it from
the extension's details page whenever you like. No background service worker, no
remote code, no network destination other than HighLevel's own API.

**Written incrementally.** Files are written through the File System Access API as
the run proceeds, so nothing large is held in memory and a crash costs you only
the conversation in flight.

## About the data

This is customer PII: names, email addresses, phone numbers and full message
bodies, written unencrypted to the folder you pick. Keep it out of any git
repository — not because a private repo is insecure, but because git history is
permanent and this is exactly the data a deletion request applies to.

## Why there is no import

Export is solved. Import is not, and the blocker is not contact IDs.

Mapping old contact ids to new ones is the easy part, which is why `contacts.json`
is written: id, name, email and phone, enough to match contacts in a target
account by email or normalised phone.

The hard parts:

- **No restore API.** Nothing recreates a conversation as it was. The closest are
  *Add Inbound Message* and *Add External Outbound Call*, which record messages
  one at a time onto a contact.
- **Backdating is unverified.** Whether those endpoints accept a custom timestamp
  is not stated consistently in the public documentation, and it is not something
  to establish by writing to a live account. If they do not, every restored
  message lands with today's date and the history is worthless as history.
- **Writing messages fires automations.** Inbound messages are a trigger type.
  Replaying ~167,000 of them into an account with live workflows could start
  automations en masse, including outbound sends to real customers. This is the
  genuine hazard, and it is worse than data loss.
- **Fidelity is lost anyway.** Call recordings, transcriptions, email threading
  headers, delivery status, attachments and read state do not round-trip.
- **Rate limits.** At roughly 100 requests per 10 seconds, 167,000 writes is
  measured in days.

Treat conversation history as an archive, not a restorable backup. If you migrate
accounts, carry a summary onto the contact — a note, or a link into this archive —
rather than replaying the messages.

## Limits

- One sub-account per run — whichever the tab is on.
- Message bodies come back inline but also carry a `bodyStorageUrl`; very long
  emails are truncated in the API response and the full body lives at that URL.
  This archives what the API returns and does not chase those URLs.
- These are undocumented internal endpoints. They can change without notice.

## Changelog

### 1.0.0
- Split out of the workflow backup extension, where it never belonged.
- Resumable archive of all conversations and messages to a local folder.
