document.addEventListener('DOMContentLoaded', () => {
  const t = window.AI_ROLEPLAY_I18N?.t || ((key) => key);

  function showCaptchaHint(message) {
    const hint = document.getElementById('profileCaptchaHint');
    if (hint) {
      hint.textContent = message;
    }
  }

  function getCaptchaPayload() {
    return {
      captchaId: document.querySelector('input[name="captchaId"]')?.value || '',
      captchaText: document.getElementById('profileCaptchaText')?.value.trim() || '',
    };
  }

  function applyCaptchaRefreshFromResponse(data, fallbackMessage) {
    if (!data || !data.nextCaptchaId || !data.nextCaptchaImageUrl) {
      return;
    }
    const captchaIdInput = document.querySelector('input[name="captchaId"]');
    const captchaImage = document.getElementById('profileCaptchaImage');
    const captchaTextInput = document.getElementById('profileCaptchaText');
    if (captchaIdInput) captchaIdInput.value = data.nextCaptchaId;
    if (captchaImage) captchaImage.src = data.nextCaptchaImageUrl + '?t=' + Date.now();
    if (captchaTextInput) captchaTextInput.value = '';
    showCaptchaHint(t(data.message || fallbackMessage || '图形验证码已刷新；再次发送验证码时请输入新的图形验证码。'));
  }

  async function refreshCaptcha(message) {
    const captchaIdInput = document.querySelector('input[name="captchaId"]');
    const captchaTextInput = document.getElementById('profileCaptchaText');
    if (!captchaIdInput) return;
    const previousCaptchaId = captchaIdInput.value;
    const res = await fetch('/api/captcha?previousCaptchaId=' + encodeURIComponent(previousCaptchaId));
    const data = await res.json();
    captchaIdInput.value = data.captchaId;
    document.getElementById('profileCaptchaImage').src = data.imageUrl + '?t=' + Date.now();
    if (captchaTextInput) captchaTextInput.value = '';
    showCaptchaHint(message || t('图形验证码已刷新，请输入新的验证码。'));
    if (captchaTextInput) captchaTextInput.focus();
  }

  async function sendEmailCode() {
    const email = document.getElementById('profileEmail')?.value.trim() || '';
    const { captchaId, captchaText } = getCaptchaPayload();
    if (!email) {
      alert(t('先填邮箱'));
      return;
    }
    if (!captchaId || !captchaText) {
      alert(t('先填图形验证码'));
      return;
    }

    const res = await fetch('/api/send-email-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, countryType: 'domestic', purpose: 'profile-email', captchaId, captchaText })
    });
    const data = await res.json();
    applyCaptchaRefreshFromResponse(data, t('邮箱验证码处理完成；只有再次发送验证码时才需要填写新的图形验证码。'));
    alert(t(data.message || '已发送'));
  }

  async function sendPhoneCode() {
    const phone = document.getElementById('profilePhone')?.value.trim() || '';
    const { captchaId, captchaText } = getCaptchaPayload();
    if (!phone || !captchaId || !captchaText) {
      alert(t('先填手机号和图形验证码'));
      return;
    }

    const res = await fetch('/api/send-phone-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, purpose: 'profile-phone', captchaId, captchaText })
    });
    const data = await res.json();
    applyCaptchaRefreshFromResponse(data, t('短信验证码处理完成；只有再次发送验证码时才需要填写新的图形验证码。'));
    alert(t(data.message || '已发送'));
  }

  document.querySelector('[data-refresh-profile-captcha]')?.addEventListener('click', () => {
    refreshCaptcha(t('已刷新图形验证码，请输入新的验证码。')).catch((error) => alert(error.message || t('刷新失败')));
  });
  document.querySelector('[data-send-profile-email-code]')?.addEventListener('click', () => {
    sendEmailCode().catch((error) => alert(error.message || t('发送失败')));
  });
  document.querySelector('[data-send-profile-phone-code]')?.addEventListener('click', () => {
    sendPhoneCode().catch((error) => alert(error.message || t('发送失败')));
  });
});
