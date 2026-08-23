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
- Square corners, or a radius that isn't the documented `rounded-xl`/`2xl`
  (web) or `16`–`20` (mobile)
- A flat `1px solid #ccc` border where the rest of the app uses a soft tinted
  shadow
- Default system fonts and weights instead of the established hierarchy
- A one-off local `StyleSheet`/class that duplicates a shared component's look
- Inline styles for anything reusable

**Do not duplicate an existing component under a new name.** If you find
yourself writing a second modal, picker, or card wrapper, the existing one
should grow a prop instead. Two components that look 95% alike will drift, and
the drift is what makes an app feel machine-assembled.

---

## Premium UI Guidelines

When building or updating UI components across the web or mobile applications, always adhere to these premium design standards:

1. **Typography**: Prefer modern sans-serif fonts (e.g., `Outfit` and `Inter` on the web). Maintain strong visual hierarchy with bold headings.
2. **Glassmorphism & Depth**: Favor semi-transparent backgrounds with `backdrop-blur` (web) and multi-layered soft shadows (e.g., `--shadow-premium`) over flat colors and rigid borders.
3. **Micro-animations (Web)**: All interactive elements must have satisfying transition states (`active:scale-95`, `hover:-translate-y-1`, smooth fade-ins).
4. **Shapes & Radiuses**: Use softer border radiuses (`rounded-xl` or `rounded-2xl` on web, `borderRadius: 16` to `20` on mobile) instead of sharp, rigid boxes.
5. **Mobile Shadows**: For React Native, use deep, tinted shadows to simulate elevation (e.g., `shadowColor: '#6366f1', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }`). Avoid harsh `borderColor` boundaries on cards.
