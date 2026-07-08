# PhonePe Integrity Kiosk — Quiz + Find the Keyword

Touch-screen Integrity campaign game built from client **Game Rules** and **Final Questions** Excel.

## Game flow
1. Each player gets **10 random questions** from the 100-question bank.
2. Quiz shows **Option A**, **Option B** (from Excel) plus a generic **Option C** (`None of the above / Not sure`).
3. **Correct quiz** → find that question’s **Keyword** (Excel Keyword column) in the crossword.
4. Crossword hides **all 10 keywords** for that player’s questions (layout **jumbled per player / variant**).
5. Words are **horizontal & vertical only** (no diagonals).
6. **Wrong quiz** → skip puzzle, next question.
7. **Wrong keyword** → half points for that round.
8. **15 seconds** per keyword search.

## Scoring
| Action | Points |
|---|---|
| Correct quiz | 10 |
| Find correct keyword | 10 |
| Correct quiz + wrong keyword | half of round total |
| Wrong quiz / timeout | 0 for skipped / word portion |

## Content source
- File: `Final Questions - (Digital Game).xlsx`
- Columns used: Question, Option A, Option B, Correct Option, Keyword
- Re-import: `python scripts/import_questions.py`

## Run

```powershell
python -m http.server 5173
```

Open http://localhost:5173 — add `?kiosk=1` for kiosk hardening.
