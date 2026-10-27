---
name: register-uploaded-rom
description: Register a ROM the user sends or points to (a local path or a dropped file) in the retro library under the right system, then find and set its box art.
---

# Register an uploaded ROM

Use when the user gives a ROM file ("upload this", a path, a dropped file). The file is on the
user's machine, not the server: the server never reads a path, the client sends the bytes.

## Steps

1. **Send the file.** Call `upload_ticket` with the file name and size, then upload to the returned
   URL (the chat does this itself; a terminal client runs the `curl` line the ticket returns). A
   refusal here (too big, extension not allowed, already there) is final: tell the user why.
2. **Name the system.** The upload result carries a `system` guessed from the extension and header.
   When it is null or the extension is shared (`bin`, `iso`, `zip`, `chd`), ask the user which
   system. Never guess one.
3. **Register.** Call `upload_apply` with the upload id.
   - `add` or `update`: it is done; go on.
   - Anything else (same name with different content, unreadable header): the call returns a
     preview. Show it and wait. Do not retry, rename the file or pick another folder to get around it.
4. **Find the game.** `retro_games_search` with the file's title and the system gives the game id.
5. **Box art.** Run `retro_art_candidates` for the id and take a name that matches the title
   exactly. A ROM hack or translation has its own title: try the base game's title as `q`, and say
   in the report that the art is borrowed from the original. If libretro has nothing, use
   `retro_sgdb_search`, then `retro_sgdb_covers`, then `retro_cover_set`. Pictures are shrunk by the
   server; do not resize anything yourself.
6. **Korean name.** Offer candidates from `retro_ko_names`. A hack or mod is not the base game:
   never copy the base game's original title or Korean name onto it as fact. Leave the name empty
   rather than invent one.

## Report

One line: system, file name, size, art source, and whether anything is waiting for an approval.

## Never

Delete or overwrite a library file, rename the uploaded file, or register it under a system the
user has not confirmed when the system was ambiguous.
