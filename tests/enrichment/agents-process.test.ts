import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { summarizeWithAgent, type AgentConfig } from '../../src/enrichment/agents';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(body: string): Promise<{ config: AgentConfig; record: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'vfr-agent-process-test-'));
  directories.push(directory);
  const script = join(directory, 'agent.cjs');
  const record = join(directory, 'record.json');
  await writeFile(script, `const fs = require('node:fs');\nconst record = ${JSON.stringify(record)};\n${body}`);
  return { config: { id: 'fixture', name: 'Local Node fixture', kind: 'custom', command: process.execPath, args: JSON.stringify(script) }, record };
}
async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try { await access(path); return; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  throw new Error('Fixture did not start');
}

describe('local Node subprocess integration (no agent/model or vault access)', () => {
  it('passes prompt and article through stdin, decodes split UTF-8, isolates cwd/PWD, and cleans up', async () => {
    const { config, record } = await fixture(`
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync(record, JSON.stringify({ input, cwd: process.cwd(), pwd: fs.realpathSync(process.env.PWD), argv: process.argv.slice(2) }));
  const bytes = Buffer.from('繁體中文摘要');
  process.stdout.write(bytes.subarray(0, 2));
  setTimeout(() => process.stdout.write(bytes.subarray(2)), 5);
});`);
    const article = '文章資料 $(touch should-not-exist)；保留中文';
    expect(await summarizeWithAgent(config, { article, prompt: '請整理三個重點' })).toBe('繁體中文摘要');
    const data = JSON.parse(await readFile(record, 'utf8')) as { input: string; cwd: string; pwd: string; argv: string[] };
    expect(data.input).toContain('請整理三個重點');
    expect(data.input).toContain(article);
    expect(data.argv).toEqual([]);
    expect(data.cwd).toContain('vault-feed-summary-');
    expect(data.cwd).not.toBe(process.cwd());
    expect(data.pwd).toBe(data.cwd);
    await expect(access(data.cwd)).rejects.toThrow();
  });
  it('rejects a real nonzero exit without accepting partial output and removes its cwd', async () => {
    const { config, record } = await fixture(`
fs.writeFileSync(record, process.cwd());
process.stdin.resume();
process.stdin.on('end', () => { process.stdout.write('partial summary'); process.exitCode = 7; });`);
    await expect(summarizeWithAgent(config, { article: 'test article', prompt: 'test prompt' })).rejects.toThrow('退出碼 7');
    await expect(access(await readFile(record, 'utf8'))).rejects.toThrow();
  });
  it.each(['abort', 'timeout'] as const)('terminates a real hung subprocess on %s and removes its cwd', async mode => {
    const { config, record } = await fixture(`
fs.writeFileSync(record, JSON.stringify({ cwd: process.cwd(), pid: process.pid }));
process.stdin.resume();
setInterval(() => {}, 1000);`);
    const controller = new AbortController();
    const result = summarizeWithAgent(config, { article: 'test article', prompt: 'test prompt', signal: controller.signal, timeoutMs: mode === 'timeout' ? 500 : 5000 });
    const assertion = expect(result).rejects.toThrow(mode === 'timeout' ? '逾時' : '取消');
    await waitForFile(record);
    const data = JSON.parse(await readFile(record, 'utf8')) as { cwd: string; pid: number };
    if (mode === 'abort') controller.abort();
    await assertion;
    await expect(access(data.cwd)).rejects.toThrow();
    const deadline = Date.now() + 2000;
    let alive = true;
    while (Date.now() < deadline) {
      try { process.kill(data.pid, 0); } catch { alive = false; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(alive).toBe(false);
  });
});
