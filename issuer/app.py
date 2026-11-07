"""会議URL発行画面（主催者向け・ID/パスワードログイン）。

Jitsi の web コンテナ（nginx）から /host/ 配下だけがこのアプリへ中継される。
- 会議室名・URL・発行履歴は保存しない（予約機能ではない）。ログにも出さない。
- JWT 署名鍵は環境変数で受け取り、ブラウザへは主催者用URL（# 以降のトークン）しか渡さない。
"""
import hashlib
import hmac
import logging
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

from flask import Flask, abort, redirect, render_template, request, session
from werkzeug.middleware.proxy_fix import ProxyFix

import accounts
import meeting

PREFIX = "/host"
USERS_FILE = os.environ.get("ISSUER_USERS_FILE", "/data/users.json")
JWT_APP_ID = os.environ["JWT_APP_ID"]
JWT_APP_SECRET = os.environ["JWT_APP_SECRET"]
PUBLIC_URL = os.environ["PUBLIC_URL"]
XMPP_DOMAIN = os.environ.get("XMPP_DOMAIN") or "meet.jitsi"
SESSION_HOURS = 8
HOUR_CHOICES = [(3, "3時間"), (24, "24時間"), (72, "3日"), (168, "7日")]
DEFAULT_HOURS = 24
JST = timezone(timedelta(hours=9))

# ログイン試行制限（1プロセス内のメモリ。gunicorn は workers=1 で起動する）
FAIL_WINDOW = 15 * 60
MAX_FAILS_PER_USER = 5
MAX_FAILS_PER_IP = 20
_fails: dict[str, list[float]] = {}
_fails_lock = threading.Lock()

log = logging.getLogger("issuer")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = Flask(__name__, static_url_path=PREFIX + "/static")
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config.update(
    SECRET_KEY=os.environ["ISSUER_SESSION_SECRET"],
    SESSION_COOKIE_NAME="meet_host_session",
    SESSION_COOKIE_PATH=PREFIX + "/",
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=SESSION_HOURS),
    MAX_CONTENT_LENGTH=16 * 1024,
)


def _recent(key: str) -> list[float]:
    now = time.time()
    lst = [t for t in _fails.get(key, []) if now - t < FAIL_WINDOW]
    _fails[key] = lst
    return lst


def _locked(user_id: str, ip: str) -> bool:
    with _fails_lock:
        return len(_recent("u:" + user_id)) >= MAX_FAILS_PER_USER or len(_recent("ip:" + ip)) >= MAX_FAILS_PER_IP


def _record_fail(user_id: str, ip: str) -> None:
    with _fails_lock:
        _recent("u:" + user_id).append(time.time())
        _recent("ip:" + ip).append(time.time())


def _clear_fails(user_id: str) -> None:
    with _fails_lock:
        _fails.pop("u:" + user_id, None)


def _csrf_token() -> str:
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


def _check_csrf() -> None:
    sent = request.form.get("csrf", "")
    if not sent or not secrets.compare_digest(sent, session.get("csrf", "")):
        abort(400)


def _pw_fingerprint(stored_hash: str) -> str:
    """パスワード変更・削除でセッションを無効化するための指紋（ハッシュそのものは Cookie に入れない）"""
    return hmac.new(app.config["SECRET_KEY"].encode(), stored_hash.encode(), hashlib.sha256).hexdigest()[:32]


def _current_user():
    """ログイン中のユーザー（dict）。削除・パスワード変更されたアカウントのセッションは無効。"""
    uid = session.get("uid")
    if not uid:
        return None
    user = accounts.load(USERS_FILE).get(uid)
    if not user or not secrets.compare_digest(session.get("pw", ""), _pw_fingerprint(user["hash"])):
        session.clear()
        return None
    return {"id": uid, "name": user["name"]}


@app.after_request
def _headers(resp):
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; "
        "form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


@app.context_processor
def _ctx():
    return {"csrf": _csrf_token(), "prefix": PREFIX}


@app.get(PREFIX + "/")
def index():
    user = _current_user()
    if not user:
        return render_template("login.html")
    return render_template("index.html", user=user, hour_choices=HOUR_CHOICES, default_hours=DEFAULT_HOURS)


@app.post(PREFIX + "/login")
def login():
    _check_csrf()
    ip = request.remote_addr or "-"
    user_id = request.form.get("user_id", "").strip().lower()[:64]
    password = request.form.get("password", "")[:256]
    if _locked(user_id, ip):
        log.warning("login locked user=%s ip=%s", user_id, ip)
        return render_template("login.html", error="ログインに続けて失敗したため、15分間ログインできません。"), 429
    users = accounts.load(USERS_FILE)
    if not accounts.check_login(users, user_id, password):
        _record_fail(user_id, ip)
        log.warning("login failed user=%s ip=%s", user_id, ip)
        return render_template("login.html", error="IDまたはパスワードが正しくありません。"), 401
    _clear_fails(user_id)
    session.clear()  # セッション固定化対策
    session.permanent = True
    session["uid"] = user_id
    session["pw"] = _pw_fingerprint(users[user_id]["hash"])
    log.info("login ok user=%s ip=%s", user_id, ip)
    return redirect(PREFIX + "/", code=303)


@app.post(PREFIX + "/logout")
def logout():
    _check_csrf()
    session.clear()
    return redirect(PREFIX + "/", code=303)


@app.post(PREFIX + "/create")
def create():
    _check_csrf()
    user = _current_user()
    if not user:
        return redirect(PREFIX + "/", code=303)
    try:
        hours = int(request.form.get("hours", DEFAULT_HOURS))
    except ValueError:
        abort(400)
    if hours not in dict(HOUR_CHOICES):
        abort(400)
    room = meeting.new_room()
    token, exp = meeting.make_host_token(secret=JWT_APP_SECRET, app_id=JWT_APP_ID, xmpp_domain=XMPP_DOMAIN,
                                         room=room, host_name=user["name"], hours=hours)
    guest_url, host_url = meeting.build_urls(PUBLIC_URL, room, token)
    log.info("meeting issued user=%s", user["id"])  # 会議室名・URLは記録しない
    return render_template("created.html", user=user, guest_url=guest_url, host_url=host_url,
                           expires=datetime.fromtimestamp(exp, JST).strftime("%Y-%m-%d %H:%M"))


@app.get(PREFIX + "/healthz")
def healthz():
    return "ok"
