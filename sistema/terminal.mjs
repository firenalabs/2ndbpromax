const colors = {success:32, warning:33, error:31};
export function formatTerminal(message, level='info', {isTTY=process.stdout.isTTY, env=process.env}={}) {
  const text=String(message);
  const enabled=env.NO_COLOR===undefined && env.TERM!=='dumb' &&
    (env.FORCE_COLOR!==undefined ? env.FORCE_COLOR!=='0' : !!isTTY);
  return enabled && colors[level] ? `\u001b[${colors[level]}m${text}\u001b[0m` : text;
}
export function terminalLog(message, level='info') { console.log(formatTerminal(message,level)); }
export function terminalError(message) { console.error(formatTerminal(message,'error',{isTTY:process.stderr.isTTY})); }
