# -*- coding: utf-8 -*-
"""Минимальный извлекатель текста из PDF с подмножествами шрифтов.

В этом PDF символы закодированы кодами подмножества (33, 34, 35…), поэтому
без карты ToUnicode текст нечитаем. Скрипт собирает карту для каждого шрифта,
идёт по страницам в порядке документа и переводит операторы показа текста
обратно в буквы.
"""
import io
import re
import sys
import zlib

SRC = sys.argv[1]
DST = sys.argv[2]

raw = open(SRC, 'rb').read()

# --------------------------------------------------------------- объекты

objs = {}
for m in re.finditer(rb'(\d+)\s+(\d+)\s+obj(.*?)endobj', raw, re.S):
    objs[int(m.group(1))] = m.group(3)


def stream_of(num):
    body = objs.get(num, b'')
    m = re.search(rb'stream\r?\n(.*?)\r?\nendstream', body, re.S)
    if not m:
        return b''
    data = m.group(1)
    if b'/FlateDecode' in body:
        try:
            return zlib.decompress(data)
        except Exception:
            return b''
    return data


# ----------------------------------------------------------- карты шрифтов

def parse_cmap(data):
    """ToUnicode → {код байта: символ}."""
    out = {}
    txt = data.decode('latin-1', errors='replace')

    for block in re.findall(r'beginbfchar(.*?)endbfchar', txt, re.S):
        for src, dst in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', block):
            code = int(src, 16)
            out[code] = ''.join(
                chr(int(dst[i:i + 4], 16)) for i in range(0, len(dst), 4)
            )

    for block in re.findall(r'beginbfrange(.*?)endbfrange', txt, re.S):
        for lo, hi, dst in re.findall(
            r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', block
        ):
            a, b, base = int(lo, 16), int(hi, 16), int(dst, 16)
            for k in range(a, b + 1):
                out[k] = chr(base + (k - a))
    return out


fonts = {}          # номер объекта шрифта → карта
for num, body in objs.items():
    if b'/Type/Font' not in body and b'/Type /Font' not in body:
        continue
    m = re.search(rb'/ToUnicode\s+(\d+)\s+0\s+R', body)
    fonts[num] = parse_cmap(stream_of(int(m.group(1)))) if m else {}

# ------------------------------------------------------------- страницы

pages = []
for num, body in objs.items():
    if b'/Type/Page' in body and b'/Type/Pages' not in body:
        pages.append((num, body))


def refs(body, key):
    m = re.search(key + rb'\s*\[([^\]]*)\]', body)
    if m:
        return [int(x) for x in re.findall(rb'(\d+)\s+0\s+R', m.group(1))]
    m = re.search(key + rb'\s+(\d+)\s+0\s+R', body)
    return [int(m.group(1))] if m else []


def font_map_for(page_body):
    """Имя шрифта на странице (/TT2) → карта символов."""
    res = refs(page_body, rb'/Resources')
    res_body = objs.get(res[0], b'') if res else page_body
    out = {}
    m = re.search(rb'/Font\s*<<(.*?)>>', res_body, re.S)
    if m:
        for name, num in re.findall(rb'/(\w+)\s+(\d+)\s+0\s+R', m.group(1)):
            out[name.decode()] = fonts.get(int(num), {})
    return out


STR = re.compile(rb'\((?:\\.|[^()\\])*\)', re.S)


def unescape(s):
    """PDF-строка → байты."""
    s = s[1:-1]
    out = bytearray()
    i = 0
    while i < len(s):
        c = s[i]
        if c == 0x5C and i + 1 < len(s):          # обратный слэш
            n = s[i + 1]
            simple = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}
            if n in simple:
                out.append(simple[n]); i += 2; continue
            if 0x30 <= n <= 0x37:                  # восьмеричный код
                j = i + 1
                digits = ''
                while j < len(s) and len(digits) < 3 and 0x30 <= s[j] <= 0x37:
                    digits += chr(s[j]); j += 1
                out.append(int(digits, 8) & 0xFF); i = j; continue
            out.append(n); i += 2; continue
        out.append(c); i += 1
    return bytes(out)


def decode_page(page_body):
    maps = font_map_for(page_body)
    content = b''.join(stream_of(n) for n in refs(page_body, rb'/Contents'))
    cur = {}
    pieces = []

    # Разбираем по токенам: смена шрифта, показ текста, перевод строки.
    token = re.compile(
        rb'/(\w+)\s+[\d.]+\s+Tf'          # 1: шрифт
        rb'|\[(.*?)\]\s*TJ'               # 2: массив со сдвигами
        rb'|(\((?:\\.|[^()\\])*\))\s*Tj'  # 3: одиночная строка
        rb'|(T\*|Td|TD|ET)',              # 4: перенос
        re.S
    )
    for m in token.finditer(content):
        if m.group(1):
            cur = maps.get(m.group(1).decode(), {})
        elif m.group(2) is not None:
            buf = []
            for s in STR.finditer(m.group(2)):
                buf.append(''.join(cur.get(b, '') for b in unescape(s.group(0))))
            pieces.append(''.join(buf))
        elif m.group(3) is not None:
            pieces.append(''.join(cur.get(b, '') for b in unescape(m.group(3))))
        else:
            pieces.append('\n')

    text = ''.join(pieces)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{2,}', '\n', text)
    return '\n'.join(l.strip() for l in text.split('\n') if l.strip())


out = []
for i, (num, body) in enumerate(pages, 1):
    out.append(f'\n=== СТРАНИЦА {i} (объект {num}) ===')
    out.append(decode_page(body))

io.open(DST, 'w', encoding='utf-8').write('\n'.join(out))
print('страниц:', len(pages), '| символов:', sum(len(x) for x in out))
