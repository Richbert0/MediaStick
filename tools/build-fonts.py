#!/usr/bin/env python3
"""Erzeugt die mitgelieferten Symbol- und Emoji-Schriften (app/fonts/mc-*.woff2).

Warum: Nicht jedes System bringt Emoji- und Symbolschriften mit (z. B. Raspberry Pi OS).
Damit alle Icons überall gleich angezeigt werden, liefert MediaCenter sie selbst aus:
  - MC Emoji   = Twemoji (Mozilla-Build, COLRv0, Grafiken CC-BY 4.0) – vollständig,
                 damit auch Emojis im Chat oder in Dateinamen funktionieren
  - MC Symbols = Noto Sans Symbols 2 / Symbols / Math / Noto Sans (SIL OFL 1.1) – nur die in der App benutzten Zeichen

Aufruf:  python3 tools/build-fonts.py <ordner-mit-quell-ttfs>
Benötigt: pip install fonttools brotli
Quellen:
  https://github.com/mozilla/twemoji-colr/releases            (Twemoji.Mozilla.ttf)
  https://github.com/notofonts/notofonts.github.io/tree/main/fonts
      NotoSansSymbols2/hinted/ttf, NotoSansSymbols/hinted/ttf, NotoSansMath/hinted/ttf
  https://github.com/google/fonts/tree/main/ofl/notosans          (NotoSans[wdth,wght].ttf → NotoSans-Regular.ttf)
Schreibt app/fonts/symbols.css und app/fonts/symbols.json (Abdeckung für test/fonts.test.js).
"""
import json
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'app')
OUT = os.path.join(APP, 'fonts')
SRC = sys.argv[1] if len(sys.argv) > 1 else '.'

# Zeichen im BMP, die standardmäßig als Emoji dargestellt werden (Unicode: Emoji_Presentation=Yes)
BMP_EMOJI = {0x231A, 0x231B, 0x23E9, 0x23EA, 0x23EB, 0x23EC, 0x23F0, 0x23F3, 0x25FD, 0x25FE, 0x2614, 0x2615,
             *range(0x2648, 0x2654), 0x267F, 0x2693, 0x26A1, 0x26AA, 0x26AB, 0x26BD, 0x26BE, 0x26C4, 0x26C5, 0x26CE,
             0x26D4, 0x26EA, 0x26F2, 0x26F3, 0x26F5, 0x26FA, 0x26FD, 0x2705, 0x270A, 0x270B, 0x2728, 0x274C, 0x274E,
             0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797, 0x27B0, 0x27BF, 0x2B1B, 0x2B1C, 0x2B50, 0x2B55}
IGNORE = {0xFE0E, 0xFE0F, 0xFEFF, 0x200D}


def cmap(path):
    return set(TTFont(path).getBestCmap().keys())


def scan_app(base):
    """Alle Zeichen der Oberfläche, die die Textschriften nicht enthalten → {codepoint: als_emoji}"""
    found = {}
    for root, _, files in os.walk(APP):
        if os.sep + 'fonts' in root:
            continue
        for fn in files:
            if not fn.endswith(('.html', '.js', '.css', '.json')):
                continue
            s = open(os.path.join(root, fn), encoding='utf-8', errors='ignore').read()
            for i, c in enumerate(s):
                o = ord(c)
                if o < 0x80 or o in base or o in IGNORE:
                    continue
                vs16 = i + 1 < len(s) and s[i + 1] == '️'
                found[o] = found.get(o, False) or vs16 or o >= 0x1F000 or o in BMP_EMOJI
    return found


def ranges(cps):
    out, start, prev = [], None, None
    for c in sorted(cps):
        if start is None:
            start = prev = c
        elif c == prev + 1:
            prev = c
        else:
            out.append((start, prev))
            start = prev = c
    if start is not None:
        out.append((start, prev))
    return ', '.join('U+%04X' % a if a == b else 'U+%04X-%04X' % (a, b) for a, b in out)


