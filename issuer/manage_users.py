"""主催者アカウント管理 CLI（scripts/host-user.sh から呼ぶ）。

usage: manage_users.py <users.json> add <id> --name <表示名>
       manage_users.py <users.json> passwd <id>
       manage_users.py <users.json> del <id>
       manage_users.py <users.json> list
パスワードは端末なら非表示入力（2回）、パイプなら標準入力の1行目から読む。表示・ログ出力はしない。
"""
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accounts  # noqa: E402


def read_password() -> str:
    if sys.stdin.isatty():
        p1 = getpass.getpass("パスワード: ")
        p2 = getpass.getpass("パスワード（確認）: ")
        if p1 != p2:
            sys.exit("ERROR: パスワードが一致しません。")
    else:
        p1 = sys.stdin.readline().rstrip("\n")
    if len(p1) < accounts.MIN_PASSWORD_LEN:
        sys.exit(f"ERROR: パスワードは {accounts.MIN_PASSWORD_LEN} 文字以上にしてください。")
    return p1


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    path, cmd, args = sys.argv[1], sys.argv[2], sys.argv[3:]
    users = accounts.load(path)
    if cmd == "list":
        if not users:
            print("（アカウントなし）")
        for uid, u in sorted(users.items()):
            print(f"{uid}\t{u['name']}")
        return
    if not args:
        sys.exit(__doc__)
    uid = args[0]
    if cmd == "add":
        if not accounts.USER_ID_RE.match(uid):
            sys.exit("ERROR: ID は英小文字・数字・. _ - の 3〜32 文字（先頭は英小文字か数字）にしてください。")
        if uid in users:
            sys.exit(f"ERROR: {uid} は既に存在します（パスワード変更は passwd）。")
        if len(args) != 3 or args[1] != "--name" or not args[2].strip():
            sys.exit("ERROR: --name <表示名> を指定してください（会議画面に表示される名前）。")
        users[uid] = {"name": args[2].strip(), "hash": accounts.hash_password(read_password())}
        accounts.save(path, users)
        print(f"追加しました: {uid}（{users[uid]['name']}）")
    elif cmd == "passwd":
        if uid not in users:
            sys.exit(f"ERROR: {uid} は存在しません。")
        users[uid]["hash"] = accounts.hash_password(read_password())
        accounts.save(path, users)
        print(f"パスワードを変更しました: {uid}（ログイン中のセッションは無効になります）")
    elif cmd == "del":
        if users.pop(uid, None) is None:
            sys.exit(f"ERROR: {uid} は存在しません。")
        accounts.save(path, users)
        print(f"削除しました: {uid}（ログイン中のセッションも無効になります）")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
