import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from './app.service';

const RESET_PASSWORD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Reset password — Playtime Planner</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f4;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#fff;border-radius:16px;padding:32px;width:100%;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,.06)}
    h1{margin:0 0 8px;font-size:24px;color:#1f1f1f}
    p.subtitle{margin:0 0 24px;color:#666;font-size:14px;line-height:1.4}
    label{display:block;font-size:13px;color:#333;margin-bottom:6px;font-weight:500}
    input{width:100%;padding:12px 14px;border:1px solid #ddd;border-radius:10px;font-size:15px;margin-bottom:16px;background:#fafafa}
    input:focus{outline:none;border-color:#e8915b;background:#fff}
    button{width:100%;padding:14px;background:#e8915b;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer}
    button:disabled{opacity:.6;cursor:not-allowed}
    .msg{margin-top:16px;padding:12px;border-radius:8px;font-size:14px;display:none}
    .msg.ok{background:#e6f7eb;color:#1e7a3a;display:block}
    .msg.err{background:#fde7e7;color:#a01e1e;display:block}
  </style>
</head>
<body>
  <div class="card">
    <h1>Reset password</h1>
    <p class="subtitle">Enter your new password below. Once confirmed, return to the app and sign in.</p>
    <form id="form">
      <label for="password">New password</label>
      <input id="password" name="password" type="password" required minlength="6" autocomplete="new-password" />
      <label for="confirm">Confirm new password</label>
      <input id="confirm" name="confirm" type="password" required minlength="6" autocomplete="new-password" />
      <button id="submit" type="submit">Set new password</button>
    </form>
    <div id="msg" class="msg"></div>
  </div>
  <script>
    (function () {
      var params = new URLSearchParams(window.location.hash.slice(1));
      var accessToken = params.get('access_token');
      var type = params.get('type');
      var form = document.getElementById('form');
      var btn = document.getElementById('submit');
      var msg = document.getElementById('msg');

      function showError(text) { msg.className = 'msg err'; msg.textContent = text; }
      function showOk(text)    { msg.className = 'msg ok';  msg.textContent = text; }

      if (!accessToken || type !== 'recovery') {
        showError('Invalid or expired reset link. Please request a new one from the app.');
        btn.disabled = true;
        return;
      }

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        msg.className = 'msg';
        msg.textContent = '';
        var pw = document.getElementById('password').value;
        var confirm = document.getElementById('confirm').value;
        if (pw !== confirm) { showError('Passwords do not match.'); return; }
        if (pw.length < 6) { showError('Password must be at least 6 characters.'); return; }
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
          var res = await fetch('/auth/update-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: accessToken, newPassword: pw }),
          });
          if (res.ok) {
            form.style.display = 'none';
            showOk('Password updated. You can close this window and sign in on the app with your new password.');
          } else {
            var body = await res.json().catch(function(){ return {}; });
            showError(body.message || 'Failed to update password. The link may have expired.');
            btn.disabled = false;
            btn.textContent = 'Set new password';
          }
        } catch (err) {
          showError('Network error. Please try again.');
          btn.disabled = false;
          btn.textContent = 'Set new password';
        }
      });
    })();
  </script>
</body>
</html>`;

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('reset-password')
  @Header('Content-Type', 'text/html; charset=utf-8')
  resetPasswordPage(): string {
    return RESET_PASSWORD_HTML;
  }
}
