#!/usr/bin/env python3
"""Static checks on dist/. Run after build.py; CI blocks deployment on failure.

Standard library only. Verifies internal links and anchors, image alt text,
page metadata and heading structure, and scans the output for secrets.
"""
from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

DIST = Path(__file__).resolve().parent.parent / "dist"
SECRET_PATTERNS = [
    r"sk-[A-Za-z0-9_-]{20,}",
    r"gh[pousr]_[A-Za-z0-9]{30,}",
    r"AKIA[0-9A-Z]{16}",
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    r"(?i)(api[_-]?key|secret|password)\s*[=:]\s*['\"][^'\"]{8,}",
]


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.refs: list[str] = []
        self.imgs_without_alt = 0
        self.h1 = 0
        self.title = ""
        self.has_description = False
        self.unsafe_blank = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list) -> None:
        a = dict(attrs)
        if "id" in a:
            self.ids.append(a["id"])
        for key in ("href", "src", "poster"):
            if a.get(key) and tag != "link" or (tag == "link" and a.get("rel") in ("stylesheet", "icon", "preload")and a.get(key)):
                self.refs.append(a[key])
        if tag == "img" and "alt" not in a:
            self.imgs_without_alt += 1
        if tag == "h1":
            self.h1 += 1
        if tag == "title":
            self._in_title = True
        if tag == "meta" and a.get("name") == "description" and a.get("content"):
            self.has_description = True
        if tag == "a" and a.get("target") == "_blank" and "noopener" not in (a.get("rel") or ""):
            self.unsafe_blank += 1

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False


def resolve(ref_path: str, page: Path) -> Path:
    path = unquote(ref_path)
    target = DIST / path.lstrip("/") if path.startswith("/") else page.parent / path
    return target / "index.html" if path.endswith("/") or target.is_dir() else target


def main() -> int:
    errors: list[str] = []
    pages = {path: Page() for path in DIST.rglob("*.html")}
    for path, parser in pages.items():
        parser.feed(path.read_text(encoding="utf-8"))

    external: set[str] = set()
    for path, parser in pages.items():
        rel = path.relative_to(DIST)
        if parser.h1 != 1:
            errors.append(f"{rel}: expected one <h1>, found {parser.h1}")
        if not parser.title.strip():
            errors.append(f"{rel}: missing <title>")
        if not parser.has_description and path.name != "404.html":
            errors.append(f"{rel}: missing meta description")
        if parser.imgs_without_alt:
            errors.append(f"{rel}: {parser.imgs_without_alt} image(s) without alt")
        if parser.unsafe_blank:
            errors.append(f"{rel}: target=_blank without rel=noopener")
        duplicates = {i for i in parser.ids if parser.ids.count(i) > 1}
        if duplicates:
            errors.append(f"{rel}: duplicate ids {sorted(duplicates)}")

        for ref in parser.refs:
            parts = urlsplit(ref)
            if parts.scheme in ("mailto", "tel"):
                continue
            if parts.scheme:
                external.add(ref)
                continue
            target = resolve(parts.path, path) if parts.path else path
            if not target.exists():
                errors.append(f"{rel}: broken link {ref}")
            elif parts.fragment and target in pages and parts.fragment not in pages[target].ids:
                errors.append(f"{rel}: missing anchor {ref}")

    for path in DIST.rglob("*"):
        if path.suffix in {".html", ".js", ".css", ".xml", ".txt", ".svg"}:
            text = path.read_text(encoding="utf-8")
            for pattern in SECRET_PATTERNS:
                if re.search(pattern, text):
                    errors.append(f"{path.relative_to(DIST)}: possible secret matching {pattern}")

    size = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    print(f"{len(pages)} pages, {len(external)} external links, {size / 1e6:.1f} MB total")
    if "--list-external" in sys.argv:
        print("\n".join(sorted(external)))
    for error in errors:
        print(f"FAIL {error}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
