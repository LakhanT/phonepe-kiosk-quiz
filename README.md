# PhonePe Integrity Kiosk — Quiz + Find the Word

Touch-screen Integrity campaign game built from client **Game Rules**, **Final Questions**, and sample scenarios.

## Game flow (per Game Rules)
1. Participant is asked a quiz question (A / B).
2. **Correct** → earns quiz points, then must find the question’s **category keyword** in Find the Word.
3. **Correct keyword** → full word points.
4. **Wrong quiz** → skip puzzle, move to next question.
5. **Correct quiz + wrong category** → **half points** only for that round.
6. Repeats for **3 rounds**.
7. **15 seconds** to find the word (horizontal & vertical only — no diagonals).
8. Similar integrity keywords are placed as decoys.
9. Keywords come from the client question bank.
10. **10 puzzle variants** rotate so consecutive players get different grids.

Target: finish 3 questions in about **1 minute**.

## Scoring
| Action | Points |
|---|---|
| Correct quiz | 10 |
| Find correct category in grid | 10 |
| Correct quiz + wrong category | half of round total (10) |
| Wrong quiz / timeout on word | 0 for skipped / word portion |

## Questions
- Bank: **100** questions from `Final Questions - (Digital Game).xlsx`
- Each game picks **3 random** questions
- Puzzle target = `categoryWord` (Keyword column), not the long quiz option text
- Re-import: `python scripts/import_questions.py`

## Run

```powershell
python -m http.server 5173
```

Open http://localhost:5173 — add `?kiosk=1` for kiosk hardening.
