"""Import Final Questions Excel into questions.json for the Integrity kiosk game."""
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

XLSX = Path(r"c:\Users\spark\Downloads\Final Questions - (Digital Game).xlsx")
OUT = Path(__file__).resolve().parents[1] / "questions.json"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# Plausible wrong answers per topic when no cross-question distractor is available.
TOPIC_FALLBACK_C = {
    "Alcohol and Drug": "One drink is fine if the team agrees informally.",
    "AML / Sanctions": "Process the transaction if the amount looks small.",
    "Antitrust": "Share pricing details privately with the competitor to stay competitive.",
    "Bribery": "Approve the payment to avoid delaying the project.",
    "Commercial Bribery": "Accept the offer if the business benefit is significant.",
    "Conflict of Interest": "No need to disclose if the relationship is personal.",
    "Code of Conduct": "Report only if you are directly affected.",
    "CoC": "Report only if you are directly affected.",
    "COC": "Report only if you are directly affected.",
    "D&H": "Treat everyone the same without checking policy requirements.",
    "Environment, Health & Safety": "Skip the safety step if it saves time.",
    "Financial Integrity": "Adjust entries now and correct them in the next cycle.",
    "Fraud": "Ignore suspicious activity unless you have full proof.",
    "IT Compliance": "Use personal software if it works faster.",
    "L&E": "Handle the issue informally without involving HR.",
    "L&P": "Proceed without the license if the client is waiting.",
    "Mishandling Business Information": "Forward the file to colleagues for quicker help.",
    "Privacy": "Share customer details with anyone who asks politely.",
    "Retaliation": "Stay quiet to avoid conflict with the team.",
    "Sexual Harassment": "Wait until the behavior becomes more serious.",
}


def col_row(ref: str):
    m = re.match(r"([A-Z]+)(\d+)", ref)
    col = 0
    for ch in m.group(1):
        col = col * 26 + (ord(ch) - 64)
    return col, int(m.group(2))


def clean(s: str) -> str:
    s = (s or "").replace("\u00a0", " ")
    for a, b in (
        ("\u2019", "'"),
        ("\u2018", "'"),
        ("\u201c", '"'),
        ("\u201d", '"'),
        ("\u2013", "-"),
        ("\u2014", "-"),
        ("\ufffd", ""),
    ):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def load_sheet():
    with zipfile.ZipFile(XLSX) as z:
        ss = []
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(f"{NS}si"):
            texts = [t.text or "" for t in si.iter(f"{NS}t")]
            ss.append("".join(texts))
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))

    rows = {}
    for c in sheet.findall(f".//{NS}c"):
        ref = c.get("r")
        if not ref:
            continue
        col, row = col_row(ref)
        t = c.get("t")
        v = c.find(f"{NS}v")
        is_elem = c.find(f"{NS}is")
        val = ""
        if t == "inlineStr" and is_elem is not None:
            texts = [x.text or "" for x in is_elem.iter(f"{NS}t")]
            val = "".join(texts)
        elif v is not None:
            val = v.text or ""
            if t == "s" and val.isdigit():
                val = ss[int(val)]
        rows.setdefault(row, {})[col] = val.strip() if isinstance(val, str) else str(val)
    return rows


def pick_option_c(question, all_questions, index):
    """Question-specific third wrong option from the same topic only."""
    used = set(question["options"])
    alleg = question.get("allegation", "")
    candidates = []

    for other in all_questions:
        if other is question:
            continue
        if other.get("allegation") != alleg:
            continue
        wrong = other["options"][1 - other["correctIndex"]]
        if wrong not in used:
            candidates.append(wrong)

    seen = set()
    unique = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)

    if unique:
        return unique[index % len(unique)]

    return TOPIC_FALLBACK_C.get(
        alleg,
        "Proceed without escalating since the issue seems minor.",
    )


def attach_third_options(questions):
    for i, q in enumerate(questions):
        q["optionC"] = pick_option_c(q, questions, i)


def main():
    rows = load_sheet()
    questions = []
    keyword_labels = set()

    for r in sorted(rows):
        if r == 1:
            continue
        d = rows[r]
        if not d.get(1):
            continue
        kw = clean(d.get(7, ""))
        clue = clean(d.get(3, ""))
        if not kw or not clue:
            continue
        opt_a = clean(d.get(4, ""))
        opt_b = clean(d.get(5, ""))
        if not opt_a or not opt_b:
            continue
        kw_label = re.sub(r"[^A-Za-z0-9 ]", "", kw).upper().strip()
        kw_label = re.sub(r"\s+", " ", kw_label)
        correct = clean(d.get(6, "")).upper()
        questions.append(
            {
                "allegation": clean(d.get(2, "")),
                "clue": clue,
                "options": [opt_a, opt_b],
                "correctIndex": 0 if correct == "A" else 1,
                "categoryWord": kw_label,
            }
        )
        keyword_labels.add(kw_label)

    attach_third_options(questions)

    decoys = sorted({re.sub(r"[^A-Z0-9]", "", k) for k in keyword_labels})
    longest = max(len(d) for d in decoys)

    cfg = {
        "orientation": "landscape",
        "kioskResolution": "1920x1080",
        "roundsPerGame": 10,
        "wordFindSeconds": 15,
        "idleResetSeconds": 10,
        "quizPoints": 10,
        "wordPoints": 10,
        "puzzleVariants": 10,
        "decoyWords": decoys,
        "grid": {"minSize": 16, "maxSize": max(24, longest + 2)},
        "questions": questions,
    }
    OUT.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(questions)} questions, {len(decoys)} decoys, maxSize={cfg['grid']['maxSize']}")
    print("sample optionC:", questions[0]["optionC"][:60])


if __name__ == "__main__":
    main()
