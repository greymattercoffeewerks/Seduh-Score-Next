# Kinetic Scoreboard design system

Marketing-only identity for Seduh Score. It sells the energy of a public competition while the console remains operational and calm.

| Token              | Value     | Role                                  |
| ------------------ | --------- | ------------------------------------- |
| `--kinetic-canvas` | `#dededb` | Mineral page ground                   |
| `--kinetic-paper`  | `#f8f5ed` | Primary surface                       |
| `--kinetic-ink`    | `#15151a` | Text and dark surface                 |
| `--kinetic-coral`  | `#ff5a3c` | Primary action and competitive energy |
| `--kinetic-indigo` | `#4f55e0` | Live-score stage                      |
| `--kinetic-citron` | `#eef289` | Labels and active data                |

Use flat surfaces only: 34px cards, 28px bands, and pill controls. No shadows. Motion indicates liveness (halftone drift, score-card float, ticker, live pulse) and is disabled with `prefers-reduced-motion`. The system consumes the existing self-hosted Bricolage Grotesque and IBM Plex Sans fonts; it adds no network dependency.
