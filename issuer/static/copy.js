// コピーボタン（CSP の都合でインラインスクリプトは使わない）
document.querySelectorAll('[data-copy]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var input = document.getElementById(btn.getAttribute('data-copy'));
    var done = function () {
      var label = btn.textContent;
      btn.textContent = 'コピーしました';
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = label; btn.classList.remove('copied'); }, 2000);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
    } else {
      input.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* 選択状態のまま手動コピー */ }
    }
  });
});
