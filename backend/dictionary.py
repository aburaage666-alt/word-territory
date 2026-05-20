"""
Word Territory – dictionary module

Word list source: wordfreq (CC BY-SA 4.0) filtered by:
  - zipf frequency 2.5–5.8  (recognizable but not trivial function words)
  - pyenchant en_US validation  (removes proper nouns / abbreviations)
  - length 3–6 letters

License note: wordfreq is CC BY-SA 4.0.
Attribution: wordfreq by Robyn Speer et al. (https://github.com/rspeer/wordfreq)
"""

from pathlib import Path

WORDS: set[str] = set()
BASE_DIR = Path(__file__).resolve().parent
WORDS_FILE = BASE_DIR / "words.txt"

with open(WORDS_FILE, "r", encoding="utf-8") as f:
    for line in f:
        word = line.strip().upper()
        if 3 <= len(word) <= 6 and word.isalpha():
            WORDS.add(word)


def is_valid_word(word: str) -> bool:
    return word.upper() in WORDS


def get_words() -> set[str]:
    return WORDS
