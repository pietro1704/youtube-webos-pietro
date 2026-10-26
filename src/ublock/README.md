# YouTube rules from uBlock Origin

The webOS webview cannot load a browser extension or implement the extension's
network/browser APIs. This module therefore runs the YouTube response rules in
the app, not the complete uBlock Origin extension or its general filter engine.

- Rules: [uAssets filters.txt, revision 6ddd246494b8c630ee1a93e715090214cb073903](https://github.com/uBlockOrigin/uAssets/blob/6ddd246494b8c630ee1a93e715090214cb073903/filters/filters.txt#L11).
- JSON pruning: `objectFindOwnerFn` and `objectPruneFn` extracted unchanged from
  [uBlock Origin revision 527a05c7af552a669fa2f51c29d5c7a214da7a2c](https://github.com/gorhill/uBlock/blob/527a05c7af552a669fa2f51c29d5c7a214da7a2c/src/js/resources/object-prune.js).
  The adapter supplies captured built-ins compatible with older webOS versions;
  stack-based matching is not used by these rules.
- Copyright Raymond Hill, GPL-3.0-or-later. The project retains its GPL license.

Covered: initial/player JSON, nested player responses, Shorts sequence entries,
the player/watch/playlist response replacements, and the TVHTML5 advertising
`initplayback` network rule. Existing webOS shelf filtering remains complementary.
Generic third-party extension filtering and cosmetic `:has-text` selectors are
not claimed as supported. Updates require reviewing and pinning a new source
revision and running the regression suite.