def main():
    base = set()
    for fn in os.listdir(OUT):
        if fn.endswith('.woff2') and not fn.startswith('mc-'):
            base |= cmap(os.path.join(OUT, fn))
    used = scan_app(base)

    emoji_src = os.path.join(SRC, 'Twemoji.Mozilla.ttf')
    emo = cmap(emoji_src)
    sources = [('sym2', 'NotoSansSymbols2-Regular.ttf'), ('sym1', 'NotoSansSymbols-Regular.ttf'), ('math', 'NotoSansMath-Regular.ttf'),
               ('text', 'NotoSans-Regular.ttf')]
    srcmaps = [(k, os.path.join(SRC, f), cmap(os.path.join(SRC, f))) for k, f in sources]

    text = {k: [] for k, _, _ in srcmaps}
    missing = []
    for cp, as_emoji in sorted(used.items()):
        if as_emoji and cp in emo and (0x203C <= cp <= 0x3299 or 0x1F000 <= cp <= 0x1FAFF):
            continue                      # wird von MC Emoji gezeichnet
        for k, _, cm in srcmaps:
            if cp in cm:
                text[k].append(cp)
                break
        else:
            if cp not in emo:
                missing.append(cp)

    # Emoji-Schrift vollständig als WOFF2
    ft = TTFont(emoji_src)
    ft.flavor = 'woff2'
    ft.save(os.path.join(OUT, 'mc-emoji.woff2'))

    faces = []
    for k, path, _ in srcmaps:
        cps = text[k]
        if not cps:
            continue
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = ['*']
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        ft = TTFont(path)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=cps)
        sub.subset(ft)
        ft.flavor = 'woff2'
        name = 'mc-symbols-%s.woff2' % k
        ft.save(os.path.join(OUT, name))
        faces.append((name, ranges(cps)))

    css = ['/* Mitgelieferte Symbol- und Emoji-Schriften – erzeugt von tools/build-fonts.py, nicht von Hand ändern.',
           ' * MC Symbols: Noto Sans Symbols / Symbols 2 / Math / Noto Sans (SIL OFL 1.1)',
           ' * MC Emoji:   Twemoji (Grafiken © Twitter, CC-BY 4.0; Schrift: Mozilla twemoji-colr) */']
    for name, rng in faces:
        css.append("@font-face{font-family:'MC Symbols';font-style:normal;font-weight:100 900;font-display:swap;"
                   "ascent-override:92%%;descent-override:24%%;line-gap-override:0%%;"
                   "src:url(/fonts/%s) format('woff2');unicode-range:%s}" % (name, rng))
    # Nur Emoji-/Symbolbereiche: die Schrift enthält auch Ziffern (für Tastenkappen-Emojis),
    # die sonst in Schriftlisten ohne passende Textschrift als Emoji-Ziffern erscheinen würden
    # Zeilenmetriken angleichen: sonst machen Emojis jede Zeile/Schaltfläche höher als normaler Text
    css.append("@font-face{font-family:'MC Emoji';font-style:normal;font-weight:100 900;font-display:swap;"
               "ascent-override:92%;descent-override:24%;line-gap-override:0%;"
               "src:url(/fonts/mc-emoji.woff2) format('woff2');"
               "unicode-range:U+00A9, U+00AE, U+200D, U+203C-3299, U+FE0F, U+1F000-1FAFF, U+E0020-E007F}")
    # Formularelemente übernehmen sonst die Systemschrift und damit keine Symbole
    css.append(':where(button,input,select,textarea,option){font-family:inherit}')
    open(os.path.join(OUT, 'symbols.css'), 'w', encoding='utf-8').write('\n'.join(css) + '\n')

    emo_range = lambda c: c in (0xA9, 0xAE, 0x200D, 0xFE0F) or 0x203C <= c <= 0x3299 or 0x1F000 <= c <= 0x1FAFF or 0xE0020 <= c <= 0xE007F
    covered = set(cp for v in text.values() for cp in v) | set(c for c in emo if emo_range(c)) | base
    json.dump({'note': 'Von den mitgelieferten Schriften abgedeckte Zeichen (geprüft von test/fonts.test.js)',
               'ranges': ranges(covered)}, open(os.path.join(OUT, 'symbols.json'), 'w', encoding='utf-8'), indent=1)
    print('Symbolzeichen je Schrift:', {k: len(v) for k, v in text.items()},
          '| Emoji-Zeichen in der App:', sum(1 for v in used.values() if v))
    if missing:
        print('NICHT ABGEDECKT:', ' '.join('U+%04X %s' % (c, chr(c)) for c in missing))
        sys.exit(1)


if __name__ == '__main__':
    main()
