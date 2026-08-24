<!-- SHARED RULE — the same file exists in all three GaragePulse repositories:
       Dins2344/garageCrm-be   (backend)
       Dins2344/garageCrm-fe   (web)
       Dins2344/garageCrm-app  (mobile)
     They are separate repos with no shared package, so a change here must be
     copied to the other two by hand. If you have all three cloned side by side,
     /mirror-check diffs them for you. -->
## Component Reuse — Avoid Generic Filler

Before writing a new component, **look for one that already exists.** These
codebases have a real component library and a specific visual language; a new
component built from framework defaults stands out immediately and quietly
forks the design system.

**The order of preference:**

1. **Use the existing component.** Check `frontend/src/components/` or
   `mobile/src/components/` first. Most needs are already covered — modals,
   pickers, form fields, buttons, cards, tables, empty states, loaders.
2. **Extend the existing component** with a prop, if it is 90% right.
3. **Only then write a new one** — and style it from the tokens in
   **Shared Color System** (in `00-shared-contract.md`) and **Premium UI
   Guidelines** below, not from defaults.

**Signs a component is generic filler and needs rework:**

- Colors that aren't in the shared palette (`'tomato'`, `'#333'`, `'blue'`)
- Colours or radii written as literals instead of taken from the app's tokens
  (`index.css` `@theme` on web, `src/theme.ts` on mobile)
- A border that does not clear 3:1 against its own ground on an operable
  control — a divider token and a control-edge token are not interchangeable
- Default system fonts and weights instead of the established hierarchy
- A one-off local `StyleSheet`/class that duplicates a shared component's look
- Inline styles for anything reusable

**Do not duplicate an existing component under a new name.** If you find
yourself writing a second modal, picker, or card wrapper, the existing one
should grow a prop instead. Two components that look 95% alike will drift, and
the drift is what makes an app feel machine-assembled.

---

## UI Guidelines

Both clients now run the **Service Counter** system — warm bone grounds, ink
for standing dark bands, signal orange rationed to one committing action.
`frontend/DESIGN.md` is the normative spec; `mobile/src/theme.ts` is mobile's
implementation of the same palette.

1. **Tokens, never literals.** Web takes colour, radius and depth from the
   `@theme` block in `index.css`; mobile from `src/theme.ts`. Neither app has
   a hex literal outside those files — do not add the first one.
2. **Grounds are bone, not white or grey.** `bone-100` is the page field,
   `bone-50` is a panel, `ink-900` is a standing dark band.
3. **A divider and a control edge are different tokens.** `bone-200` divides;
   `bone-400` draws the edge of anything a user operates and is the one that
   clears 3:1. Getting this wrong produces a border nobody can see.
4. **Shapes.** Web is square — radius `0` everywhere, enforced from the theme.
   Mobile keeps a small radius (`radius.lg` = 10) and real Android elevation,
   because zero radius reads as deliberate on a web page and as unfinished
   against Material's conventions. The palette and type scale are shared; the
   corner radius deliberately is not.
5. **Depth.** Web has no shadows at all — depth is a ground change plus a
   one-pixel rule. Mobile keeps `elevation.*` for Android, tinted warm rather
   than indigo, because a cool shadow on a warm ground reads as dirt.
6. **Colour is rationed.** Orange marks the one action that completes a flow.
   A second orange element on the same screen means one of them is not that.
