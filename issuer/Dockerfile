# 会議URL発行画面（主催者向け）。Jitsi 本体とは別コンテナで動かし、web(nginx) から /host/ だけ中継する。
FROM python:3.12.8-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-deps -r requirements.txt
COPY app.py accounts.py meeting.py ./
COPY templates ./templates
COPY static ./static

# Jitsi のコンテナと同じ uid 1000 で実行（${CONFIG}/issuer/users.json を読むため）
RUN useradd --uid 1000 --no-create-home --shell /usr/sbin/nologin issuer
USER 1000
EXPOSE 8080
# ログイン試行制限をプロセス内メモリで共有するため workers=1（スレッドで並行処理）
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--worker-tmp-dir", "/tmp", "--forwarded-allow-ips", "*", "app:app"]
