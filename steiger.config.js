/**
 * Steiger configuration: the FSD rules for both halves.
 *
 * Steiger's CLI takes one root, so `npm run lint:fsd` runs it twice with this
 * same configuration, once per half.
 *
 * `src/host` holds the lower three of FSD's six layers: `shared`, `entities` and
 * `features`. The host composes no UI, so there is nothing for `widgets` or
 * `pages` to hold, and there is no `app` layer: the entry points and the wiring
 * (`index.ts`, `cli.ts`, `proxy-cli.ts`, `admin-wiring.ts`, `token-resolver.ts`,
 * `launch-token-bridge.ts`, `cli-skill.ts`) sit at the `src/` root, beside the
 * analysed tree rather than in it.
 *
 * `src/client` holds five layers: `shared`, `entities`, `features`, `widgets`
 * and `pages`. There is no `app` layer on purpose: a plugin does not own its
 * application shell, so `index.tsx` sits at the root of the analysed tree and
 * wires the host's slots to this plugin's page.
 *
 * Two rules are relaxed, each for a reason that would not apply to a full
 * application:
 *
 *   - `fsd/insignificant-slice`: most slices here have exactly one consumer by
 *     definition (the route in a feature, or the root entry that mounts it).
 *     Waiting for a second consumer before a slice may exist would mean few
 *     slices at all.
 *   - `fsd/repetitive-naming`: file and class names in this repository carry the
 *     plugin or feature prefix on purpose, because a stylesheet rendered into
 *     the host document is not scoped by anything.
 */
import fsd from "@feature-sliced/steiger-plugin";

export default [
  ...fsd.configs.recommended,
  {
    rules: {
      "fsd/insignificant-slice": "off",
      "fsd/repetitive-naming": "off",
    },
  },
];
