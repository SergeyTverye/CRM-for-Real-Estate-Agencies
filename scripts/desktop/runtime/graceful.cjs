// Private stdin control channel. It is never exposed to WebView or HTTP.
process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.includes('STOP\n')) { process.emit('SIGTERM', 'SIGTERM'); input = ''; }
});
process.stdin.on('end', () => process.emit('SIGTERM', 'SIGTERM'));
process.stdin.unref?.();
