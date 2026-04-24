/**
 * @file public/js/register-page.js
 * @description 注册页脚本。
 * 实现：国内/海外注册模式切换、图形验证码刷新、邮箱/短信验证码发送。
 * DEBUG：若验证码流程异常，优先检查 /api/captcha、/api/send-email-code、/api/send-phone-code 返回体。
 */

  function getCountryType() {
    const checked = document.querySelector('input[name="countryType"]:checked');
    return checked ? checked.value : 'domestic';
  }

  function syncCountryCards(countryType) {
    const domesticCard = document.getElementById('domesticCard');
    const internationalCard = document.getElementById('internationalCard');
    domesticCard.classList.toggle('active', countryType === 'domestic');
    internationalCard.classList.toggle('active', countryType === 'international');
  }

  function handleCountryChange() {
    const countryType = getCountryType();
    const phoneBlock = document.getElementById('phoneBlock');
    const emailBlock = document.getElementById('emailBlock');
    const emailToggle = document.getElementById('showEmailToggle');
    const emailToggleWrap = document.getElementById('emailToggleWrap');
    const numberAuthHint = document.getElementById('numberAuthHint');

    syncCountryCards(countryType);

    if (countryType === 'domestic') {
      phoneBlock.style.display = 'block';
      emailToggleWrap.style.display = 'block';
      emailBlock.style.display = emailToggle.checked ? 'block' : 'none';
      numberAuthHint.style.display = 'block';
    } else {
      phoneBlock.style.display = 'none';
      emailBlock.style.display = 'block';
      emailToggle.checked = true;
      emailToggleWrap.style.display = 'none';
      numberAuthHint.style.display = 'none';
    }
  }

  function toggleEmailBlock() {
    const countryType = getCountryType();
    const emailBlock = document.getElementById('emailBlock');
    const emailToggle = document.getElementById('showEmailToggle');
    if (countryType === 'domestic') {
      emailBlock.style.display = emailToggle.checked ? 'block' : 'none';
    }
  }
  function showCaptchaHint(message) {
    const hint = document.getElementById('captchaHint');
    if (hint) {
      hint.textContent = message;
    }
  }

  async function refreshCaptcha(message) {
    const captchaIdInput = document.querySelector('input[name="captchaId"]');
    const captchaTextInput = document.getElementById('captchaText');
    const previousCaptchaId = captchaIdInput.value;
    const res = await fetch('/api/captcha?previousCaptchaId=' + encodeURIComponent(previousCaptchaId));
    const data = await res.json();
    captchaIdInput.value = data.captchaId;
    document.getElementById('captchaImage').src = data.imageUrl + '?t=' + Date.now();
    captchaTextInput.value = '';
    showCaptchaHint(message || '图形验证码已刷新，请输入新的验证码。');
    captchaTextInput.focus();
  }

  function applyCaptchaRefreshFromResponse(data, fallbackMessage) {
    if (!data || !data.nextCaptchaId || !data.nextCaptchaImageUrl) {
      return;
    }
    document.querySelector('input[name="captchaId"]').value = data.nextCaptchaId;
    document.getElementById('captchaImage').src = data.nextCaptchaImageUrl + '?t=' + Date.now();
    const captchaTextInput = document.getElementById('captchaText');
    captchaTextInput.value = '';
    showCaptchaHint(data.message || fallbackMessage || '图形验证码已刷新，请输入新的验证码。');
    captchaTextInput.focus();
  }

  async function sendEmailCode() {
    const email = document.getElementById('email').value.trim();
    const captchaId = document.querySelector('input[name="captchaId"]').value;
    const captchaText = document.getElementById('captchaText').value.trim();
    if (!email) {
      alert('先填邮箱');
      return;
    }
    if (!captchaId || !captchaText) {
      alert('先填图形验证码');
      return;
    }

    const res = await fetch('/api/send-email-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, countryType: getCountryType(), captchaId, captchaText })
    });
    const data = await res.json();
    applyCaptchaRefreshFromResponse(data, '邮箱验证码处理完成，请输入新的图形验证码。');
    alert(data.message || '已发送');
  }

  async function sendPhoneCode() {
    const phone = document.getElementById('phone').value.trim();
    const captchaId = document.querySelector('input[name="captchaId"]').value;
    const captchaText = document.querySelector('input[name="captchaText"]').value.trim();
    if (!phone || !captchaId || !captchaText) {
      alert('先填手机号和图形验证码');
      return;
    }

    const res = await fetch('/api/send-phone-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, captchaId, captchaText })
    });
    const data = await res.json();
    applyCaptchaRefreshFromResponse(data, '短信验证码处理完成，请输入新的图形验证码。');
    alert(data.message || '已发送');
  }

  handleCountryChange();
