import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_CONFIGS, detectAgents, parseAgentOutput, parseArguments, summarizeWithAgent } from '../../src/enrichment/agents';
import { spawn } from 'node:child_process';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function fakeChild() {
  return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
}
const config = { id: 'test', name: 'Test', kind: 'custom' as const, command: process.execPath, args: '--flag "two words"' };

describe('local agent adapter', () => {
  it('groups arguments without evaluating shell content and preserves empty arguments', () => {
    expect(parseArguments('--tools "" --x "two words" $(whoami) ; `id`')).toEqual(['--tools', '', '--x', 'two words', '$(whoami)', ';', '`id`']);
    expect(() => parseArguments('"broken')).toThrow('引號');
    expect(parseArguments('"C:\\Users\\Agent"')).toEqual(['C:\\Users\\Agent']);
  });
  it('detects executable files without launching agents', async () => {
    const result = await detectAgents([config, { ...config, command: '/nonexistent/vfr-agent' }]);
    expect(result.map(item => item.installed)).toEqual([true, false]);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('parses each documented response format, not progress or reasoning', () => {
    expect(parseAgentOutput('codex', '{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"reasoning","text":"private"}}\n{"type":"item.completed","item":{"type":"agent_message","text":"summary"}}')).toBe('summary');
    expect(parseAgentOutput('claude', '{"result":"summary","is_error":false}')).toBe('summary');
    expect(parseAgentOutput('opencode', '{"type":"step_start"}\n{"type":"text","part":{"text":"summary"}}')).toBe('summary');
    expect(parseAgentOutput('pi', ' summary\n')).toBe('summary');
    expect(() => parseAgentOutput('claude', '{"is_error":true}')).toThrow('失敗');
    expect(() => parseAgentOutput('codex', '{"type":"turn.failed"}')).toThrow('失敗');
    expect(() => parseAgentOutput('custom', ' ')).toThrow('未回傳');
    expect(() => parseAgentOutput('opencode', 'not json')).toThrow();
  });
  it('uses an isolated working directory, no shell, and stdin for article data', async () => {
    const child = fakeChild();
    let received = '';
    child.stdin.on('data', data => { received += data.toString(); });
    vi.mocked(spawn).mockImplementationOnce((_command, _args, options) => {
      expect(options).toMatchObject({ shell: false });
      expect(options?.cwd).toContain('vault-feed-summary-');
      expect(options?.env?.PWD).toBe(options?.cwd);
      queueMicrotask(() => { child.stdout.write('摘要'); child.emit('close', 0); });
      return child as unknown as ReturnType<typeof spawn>;
    });
    expect(await summarizeWithAgent(config, { article: '$(rm -rf vault)', prompt: '繁中摘要' })).toBe('摘要');
    expect(received).toContain('$(rm -rf vault)');
    expect(received).toContain('繁中摘要');
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toEqual(['--flag', 'two words']);
  });
  it.each([
    ['codex', '{"type":"item.completed","item":{"type":"agent_message","text":"摘要"}}'],
    ['claude', '{"is_error":false,"result":"摘要"}'],
    ['opencode', '{"type":"text","part":{"text":"摘要"}}'],
    ['pi', '摘要'],
  ] as const)('runs the %s adapter through its noninteractive protocol and removes its temporary cwd', async (kind, output) => {
    const child = fakeChild();
    let cwd = '';
    vi.mocked(spawn).mockImplementationOnce((_command, _args, options) => {
      cwd = String(options?.cwd);
      if (kind === 'opencode') expect(options?.env?.OPENCODE_PERMISSION).toBe('{"*":"deny"}');
      queueMicrotask(() => { child.stdout.write(output); child.emit('close', 0); });
      return child as unknown as ReturnType<typeof spawn>;
    });
    const preset = DEFAULT_AGENT_CONFIGS.find(item => item.kind === kind)!;
    expect(await summarizeWithAgent({ ...preset, command: process.execPath }, { article: '文章', prompt: '摘要' })).toBe('摘要');
    await expect(access(cwd)).rejects.toThrow();
  });
  it.each(['exit', 'error', 'overflow', 'abort', 'timeout'] as const)('rejects %s without returning a partial summary', async mode => {
    const child = fakeChild();
    const controller = new AbortController();
    vi.mocked(spawn).mockImplementationOnce(() => {
      setTimeout(() => {
        child.stdout.write('partial');
        if (mode === 'exit') child.emit('close', 1);
        if (mode === 'error') child.emit('error', new Error('failed'));
        if (mode === 'overflow') child.stdout.write('x'.repeat(200));
        if (mode === 'abort') controller.abort();
      }, 0);
      return child as unknown as ReturnType<typeof spawn>;
    });
    await expect(summarizeWithAgent(config, { article: 'article', prompt: 'summary', signal: controller.signal, timeoutMs: 30, maxOutputBytes: 100 })).rejects.toThrow();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
  it('does not launch already cancelled jobs', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(summarizeWithAgent(config, { article: 'article', prompt: 'summary', signal: controller.signal })).rejects.toThrow('取消');
  });
  it('ships no approval-bypass flags', () => {
    expect(DEFAULT_AGENT_CONFIGS.every(agent => !/dangerously|yolo|skip-permissions/.test(agent.args))).toBe(true);
  });
});
