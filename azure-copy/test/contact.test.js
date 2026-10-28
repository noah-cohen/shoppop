import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContactMessage, InputError } from '../validation.js';

const message = { name: 'Test sender', email: 'test@example.com', phone: '', subject: 'Question', message: 'Message\nSecond line' };

test('contact messages require an email or phone and normalize only intended fields', () => {
  assert.deepEqual(validateContactMessage({ ...message, name: ' Test sender ', read: true, id: 3 }), message);
  assert.deepEqual(validateContactMessage({ ...message, email: '', phone: '050-1234567' }), { ...message, email: '', phone: '050-1234567' });
  assert.equal(validateContactMessage({ ...message, phone: '+972 (50) 1234567' }).phone, '+972 (50) 1234567');
  assert.equal(validateContactMessage({ ...message, message: '<b>Plain text</b>' }).message, '<b>Plain text</b>');
  assert.equal(validateContactMessage({ ...message, name: 'a'.repeat(150), subject: 'b'.repeat(180), message: 'c'.repeat(4000) }).message.length, 4000);
});

test('contact validation rejects missing, oversized and malformed fields', () => {
  for (const input of [null, [], 'message', 1]) assert.throws(() => validateContactMessage(input), InputError);
  for (const fields of [
    { name: '' }, { name: '   ' }, { name: 'a'.repeat(151) }, { name: {} },
    { subject: '' }, { subject: 'a'.repeat(181) }, { message: '' }, { message: 'a'.repeat(4001) },
    { email: '', phone: '' }, { email: ' ' }, { email: 'invalid' }, { email: 'a@@example.com' },
    { email: 'test@example.com\nBcc: other@example.com' }, { email: 'a'.repeat(255) },
    { phone: 'abc1234567' }, { phone: '123' }, { phone: '1'.repeat(81) }, { phone: {} },
  ]) assert.throws(() => validateContactMessage({ ...message, ...fields }), InputError, JSON.stringify(fields));
});
