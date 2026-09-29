import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  containsContactInfo,
  formatPlate,
  isValidPlate,
  normalizePlate,
  validateRating,
} from '../public/js/shared.js';

test('normalizePlate strips separators, uppercases and folds full-width characters', () => {
  assert.equal(normalizePlate(' ab-123 cd '), 'AB123CD');
  assert.equal(normalizePlate('ＡＢ１２３ＣＤ'), 'AB123CD');
  assert.equal(normalizePlate('京A·12345'), '京A12345');
  assert.equal(normalizePlate('MH 12 AB 1234'), 'MH12AB1234');
  assert.equal(normalizePlate(null), '');
});

test('isValidPlate accepts 2 to 12 letters or digits', () => {
  assert.ok(isValidPlate('AB123CD'));
  assert.ok(isValidPlate('京A12345'));
  assert.ok(!isValidPlate('A'));
  assert.ok(!isValidPlate('ABCDEFGHIJKLM'));
  assert.ok(!isValidPlate('AB-12'));
});

test('formatPlate pretty-prints known formats and leaves others alone', () => {
  assert.equal(formatPlate('ab123cd', 'FR'), 'AB-123-CD');
  assert.equal(formatPlate('1234BCD', 'ES'), '1234 BCD');
  assert.equal(formatPlate('AB12CDE', 'GB'), 'AB12 CDE');
  assert.equal(formatPlate('MH12AB1234', 'IN'), 'MH 12 AB 1234');
  assert.equal(formatPlate('京A12345', 'CN'), '京A·12345');
  assert.equal(formatPlate('7ABC123', 'US'), '7ABC123');
  assert.equal(formatPlate('AB123', 'FR'), 'AB123');
});

test('containsContactInfo flags links, emails and phone numbers only', () => {
  assert.ok(containsContactInfo('see https://example.com'));
  assert.ok(containsContactInfo('go to mysite.fr now'));
  assert.ok(containsContactInfo('mail me: a.b@c.de'));
  assert.ok(containsContactInfo('call 06 12 34 56 78'));
  assert.ok(containsContactInfo('+33612345678'));
  assert.ok(!containsContactInfo('Drove at 130 in a 90 zone on the A6'));
  assert.ok(!containsContactInfo('Merci pour le passage !'));
});

test('validateRating cleans a good submission', () => {
  const r = validateRating({
    country: 'fr',
    plate: 'ab-123-cd',
    stars: 2,
    tags: ['litter', 'litter', 'dangerous'],
    comment: '  Threw   a can  ',
    lang: 'fr',
  });
  assert.deepEqual(r, {
    ok: true,
    value: {
      country: 'FR',
      plate: 'AB123CD',
      stars: 2,
      tags: ['litter', 'dangerous'],
      comment: 'Threw a can',
      lang: 'fr',
      device: null,
    },
  });
  assert.equal(validateRating({ country: 'FR', plate: 'AB1', stars: 1, device: 'b5c3f0e2-8f7a-4d2b-9c1e-0a1b2c3d4e5f' }).value.device,
    'b5c3f0e2-8f7a-4d2b-9c1e-0a1b2c3d4e5f');
  assert.equal(validateRating({ country: 'FR', plate: 'AB1', stars: 1, device: '<script>' }).value.device, null);
});

test('validateRating rejects bad input with stable error codes', () => {
  const base = { country: 'FR', plate: 'AB123CD', stars: 3 };
  assert.equal(validateRating(null).error, 'invalid_request');
  assert.equal(validateRating({ ...base, country: 'France' }).error, 'invalid_country');
  assert.equal(validateRating({ ...base, plate: 'A' }).error, 'invalid_plate');
  assert.equal(validateRating({ ...base, stars: 0 }).error, 'invalid_stars');
  assert.equal(validateRating({ ...base, stars: 4.5 }).error, 'invalid_stars');
  assert.equal(validateRating({ ...base, stars: '5' }).error, 'invalid_stars');
  assert.equal(validateRating({ ...base, tags: ['nope'] }).error, 'invalid_tags');
  assert.equal(validateRating({ ...base, tags: 'litter' }).error, 'invalid_tags');
  assert.equal(validateRating({ ...base, comment: 'x'.repeat(201) }).error, 'comment_too_long');
  assert.equal(validateRating({ ...base, comment: 'call 0612345678' }).error, 'comment_contact');
  assert.equal(validateRating({ ...base, lang: 'french' }).value.lang, null);
});
