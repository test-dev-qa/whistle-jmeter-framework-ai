'use strict';

const { test, assertEqual } = require('./harness');
const generalNotify = require('../lib/generalNotify');

test('generalNotify / normalize fields', () => {
  const cfg = generalNotify.normalize({
    webhookEnabled: true,
    webhookUrl: ' https://hook.example/x ',
    webhookFormat: 'LARK',
    emailEnabled: true,
    emailHookUrl: 'http://mail.example/y',
    email: 'ops@example.com'
  });
  assertEqual(cfg.webhookEnabled, true);
  assertEqual(cfg.webhookUrl, 'https://hook.example/x');
  assertEqual(cfg.webhookFormat, 'feishu');
  assertEqual(cfg.emailHookUrl, 'http://mail.example/y');
  assertEqual(cfg.notifyEmail, 'ops@example.com');
});

test('generalNotify / resolveForThreshold merges toggles', () => {
  generalNotify.save({
    webhookEnabled: true,
    webhookUrl: 'https://hook.example/x',
    webhookFormat: 'json',
    emailEnabled: false,
    emailHookUrl: '',
    notifyEmail: ''
  });
  const merged = generalNotify.resolveForThreshold({ webhookOnFail: false, webhookOnPass: true });
  assertEqual(merged.webhookUrl, 'https://hook.example/x');
  assertEqual(merged.webhookFormat, 'json');
  assertEqual(merged.webhookOnFail, false);
  assertEqual(merged.webhookOnPass, true);
});
