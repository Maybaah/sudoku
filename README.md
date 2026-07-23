# sudoku

Classic 9×9 Sudoku for the [maybaah.github.io](https://maybaah.github.io/)
arcade: three difficulties, pencil marks, conflict highlighting, and a grid
that always has exactly one answer. Vanilla JS, no build step, no dependencies.

**Play:** https://maybaah.github.io/sudoku/

## How it fits together

This repo deploys as a project page under the root site's domain. It loads the
shared design system and arcade client (`/assets/site.css`, `/assets/arcade.js`)
from [Maybaah/Maybaah.github.io](https://github.com/Maybaah/Maybaah.github.io),
so it must be served under that domain to look and score right.

The puzzle is not stored anywhere. A seeded PRNG builds a solved grid, then
digs squares out of it in pairs about the center, keeping a removal only while
the answer stays unique. Difficulty is how bare the grid is allowed to get:

| Difficulty | Clue target | Typical clues |
| :-- | :-- | :-- |
| Easy | 42 | ~41 |
| Medium | 32 | ~32 |
| Hard | 26 | ~27 |

Because every removal was checked, no solve here ever needs a guess.

Every entry goes into a move log. On a solve the game submits
`{difficulty, seed, moves, timeMs}` to the arcade leaderboard Worker, which
rebuilds the same puzzle from the seed and replays the log before ranking
anything: the same never-trust-the-client model as
[minesweeper](https://github.com/Maybaah/minesweeper). Fastest solve per player
per difficulty counts, and the Worker counts the wrong digits it sees along the
way and publishes them as the run's *slips*.

**The generator is duplicated** between `game.js` and the Worker's
`src/index.js`, between the `── the generator ──` markers. It has to be, and it
has to stay identical: the page draws whatever it builds and the Worker rebuilds
the same puzzle to audit the run, so one character of drift makes the two
disagree about which squares were the player's to fill, and every solve is
rejected.

## Playing

- Click a square, type `1`-`9`, or use the pad below the grid
- `N` or the notes button writes pencil marks instead of digits
- Backspace, delete or `0` clears a square; arrows move the selection
- Duplicates in a row, column or box light up red as you go
- The clock starts on your first entry, not on page load
- Local run history lives in `localStorage` and feeds the arcade hub cards
