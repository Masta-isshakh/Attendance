/**
 * Intl-free date/time formatting.
 *
 * `Date.prototype.toLocaleTimeString(locale, options)` depends on the JS
 * engine's Intl support, which is not guaranteed on Hermes and can throw. These
 * helpers format manually so they never depend on Intl and never throw.
 */
const MONTHS_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const suffix = hours >= 12 ? 'PM' : 'AM';
    hours %= 12;
    if (hours === 0) hours = 12;
    return `${hours}:${minutes} ${suffix}`;
  } catch {
    return '';
  }
}

export function formatShortDate(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getDate()} ${MONTHS_EN[date.getMonth()]}`;
  } catch {
    return '';
  }
}
