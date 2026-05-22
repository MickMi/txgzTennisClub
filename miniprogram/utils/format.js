function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatDateTime(input) {
  if (!input) return '';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(input) {
  if (!input) return '';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStr() {
  return formatDate(new Date());
}

function nowTimeStr() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = { formatDateTime, formatDate, todayStr, nowTimeStr };
