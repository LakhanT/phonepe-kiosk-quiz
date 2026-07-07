# PhonePe Kiosk — Quiz + Find the Word

## Game flow
1. **Quiz** — tap the correct multiple-choice answer
2. **Correct** → find the **same answer** hidden in the word puzzle (+word points)
3. **Wrong quiz** → skip puzzle, next question
4. **Wrong puzzle selection** → 0 word points, keep trying until time runs out
5. **3 questions** per round · **15 seconds** per puzzle · **10 puzzle variants**

## Scoring
| Action | Points |
|---|---|
| Correct quiz | 10 |
| Find correct answer in grid | 10 |
| Wrong grid selection / timeout | 0 (word portion) |

## Edit `questions.json`

```json
{
  "clue": "What does UPI stand for?",
  "options": [
    "Unified Payments Interface",
    "Universal Payment Index",
    "United Pay Integration"
  ],
  "correctIndex": 0
}
```

The puzzle hides the **correct option text** (letters only, uppercase).  
Optional `"answer": "SHORTFORM"` overrides the option text for the grid if the full answer is too long.

Wrong options are automatically added as decoy words in the puzzle.

## Run

```powershell
python -m http.server 5173
```

Hard refresh: `Ctrl+Shift+R`
