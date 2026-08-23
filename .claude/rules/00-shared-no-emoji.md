<!-- SHARED RULE — the same file exists in all three GaragePulse repositories:
       Dins2344/garageCrm-be   (backend)
       Dins2344/garageCrm-fe   (web)
       Dins2344/garageCrm-app  (mobile)
     They are separate repos with no shared package, so a change here must be
     copied to the other two by hand. If you have all three cloned side by side,
     /mirror-check diffs them for you. -->
## No Emoji

Emoji are not part of this product's visual language. Do not put them in UI
strings, toast messages, section headings, log output, seed data, comments,
commit messages, shell scripts, CI output, or documentation.

**Use the app's icon set instead:**

| App      | Library                     | Example                                           |
| -------- | --------------------------- | ------------------------------------------------- |
| Mobile   | `@expo/vector-icons` Ionicons | `<Ionicons name="person-outline" size={16} color="#3b5ff8" />` |
| Frontend | `lucide-react` (or `react-icons/hi` where a file already uses it) | `<Check className="w-4 h-4" strokeWidth={3} />` |
| Backend  | none — plain text           | `Hi ${customerName},`                             |

**Why this is a rule, not a preference:**

- **They render differently everywhere.** An emoji is drawn from the platform's
  font, so the same character is a different picture on Android 12 vs 15 vs
  iOS, and next to a consistent icon set it reads as clip art.
- **PDFKit's built-in fonts have no glyphs for them.** The same is true of the
  currency symbols this codebase already works around (see
  `backend/utils/format.ts`) — an emoji in a PDF is a blank box or a crash.
- **They cost real money in SMS.** A single emoji switches a message from
  GSM-7 to UCS-2 encoding, which halves the characters per segment and can
  double the send cost.
- **They break plain-text and terminal output.** Log aggregators, CI consoles
  and email clients in plain-text mode all mangle them.

Where a glyph carried meaning — a checkmark for "done", a cross for "wrong" —
replace it with an icon component in UI, or with the *word* in text contexts
(`RIGHT` / `WRONG`, `Done`, `OK` / `FAIL`). Deleting the glyph and leaving the
sentence to fend for itself loses information.

---

