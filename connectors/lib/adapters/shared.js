'use strict';

/**
 * Small, dependency-free helpers shared by adapters.
 *
 * These exist so that every adapter makes the same choices about the two things
 * that are easy to get wrong:
 *   • a source's markup never becomes our text — `raw` keeps the original,
 *     the mapped `description` is plain text;
 *   • a price is carried as a decimal string with the currency the source
 *     stated, never a symbol, never a default, never a conversion.
 */

/** Strips markup and decodes the few entities that matter, without evaluating anything. */
function htmlToText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textOf(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value.trim() : String(value).trim();
}

function firstText() {
  for (let index = 0; index < arguments.length; index += 1) {
    const text = textOf(arguments[index]);
    if (text !== '') return text;
  }
  return '';
}

/**
 * A source that quotes prices in minor units ("12950" with a minor unit of 2)
 * becomes the decimal string the contract expects ("129.50"). No rounding is
 * invented: an amount that is not a whole number of minor units returns null and
 * is reported by the adapter rather than guessed at.
 */
function decimalFromMinorUnits(value, minorUnit) {
  const digits = textOf(value);
  if (digits === '') return null;
  if (!/^\d+$/.test(digits)) return null;
  const unit = Number(minorUnit);
  if (!Number.isInteger(unit) || unit < 0 || unit > 4) return null;
  if (unit === 0) return digits.replace(/^0+(?=\d)/, '');
  const padded = digits.padStart(unit + 1, '0');
  const whole = padded.slice(0, -unit).replace(/^0+(?=\d)/, '');
  const fraction = padded.slice(-unit);
  return whole + '.' + fraction;
}

module.exports = {
  htmlToText: htmlToText,
  textOf: textOf,
  firstText: firstText,
  decimalFromMinorUnits: decimalFromMinorUnits
};
