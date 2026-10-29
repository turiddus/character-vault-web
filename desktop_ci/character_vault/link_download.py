"""Videos from a link (7.3): queue, download, hand-off to the importer/Codex and phone status.

Flow: a link pasted on the desktop, dropped on the window, or sent from the phone (Drive edit
``download_url``) becomes a row in ``link_downloads``. The editing PC downloads it with the private
yt-dlp (``character_vault.ytdlp_job`` in its own process), moves the file into the library,
imports it and queues it for Codex with high priority; the phone index is then republished.
A read-only PC (follower) forwards the link to the editing PC through the same Drive edits folder
the phone uses. The phone follows progress through a small status file (cv_links_v1.json.gz).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from character_vault.ytdlp_job import extract_url

STATUS_NAME = "cv_links_v1.json.gz"
ACTIVE = ("queued", "downloading", "importing")
QUALITIES = ("max", "2160p", "1440p", "1080p", "720p")
FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)
FRIENDLY = {
    "unsupported": "This site or page has no downloadable video.",
    "unavailable": "The video is private, removed or not available in this country.",
    "auth": "The site requires a login: open the video once in your browser while signed in (Firefox or Edge), then retry.",
    "live": "Live streams cannot be downloaded while they are on air.",
    "network": "Network problem: it will be retried.",
    "ffmpeg": "FFmpeg is missing or failed to join video and audio.",
    "extractor": "The site changed: yt-dlp was updated automatically; retry if it still fails.",
    "too_big": "The video is larger than the configured limit.",
    "bad_link": "No http/https link found in the text.",
    "missing": "The downloader is not installed yet.",
    "disk": "Not enough free disk space.",
    "cancelled": "Canceled.",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_job_id() -> str:
    return "L" + time.strftime("%Y%m%d%H%M%S") + uuid.uuid4().hex[:6]


def clean_url(value: str) -> str:
    return extract_url(value)[:2000]


class LinkStore:
    """Rows of the ``link_downloads`` table (created by DatabaseManager)."""

    def __init__(self, db):
        self.db = db

    def add(self, url: str, source: str = "desktop", quality: str = "max", job_id: str = "",
            remix: bool = False) -> dict | None:
        """New job, or None when the same link is already waiting/downloading (or the ID was seen)."""
        url = url.strip()[:2000] if source == "cineremix" else clean_url(url)
        quality = quality if quality in QUALITIES else "max"
        job_id = (job_id or new_job_id())[:40]
        if self.db.scalar("SELECT 1 FROM link_downloads WHERE job_id=?", (job_id,)):
            return None
        if self.db.scalar(f"SELECT 1 FROM link_downloads WHERE url=? AND state IN ({','.join('?' * len(ACTIVE))})",
                          (url, *ACTIVE)):
            return None
        now = utc_now()
        self.db.execute("INSERT INTO link_downloads(job_id, url, source, quality, state, progress, message, "
                        "requested_at, updated_at, remix) VALUES (?,?,?,?,'queued',0,'Waiting',?,?,?)",
                        (job_id, url, source[:20], quality, now, now, 1 if remix else 0))
        return self.get(job_id)

    def get(self, job_id: str) -> dict | None:
        row = self.db.one("SELECT * FROM link_downloads WHERE job_id=?", (job_id,))
        if row:
            row = dict(row)
            try:
                row["files"] = json.loads(row.get("files_json") or "[]")
            except ValueError:
                row["files"] = []
        return row

    def list(self, limit: int = 60) -> list[dict]:
        rows = self.db.query("SELECT job_id FROM link_downloads ORDER BY requested_at DESC, rowid DESC LIMIT ?",
                             (int(limit),))
        return [self.get(r["job_id"]) for r in rows]

    def next_queued(self) -> dict | None:
        row = self.db.one("SELECT job_id FROM link_downloads WHERE state='queued' ORDER BY requested_at, rowid LIMIT 1")
        return self.get(row["job_id"]) if row else None

    def update(self, job_id: str, **fields) -> None:
        if "files" in fields:
            fields["files_json"] = json.dumps(fields.pop("files"), ensure_ascii=False)
        fields["updated_at"] = utc_now()
        if fields.get("state") in ("done", "failed", "cancelled"):
            fields.setdefault("finished_at", fields["updated_at"])
        sets = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE link_downloads SET {sets} WHERE job_id=?", (*fields.values(), job_id))

    def retry(self, job_id: str) -> bool:
        row = self.get(job_id)
        if not row or row["state"] not in ("failed", "cancelled"):
            return False
        self.update(job_id, state="queued", progress=0, message="Waiting", error_kind="", finished_at="",
                    attempts=int(row.get("attempts") or 0) + 1)
        return True

    def cancel(self, job_id: str) -> bool:
        row = self.get(job_id)
        if not row or row["state"] not in ("queued", "downloading"):
            return False
        self.update(job_id, state="cancelled", message=FRIENDLY["cancelled"], error_kind="cancelled")
        return True

    def remove_finished(self) -> int:
        return self.db.execute("DELETE FROM link_downloads WHERE state IN ('done','failed','cancelled')")

    def recover(self) -> int:
        """After a crash or restart: interrupted downloads start again from the queue."""
        return self.db.execute("UPDATE link_downloads SET state='queued', progress=0, message='Waiting (restarted)' "
                               "WHERE state='downloading'")

    def pending_count(self) -> int:
        return int(self.db.scalar("SELECT COUNT(*) FROM link_downloads WHERE state IN ('queued','downloading')", (), 0))

    def by_sha(self) -> dict[str, str]:
        """sha256 → job_id for files downloaded but not yet linked to a catalog record."""
        found = {}
        for row in self.db.query("SELECT job_id, files_json FROM link_downloads WHERE state='importing'"):
            try:
                for item in json.loads(row["files_json"] or "[]"):
                    if item.get("sha256") and not item.get("image_id"):
                        found[item["sha256"]] = row["job_id"]
            except ValueError:
                continue
        return found

    # ------------------------------------------------------------------ after the import
    def link_imported(self, find_by_sha: Callable[[str], list], codex: Callable[[list[str]], Any] | None = None,
                      describe: Callable[[str, dict, dict], None] | None = None) -> list[str]:
        """Attach catalog records to 'importing' jobs; returns the image IDs that were queued for Codex."""
        queued: list[str] = []
        for row in self.db.query("SELECT job_id FROM link_downloads WHERE state='importing'"):
            job = self.get(row["job_id"])
            files, changed, missing = job["files"], False, 0
            for item in files:
                if item.get("image_id"):
                    continue
                found = find_by_sha(item.get("sha256", "")) if item.get("sha256") else []
                if found:
                    item["image_id"] = found[0]["image_id"]
                    changed = True
                    if describe:
                        describe(item["image_id"], item, job)
                else:
                    missing += 1
            if not changed and missing:
                continue
            ids = [f["image_id"] for f in files if f.get("image_id")]
            if missing:
                self.update(job["job_id"], files=files, image_ids=",".join(ids))
                continue
            if codex and ids:
                codex(ids)
                queued.extend(ids)
            self.update(job["job_id"], files=files, image_ids=",".join(ids),
                        state="analyzing" if ids else "done", progress=1.0,
                        message="Analyzing with Codex" if ids else "Already in the catalog")
        return queued

    def refresh_analysis(self) -> int:
        """'analyzing' → 'done' once Codex has finished every record of the job."""
        done = 0
        for row in self.db.query("SELECT job_id, image_ids FROM link_downloads WHERE state='analyzing'"):
            ids = [i for i in (row["image_ids"] or "").split(",") if i]
            if not ids:
                continue
            marks = ",".join("?" * len(ids))
            pending = self.db.scalar(f"SELECT COUNT(*) FROM images WHERE image_id IN ({marks}) "
                                     "AND analysis_status NOT IN ('done','failed')", ids, 0)
            if not pending:
                failed = self.db.scalar(f"SELECT COUNT(*) FROM images WHERE image_id IN ({marks}) "
                                        "AND analysis_status='failed'", ids, 0)
                self.update(row["job_id"], state="done",
                            message="Ready in the gallery" + (" (Codex analysis failed; retry from Import)" if failed else ""))
                done += 1
        return done

    def marker(self) -> str:
        return str(self.db.one("SELECT COUNT(*) AS n, COALESCE(MAX(updated_at),'') AS t FROM link_downloads") or "")

    def phone_payload(self, limit: int = 30) -> dict:
        jobs = []
        for job in self.list(limit):
            jobs.append({"id": job["job_id"], "url": job["url"], "src": job["source"], "st": job["state"],
                         "p": round(float(job["progress"] or 0), 3), "m": (job["message"] or "")[:200],
                         "t": (job["title"] or "")[:200], "e": job["error_kind"] or "",
                         "img": [f["image_id"] for f in job["files"] if f.get("image_id")],
                         "at": job["requested_at"], "up": job["updated_at"]})
        return {"schema": 1, "updated_at": int(time.time()), "jobs": jobs}


# ---------------------------------------------------------------------------------------- download

def _free_target(folder: Path, name: str) -> Path:
    target = folder / name
    stem, suffix, n = target.stem, target.suffix, 2
    while target.exists() or target.with_name(target.name + ".part").exists():
        target = folder / f"{stem}_{n}{suffix}"
        n += 1
    return target


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class LinkRunner:
    """Runs one job: worker process → files moved into the library. No Qt, no catalog writes."""

    def __init__(self, addon, work_root: Path, destination: Path, ffmpeg: str = "", cookie_files=(),
                 project_root: Path | None = None, min_free_bytes: int = 2 << 30, max_bytes: int = 0):
        self.addon = addon
        self.work_root = Path(work_root)
        self.destination = Path(destination)
        self.ffmpeg = ffmpeg
        self.cookie_files = [str(p) for p in cookie_files]
        self.project_root = Path(project_root or Path(__file__).resolve().parents[1])
        self.min_free_bytes = min_free_bytes
        self.max_bytes = max_bytes
        self._proc: subprocess.Popen | None = None
        self._cancel = threading.Event()

    def cancel(self) -> None:
        self._cancel.set()
        proc = self._proc
        if proc and proc.poll() is None:
            try:
                proc.kill()
            except OSError:
                pass

    def _spawn(self, job: dict, work: Path, emit: Callable[[str, dict], None]) -> dict:
        info = self.addon.acquire()
        try:
            spec = {"url": job["url"], "work_dir": str(work), "quality": job.get("quality") or "max",
                    "ffmpeg": self.ffmpeg, "cookie_files": self.cookie_files, "max_bytes": self.max_bytes}
            proc = subprocess.Popen(self.addon.worker_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
                                    env=self.addon.worker_env(info), cwd=str(self.project_root), creationflags=FLAGS)
            self._proc = proc
            stderr: list[str] = []

            def drain():
                for line in proc.stderr:
                    stderr.append(line)
                    del stderr[:-30]
            reader = threading.Thread(target=drain, daemon=True)
            reader.start()
            proc.stdin.write(json.dumps(spec))
            proc.stdin.close()
            result: dict = {"files": [], "error": None}
            for line in proc.stdout:
                if not line.startswith("CVJ "):
                    continue
                try:
                    event = json.loads(line[4:])
                except ValueError:
                    continue
                kind = event.get("ev")
                if kind == "file":
                    result["files"].append(event)
                elif kind == "error":
                    result["error"] = event
                elif kind == "done":
                    result["done"] = event
                emit(kind, event)
            proc.wait()
            reader.join(2)
            if self._cancel.is_set():
                result["error"] = {"kind": "cancelled", "msg": FRIENDLY["cancelled"]}
            elif proc.returncode not in (0, 2, 3) and not result["error"]:
                result["error"] = {"kind": "other", "msg": ("".join(stderr) or f"exit code {proc.returncode}")[-800:]}
            return result
        finally:
            self._proc = None
            self.addon.release()

    def run(self, job: dict, emit: Callable[[str, dict], None], updater: Callable[[], dict] | None = None) -> dict:
        """Returns {"files": [{path, sha256, title, …}]} or {"error": {kind, msg}}."""
        self._cancel.clear()
        work = self.work_root / job["job_id"]
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True, exist_ok=True)
        try:
            try:
                free = shutil.disk_usage(work).free
            except OSError:
                free = self.min_free_bytes
            if free < self.min_free_bytes:
                return {"error": {"kind": "disk", "msg": f"{FRIENDLY['disk']} ({free / 1073741824:.1f} GB free)"}}
            result = self._spawn(job, work, emit)
            error = result.get("error")
            if error and error.get("kind") in ("extractor", "missing", "other") and updater and not self._cancel.is_set():
                emit("progress", {"f": 0, "msg": "Updating yt-dlp and retrying…"})
                try:
                    update = updater()
                except Exception as exc:
                    update = {"error": str(exc)}
                if update.get("updated") or update.get("installed"):
                    shutil.rmtree(work, ignore_errors=True)
                    work.mkdir(parents=True, exist_ok=True)
                    result = self._spawn(job, work, emit)
                    error = result.get("error")
            if error and not result["files"]:
                return {"error": error}
            moved = []
            folder = self.destination / datetime.now().strftime("%Y-%m")
            folder.mkdir(parents=True, exist_ok=True)
            for item in result["files"]:
                source = Path(item["path"])
                if not source.is_file():
                    continue
                target = _free_target(folder, source.name)
                shutil.move(str(source), str(target))
                moved.append({"path": str(target), "sha256": sha256_file(target), "title": item.get("title", ""),
                              "url": item.get("url", ""), "uploader": item.get("uploader", ""),
                              "duration": item.get("duration"), "extractor": item.get("extractor", ""),
                              "size": target.stat().st_size})
            if not moved:
                return {"error": error or {"kind": "unsupported", "msg": FRIENDLY["unsupported"]}}
            return {"files": moved, "warning": (error or {}).get("msg", "")}
        finally:
            shutil.rmtree(work, ignore_errors=True)


def friendly(kind: str, detail: str = "") -> str:
    base = FRIENDLY.get(kind or "", "")
    detail = (detail or "").replace("ERROR: ", "").strip()
    if not base:
        return detail[:300] or "Download failed."
    return base if kind in ("cancelled", "disk", "missing", "bad_link", "live") else f"{base} ({detail[:160]})" if detail else base


# ---------------------------------------------------------------------------------------- Drive

class LinkStatusPublisher:
    """Small gzip JSON in the archive's web folder, read by the phone while links are in progress."""

    def __init__(self):
        self.file_id = ""
        self.web_id = ""
        self.digest = ""
        self.last = 0.0

    def publish(self, client, web_id: str, payload: dict, force: bool = False) -> str:
        body = json.dumps(payload["jobs"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        digest = hashlib.sha256(body).hexdigest()
        if web_id == self.web_id and digest == self.digest and not force and time.time() - self.last < 300:
            return "unchanged"
        if web_id != self.web_id:
            self.file_id = ""
        if not self.file_id:
            found = client.children(web_id, STATUS_NAME, folders=False)
            self.file_id = found[0]["id"] if found else ""
        blob = gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        record = client.upload_bytes(blob, web_id, STATUS_NAME, self.file_id, mime="application/gzip")
        self.file_id = record["id"]
        self.web_id, self.digest, self.last = web_id, digest, time.time()
        return "published"


def forward_to_writer(web_publisher, url: str, quality: str = "max") -> str:
    """Read-only PC: hand the link to the editing PC exactly like the phone does (Drive edits folder)."""
    url = clean_url(url)
    job_id = new_job_id()
    folders = web_publisher._web_folders()
    op = [{"op": "download_url", "url": url, "id": job_id, "quality": quality, "src": "follower",
           "at": time.time()}]
    name = f"{int(time.time())}_{uuid.uuid4().hex[:6]}.json"
    web_publisher.client.upload_bytes(json.dumps(op).encode("utf-8"), folders["modifiche"], name,
                                      mime="application/json")
    return job_id


def describe_record(db, image_id: str, item: dict, job: dict) -> None:
    """Keep where the video came from in the record notes (only when the notes are still empty)."""
    row = db.one("SELECT notes FROM images WHERE image_id=?", (image_id,))
    if not row or (row["notes"] or "").strip():
        return
    if item.get("cineremix"):
        lines = ["Created with CineRemix (imported automatically)."]
        if item.get("url"):
            lines.append(f"YouTube: {item['url']}")
        db.update_image_fields(image_id, notes="\n".join(lines)[:4000])
        return
    lines = [f"Downloaded from: {item.get('url') or job['url']}"]
    if item.get("title"):
        lines.append(f"Original title: {item['title']}")
    if item.get("uploader"):
        lines.append(f"Uploader: {item['uploader']}")
    db.update_image_fields(image_id, notes="\n".join(lines)[:4000])


def cookie_files(base_dir: Path, data_dir: Path) -> list[Path]:
    """Netscape cookie files the user may place (never created by the application)."""
    found = [Path(base_dir) / "youtube_cookies.txt", Path(base_dir) / "cookies.txt"]
    folder = Path(data_dir) / "cookies"
    if folder.is_dir():
        found += sorted(folder.glob("*.txt"))
    return [p for p in found if p.is_file()]


def default_destination(db, base_dir: Path) -> Path:
    """Where downloads land before the import. Must be OUTSIDE Library and Data (the importer skips those):
    the importer then makes its verified library copy and the downloaded duplicate is removed."""
    custom = (db.get_setting("links_folder", "") or "").strip()
    return Path(custom) if custom else Path(base_dir) / "Downloads"


def valid_destination(folder: Path, library_dir: Path, data_dir: Path) -> bool:
    folder = Path(folder).resolve()
    for protected in (Path(library_dir).resolve(), Path(data_dir).resolve()):
        if folder == protected or protected in folder.parents:
            return False
    return True


def adopt_library_copy(db, image_id: str, item: dict) -> None:
    """After the import: point the job at the catalog file and drop the downloaded duplicate."""
    row = db.one("SELECT file_path, sha256 FROM images WHERE image_id=?", (image_id,))
    if not row or not row["file_path"]:
        return
    record, downloaded = Path(row["file_path"]), Path(item.get("path") or "")
    if item.get("cineremix") or not downloaded.is_file() or record == downloaded or not record.is_file():
        return
    if row["sha256"] and row["sha256"] == item.get("sha256"):
        try:
            downloaded.unlink()
            item["path"] = str(record)
        except OSError:
            pass

