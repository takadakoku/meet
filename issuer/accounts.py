"""主催者アカウント（ID・表示名・パスワードハッシュ）の読み書き。

- 保存先: ${CONFIG}/issuer/users.json（Webルート外、パーミッション 600）
- パスワードは scrypt（標準ライブラリ hashlib.scrypt）でハッシュ化して保存する。平文は保存しない。
- 会議の情報は扱わない。
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 15, 8, 1
SCRYPT_MAXMEM = 64 * 1024 * 1024
USER_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
MIN_PASSWORD_LEN = 12


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
                        maxmem=SCRYPT_MAXMEM, dklen=32)
    return "scrypt${}${}${}${}${}".format(SCRYPT_N, SCRYPT_R, SCRYPT_P,
                                          base64.b64encode(salt).decode(), base64.b64encode(dk).decode())


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_b64, dk_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64), n=int(n), r=int(r), p=int(p),
                            maxmem=SCRYPT_MAXMEM, dklen=32)
        return hmac.compare_digest(dk, base64.b64decode(dk_b64))
    except (ValueError, TypeError):
        return False


# ユーザーが存在しない場合も同じ計算時間をかけ、IDの存在を応答時間から推測されにくくする
_DUMMY_HASH = hash_password(secrets.token_hex(16))


def check_login(users: dict, user_id: str, password: str) -> bool:
    user = users.get(user_id)
    if user is None:
        verify_password(password, _DUMMY_HASH)
        return False
    return verify_password(password, user["hash"])


def load(path: str) -> dict:
    """{user_id: {"name": 表示名, "hash": ...}} を返す。ファイルが無ければ空。"""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    return data.get("users", {})


def save(path: str, users: dict) -> None:
    d = os.path.dirname(path)
    os.makedirs(d, mode=0o700, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".users.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"users": users}, f, ensure_ascii=False, indent=2)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise
