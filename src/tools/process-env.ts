// 子进程环境：只移除常见凭据变量，保留工具需要的系统配置。
export function scrubbedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/KEY|SECRET|TOKEN|PASSWORD/i.test(key)) delete env[key];
  }
  return { ...env, ...extra };
}
