# Country flags

One SVG per two-letter code in `core/country.js` (243 files, lower-case ISO 3166-1 alpha-2 names), rendered by
`core/countryFlag.js`.

- **Source:** [flag-icons](https://github.com/lipis/flag-icons) 7.2.3, the `flags/4x3` set, copied unmodified.
  `ac.svg` and `ta.svg` are that set's `sh-ac.svg` and `sh-ta.svg` (Ascension Island and Tristan da Cunha).
- **Licence:** MIT, Copyright (c) 2013 Panayiotis Lipiridis. The licence text is in `LICENSE` beside the files and
  must stay with them: the MIT licence asks for the notice to travel with copies.
- Self-hosted on purpose (no CDN: a venue's wifi cannot be relied on). The set is 4:3; `.ok-flag-img` shows it in a
  24 by 16 box with `object-fit: cover`.
- To refresh: copy the same files from a newer flag-icons release and update the version above.
