"""Runs INSIDE the embedded Python (like Character Vault): add-ons, real download, CineRemix runtime."""
import functools, http.server, json, os, socketserver, sqlite3, subprocess, sys, threading, time, traceback
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / "Data"
DATA.mkdir(exist_ok=True)
R = {"python": sys.version.split()[0], "base": str(BASE)}
FAIL = []


def step(name):
    def wrap(fn):
        t = time.time()
        try:
            R[name] = fn()
        except Exception as exc:
            R[name] = {"error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()[-1500:]}
            FAIL.append(name)
        R[name + "_s"] = round(time.time() - t, 1)
        (DATA / "ci_report.json").write_text(json.dumps(R, indent=1, default=str), encoding="utf-8")
        return fn
    return wrap


from character_vault import addons                      # noqa: E402
from character_vault.link_download import LinkRunner      # noqa: E402
from character_vault.cineremix_bridge import CineRemixBridge, exports_since  # noqa: E402

addon = addons.YtDlpAddon(DATA, python=Path(sys.executable), project_root=BASE)


@step("ytdlp_old_full_install")
def _():
    return addon.install("2026.10.21")


@step("ytdlp_core_update")
def _():
    result = addon.update(force=True)
    current = addon.current()
    assert result.get("updated") and not result.get("full"), result
    assert len(current["dirs"]) == 2 and current["deno"], current
    return {**result, "dirs": [str(d) for d in current["dirs"]]}


@step("ffmpeg")
def _():
    found = addons.ensure_ffmpeg(BASE, DATA)
    assert Path(found["ffmpeg"]).is_file() and Path(found["ffprobe"]).is_file(), found
    return found


def make_media():
    www = DATA / "www"
    (www / "dash").mkdir(parents=True, exist_ok=True)
    ff = addons.find_ffmpeg(BASE)["ffmpeg"]
    # separate video and audio streams (like YouTube/Instagram high quality): yt-dlp must join them with FFmpeg
    subprocess.run([ff, "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=854x480:rate=25", "-f", "lavfi",
                    "-i", "sine=frequency=500:sample_rate=48000", "-t", "6", "-map", "0:v", "-map", "1:a", "-c:v",
                    "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-use_template", "1", "-use_timeline", "1",
                    "-f", "dash", "manifest.mpd"], check=True, creationflags=addons.FLAGS, cwd=str(www / "dash"))
    subprocess.run([ff, "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-f", "lavfi",
                    "-i", "sine=frequency=330", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    "-shortest", "clip.mp4"], check=True, creationflags=addons.FLAGS, cwd=str(www))
    (www / "page.html").write_text('<html><head><title>Clip è &amp; co</title></head><body>'
                                   '<video src="clip.mp4"></video></body></html>', encoding="utf-8")
    R["dash_files"] = sorted(p.name for p in (www / "dash").iterdir())

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(www)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


PORT = [0]


@step("download_dash_merge")
def _():
    port = PORT[0] = make_media()
    runner = LinkRunner(addon, DATA / "downloads" / "work", BASE / "Downloads",
                        ffmpeg=addons.find_ffmpeg(BASE)["ffmpeg"], project_root=BASE)
    events = []
    result = runner.run({"job_id": "Lci1", "url": f"guarda http://127.0.0.1:{port}/dash/manifest.mpd !", "quality": "max"},
                        lambda kind, ev: events.append(kind))
    assert result.get("files"), result
    file = Path(result["files"][0]["path"])
    probe = subprocess.run([addons.find_ffmpeg(BASE)["ffprobe"], "-v", "error", "-show_entries", "stream=codec_type",
                            "-of", "csv=p=0", str(file)], capture_output=True, text=True,
                           creationflags=addons.FLAGS).stdout.split()
    assert "video" in probe and "audio" in probe, probe
    return {"file": file.name, "size": file.stat().st_size, "streams": probe, "events": sorted(set(events))}


@step("download_page_with_video")
def _():
    runner = LinkRunner(addon, DATA / "downloads" / "work", BASE / "Downloads",
                        ffmpeg=addons.find_ffmpeg(BASE)["ffmpeg"], project_root=BASE)
    result = runner.run({"job_id": "Lci3", "url": f"http://127.0.0.1:{PORT[0]}/page.html", "quality": "1080p"},
                        lambda kind, ev: None)
    assert result.get("files"), result
    return {"file": Path(result["files"][0]["path"]).name, "title": result["files"][0]["title"]}


@step("download_unsupported")
def _():
    runner = LinkRunner(addon, DATA / "downloads" / "work", BASE / "Downloads", project_root=BASE)
    result = runner.run({"job_id": "Lci2", "url": "http://127.0.0.1:9/none", "quality": "max"}, lambda *a: None)
    assert result.get("error"), result
    return result["error"]["kind"]


bridge = CineRemixBridge(BASE, DATA, Path(sys.executable))


@step("cineremix_runtime")
def _():
    result = bridge.install(lambda f, m: None)
    status = bridge.status()
    assert status["installed"] and not status["outdated"], status
    return {**result, "size_mb": round(sum(f.stat().st_size for f in (BASE / "_runtime_cineremix").rglob("*")
                                           if f.is_file()) / 1048576)}


@step("cineremix_ocr_and_codecs")
def _():
    code = ("import numpy as np, cv2, av, scipy\n"
            "from rapidocr_onnxruntime import RapidOCR\n"
            "img = np.full((80, 360, 3), 255, np.uint8)\n"
            "cv2.putText(img, 'CINEREMIX', (10, 55), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (0, 0, 0), 3)\n"
            "res, _ = RapidOCR()(img)\n"
            "import json; print('CVOCR' + json.dumps({'text': [r[1] for r in (res or [])], 'av': av.__version__}))\n")
    out = subprocess.run([str(bridge.python()), "-X", "utf8", "-c", code], capture_output=True, text=True,
                         timeout=600, creationflags=addons.FLAGS)
    line = next((l for l in out.stdout.splitlines() if l.startswith("CVOCR")), "")
    assert line, out.stderr[-800:]
    data = json.loads(line[5:])
    assert any("CINEREMIX" in t.upper() for t in data["text"]), data
    return data


@step("cineremix_launch_with_files")
def _():
    marker = DATA / "stub_launch.json"
    os.environ["CV_STUB_OUT"] = str(marker)
    sample = BASE / "Downloads"
    files = ([str(p) for p in sample.rglob("*.mp4")] + [str(DATA / "www" / "clip.mp4")])[:2]
    bridge.launch(files)
    for _ in range(120):
        if marker.is_file():
            break
        time.sleep(1)
    data = json.loads(marker.read_text(encoding="utf-8"))
    assert data["sources"] == [str(Path(f).resolve()) for f in files], data
    return data


@step("cineremix_ytdlp_update")
def _():
    for _ in range(30):
        if not bridge.running():
            break
        time.sleep(1)
    return bridge.update_ytdlp(force=True)


@step("exports_watch")
def _():
    db = DATA / "catalog.sqlite3"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE exports(output TEXT PRIMARY KEY, created REAL, payload TEXT)")
    video = DATA / "www" / "clip.mp4"
    conn.execute("INSERT INTO exports VALUES (?,?,?)", (str(video), time.time(), json.dumps({"duration": 6})))
    conn.commit()
    conn.close()
    found = exports_since(time.time() - 60, db)
    assert len(found) == 1, found
    return found


@step("genesis_key_dpapi")
def _():
    from character_vault.genesis import keystore
    os.environ.pop("OPENAI_API_KEY", None)
    fake = "sk-test-" + "0123456789abcdef" * 3
    keystore.save_key(DATA, fake)
    raw = keystore.key_file(DATA).read_bytes()
    assert fake.encode() not in raw, "saved key must be encrypted"
    assert keystore.api_key(DATA) == fake and keystore.source(DATA) == "saved"
    os.environ["OPENAI_API_KEY"] = "sk-env-" + "9" * 30
    assert keystore.api_key(DATA).startswith("sk-env-")
    os.environ.pop("OPENAI_API_KEY")
    assert keystore.clear_key(DATA) and keystore.api_key(DATA) == ""
    return {"encrypted_bytes": len(raw)}


R["failed"] = FAIL
(DATA / "ci_report.json").write_text(json.dumps(R, indent=1, default=str), encoding="utf-8")
sys.exit(1 if FAIL else 0)
