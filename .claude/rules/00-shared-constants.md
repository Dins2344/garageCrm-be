<!-- SHARED RULE — the same file exists in all three GaragePulse repositories:
       Dins2344/garageCrm-be   (backend)
       Dins2344/garageCrm-fe   (web)
       Dins2344/garageCrm-app  (mobile)
     They are separate repos with no shared package, so a change here must be
     copied to the other two by hand. If you have all three cloned side by side,
     /mirror-check diffs them for you. -->
## Constants — What Belongs in `constants.ts`

Every app has one: `backend/config/`, `frontend/src/utils/constants.ts`,
`mobile/src/utils/constants.ts`. A literal that appears in more than one place,
or that someone would need to *find and change*, belongs there.

**Always extract:**

| Kind | Examples |
| --- | --- |
| Storage keys | `garagepulse_token`, `garagepulse_active_garage` |
| External URLs | Play Store listing, asset/CDN URLs, doc links |
| Limits and page sizes | `DEFAULT_PAGE_SIZE`, `DROPDOWN_FETCH_LIMIT` |
| Timeouts and durations | idle timeout, animation settle delays |
| Enum string values | roles, job statuses, service types |
| Repeated labels/option lists | status dropdown options, role labels |
| Anything env-derived | API base URL, web app URL |

**Never extract — leave it inline:**

- **One-off UI copy.** A heading, a button label, a placeholder, a toast
  message used in exactly one place. `<h2>Garage Information</h2>` is clearer
  inline than as `GARAGE_INFO_HEADING`; a constants file full of display
  strings is a translation layer without the translation.
- **Values that come from the garage's locale.** Currency symbols, tax labels,
  date formats and phone examples resolve from `country` at runtime — see
  **utils/format.ts** and **utils/locale.ts**. A constant here silently
  re-breaks non-Indian garages.

**The test:** would changing this value in one place, and having it apply
everywhere, be *correct*? If yes, extract. If the same word appearing in two
screens is a coincidence rather than a shared meaning, leave both inline.

**Why storage keys matter most.** They were inlined 18 times across the mobile
app, and that is exactly how `garagepulse_web_banner_dismissed` came to be
missing from logout's cleanup — the "More on the web" banner never reappeared,
and on a shared garage device one person dismissing it hid it from everyone who
logged in afterwards. Mobile clears a declared list on sign-out rather than
naming keys at the call site, so a new key is cleaned up by being declared.

---

