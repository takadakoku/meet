"""会議室名と主催者用JWTの生成（発行画面と scripts/issue-meeting.sh の共通処理）。

- 標準ライブラリのみ。署名鍵は呼び出し側から受け取り、表示・ログ出力しない。
- 会議の情報（会議室名・発行者・日時）はどこにも保存しない。
"""
import base64
import hashlib
import hmac
import json
import secrets
import string
import time

ROOM_ALPHABET = string.ascii_lowercase + string.digits
ROOM_LENGTH = 20  # 約 103 bit
MIN_HOURS, MAX_HOURS = 1, 168


def new_room() -> str:
    return "".join(secrets.choice(ROOM_ALPHABET) for _ in range(ROOM_LENGTH))


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_host_token(*, secret: str, app_id: str, xmpp_domain: str, room: str,
                    host_name: str, hours: int, now: int | None = None) -> tuple[str, int]:
    """主催者（モデレーター）用 JWT（HS256）を作る。戻り値は (token, exp)。"""
    if not (MIN_HOURS <= hours <= MAX_HOURS):
        raise ValueError("hours out of range")
    if len(secret) < 32 or not app_id:
        raise ValueError("JWT settings missing")
    now = int(time.time()) if now is None else now
    exp = now + hours * 3600
    payload = {
        "aud": app_id,
        "iss": app_id,
        "sub": xmpp_domain,
        "room": room,  # この会議室でのみ有効
        "iat": now,
        "nbf": now - 60,
        "exp": exp,
        "context": {"user": {"name": host_name, "moderator": True}},
    }
    header = {"alg": "HS256", "typ": "JWT"}
    signing_input = _b64(json.dumps(header, separators=(",", ":")).encode()) + "." + \
        _b64(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode())
    sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return signing_input + "." + _b64(sig), exp


def build_urls(public_url: str, room: str, token: str) -> tuple[str, str]:
    """(ゲスト用URL, 主催者用URL) を返す。

    トークンは # 以降に置くため、ページを開く際にサーバーへ送信されない。
    Jitsi は # 以降の値を JSON として解釈するため "..."（%22）で囲む。
    """
    base = public_url.rstrip("/")
    return f"{base}/{room}", f"{base}/{room}#jwt=%22{token}%22"


def _read_env(path: str) -> dict:
    vals = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k] = v
    return vals


def main() -> None:
    """CLI: python3 -I meeting.py <envfile> <hours> <host_name>（scripts/issue-meeting.sh から呼ぶ）"""
    import sys
    from datetime import datetime, timedelta, timezone

    env_file, hours, host_name = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    env = _read_env(env_file)
    if env.get("ENABLE_AUTH") != "1" or env.get("AUTH_TYPE") != "jwt":
        sys.exit("ERROR: .env で ENABLE_AUTH=1 / AUTH_TYPE=jwt になっていません。")
    public_url = env.get("PUBLIC_URL", "")
    if not public_url:
        sys.exit("ERROR: PUBLIC_URL を .env に設定してください。")
    room = new_room()
    try:
        token, exp = make_host_token(secret=env.get("JWT_APP_SECRET", ""), app_id=env.get("JWT_APP_ID", ""),
                                     xmpp_domain=env.get("XMPP_DOMAIN") or "meet.jitsi",
                                     room=room, host_name=host_name, hours=hours)
    except ValueError as e:
        sys.exit(f"ERROR: {e}（JWT_APP_SECRET / JWT_APP_ID / --hours を確認してください）")
    guest_url, host_url = build_urls(public_url, room, token)
    jst = timezone(timedelta(hours=9))
    print(f"会議室名         : {room}")
    print(f"主催者URL有効期限: {datetime.fromtimestamp(exp, jst):%Y-%m-%d %H:%M} (JST)")
    print()
    print("■ ゲスト用URL（顧客に送る）")
    print(guest_url)
    print()
    print("■ 主催者用URL（本人のみ。顧客・チャット・メールに貼らない）")
    print(host_url)


if __name__ == "__main__":
    main()
