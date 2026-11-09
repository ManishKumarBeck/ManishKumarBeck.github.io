#!/usr/bin/env python3
"""Build the portfolio into ./dist.

    python build.py           # build
    python build.py --serve   # build, then serve on http://localhost:8000

Content lives in content/*.yaml, markup in templates/, assets in static/.
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import http.server
import shutil
from datetime import date
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).parent
CONTENT = ROOT / "content"
STATIC = ROOT / "static"
DIST = ROOT / "dist"


def load(name: str) -> dict:
    return yaml.safe_load((CONTENT / f"{name}.yaml").read_text(encoding="utf-8"))


def fingerprint(*paths: Path) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.read_bytes())
    return digest.hexdigest()[:10]


def require(item: dict, fields: tuple[str, ...], where: str) -> None:
    missing = [field for field in fields if not item.get(field)]
    if missing:
        raise SystemExit(f"{where}: missing {', '.join(missing)}")


def write_page(path: Path, html: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8", newline="\n")


def build() -> None:
    site = load("site")
    projects_file = load("projects")
    work_file = load("work")
    experience = load("experience")
    skills = load("skills")["groups"]

    projects = projects_file["projects"]
    for project in projects:
        require(project, ("slug", "name", "summary", "problem", "contribution", "tech", "features", "links"), f"project {project.get('slug')}")
    for role in experience["roles"]:
        require(role, ("company", "title"), "experience")

    base = site["base"]
    env = Environment(
        loader=FileSystemLoader(ROOT / "templates"),
        autoescape=select_autoescape(["html"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )

    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(STATIC, DIST)

    shared = {
        "site": site,
        "base": base,
        "year": date.today().year,
        "has_resume": (STATIC / "resume.pdf").exists(),
        "css_v": fingerprint(STATIC / "css" / "main.css"),
        "js_v": fingerprint(STATIC / "js" / "main.js", STATIC / "js" / "cursor.js"),
    }

    write_page(
        DIST / "index.html",
        env.get_template("index.html").render(
            **shared,
            path="",
            experience=experience,
            skills=skills,
            projects=projects,
            apps=projects_file["apps"],
            work=work_file["work"],
            more=work_file["more"],
        ),
    )

    pages = [""]
    for project in projects:
        if project.get("case_study"):
            path = f"projects/{project['slug']}/"
            pages.append(path)
            write_page(DIST / path / "index.html", env.get_template("project.html").render(**shared, path=path, p=project))

    work = work_file["work"]
    for index, item in enumerate(work):
        path = f"work/{item['slug']}/"
        pages.append(path)
        write_page(
            DIST / path / "index.html",
            env.get_template("work.html").render(
                **shared, path=path, w=item, next_item=work[(index + 1) % len(work)]
            ),
        )

    write_page(DIST / "404.html", env.get_template("404.html").render(**shared, path="404.html"))

    root_url = site["url"].rstrip("/") + base
    urls = "\n".join(f"  <url><loc>{root_url}{page}</loc></url>" for page in pages)
    write_page(
        DIST / "sitemap.xml",
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}\n</urlset>\n',
    )
    write_page(DIST / "robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {root_url}sitemap.xml\n")
    (DIST / ".nojekyll").touch()

    print(f"Built {len(pages) + 1} pages into {DIST}")


def serve(port: int) -> None:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Serving on http://localhost:{port}  (Ctrl+C to stop)")
        server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", action="store_true", help="serve dist/ after building")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    build()
    if args.serve:
        serve(args.port)
