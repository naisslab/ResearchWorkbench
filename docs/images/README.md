# README Screenshot Sources

These files are copies of existing application screenshots. The October 19 README reorganization did not recapture or edit their pixels. Agent captures use test conversations, synthetic account labels, and illustrative model names; they demonstrate the interface rather than results from a live model session.

| Image | Existing Capture | Capture Script |
| --- | --- | --- |
| `workbench.png`, `overview.png`, `board.png`, `feedback.png`, `dark.png` | `output/playwright/readme-*.png` | `scripts/readme-screenshots.mjs` |
| `agent-workbench.png` | `output/playwright/ai-agent.png` | `scripts/ai-agent-smoke.mjs` |
| `agent-skills.png` | `output/playwright/ai-skills-picker.png` | `scripts/ai-agent-smoke.mjs` |
| `agent-queue.png` | `output/playwright/ai-request-queue-dark.png` | `scripts/ai-agent-smoke.mjs` |
| `agent-tools.png` | `output/playwright/ai-native-tools.png` | `scripts/ai-native-smoke.mjs` |
| `agent-changes.png` | `output/playwright/ai-review-diff.png` | `scripts/ai-review-smoke.mjs` |
| `agent-paper-review.png` | `output/playwright/ai-paper-review.png` | `scripts/ai-review-smoke.mjs` |

The captures were visually inspected before selection. The dedicated README workspace uses fictional research projects. Some older smoke scripts seed the historical research catalog; inspect each capture before copying it into documentation. Do not publish raw test-output folders or assume every screenshot from a suite is suitable for a README. Existing selected modal screenshots obscure their background through the application's own blur effect.

To regenerate the dedicated project and manuscript examples, run `npm run build` and `node scripts/readme-screenshots.mjs` in a macOS desktop session with the required TeX tools. Outputs go to `output/playwright/`; review them before replacing files here. See [Contributing](../../CONTRIBUTING.md) for the Agent UI suites.
