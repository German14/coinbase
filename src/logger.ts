import chalk from 'chalk';

type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'trade' | 'signal';

function timestamp(): string {
  return new Date().toLocaleTimeString('es-ES', { hour12: false });
}

function formatMessage(level: LogLevel, message: string, data?: unknown): string {
  const ts = chalk.gray(`[${timestamp()}]`);
  const dataStr = data !== undefined ? ` ${chalk.gray(JSON.stringify(data, null, 0))}` : '';

  switch (level) {
    case 'info':    return `${ts} ${chalk.cyan('ℹ')}  ${message}${dataStr}`;
    case 'warn':    return `${ts} ${chalk.yellow('⚠')}  ${chalk.yellow(message)}${dataStr}`;
    case 'error':   return `${ts} ${chalk.red('✖')}  ${chalk.red(message)}${dataStr}`;
    case 'success': return `${ts} ${chalk.green('✔')}  ${chalk.green(message)}${dataStr}`;
    case 'trade':   return `${ts} ${chalk.magenta('◆')}  ${chalk.magenta(message)}${dataStr}`;
    case 'signal':  return `${ts} ${chalk.blue('▶')}  ${chalk.blue(message)}${dataStr}`;
  }
}

export const logger = {
  info:    (msg: string, data?: unknown) => console.log(formatMessage('info', msg, data)),
  warn:    (msg: string, data?: unknown) => console.log(formatMessage('warn', msg, data)),
  error:   (msg: string, data?: unknown) => console.log(formatMessage('error', msg, data)),
  success: (msg: string, data?: unknown) => console.log(formatMessage('success', msg, data)),
  trade:   (msg: string, data?: unknown) => console.log(formatMessage('trade', msg, data)),
  signal:  (msg: string, data?: unknown) => console.log(formatMessage('signal', msg, data)),

  divider: () => console.log(chalk.gray('─'.repeat(60))),
  banner: (msg: string) => {
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.bold.white(`  ${msg}`));
    console.log(chalk.gray('─'.repeat(60)));
  },
};
