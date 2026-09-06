// 临时工具：github.com 直连/代理均不可用时，改走 api.github.com 推送
// 策略：基点从远端 ref 实时读取；每次上传 HEAD 完整树（blob 幂等）；本地多提交会合并为一个远端提交
// 用法：node scripts/push-via-api.mjs
import { execSync, execFileSync } from 'node:child_process';

const repo = 'JadeeJacson/zero-day';
const token = execSync('gh auth token', { encoding: 'utf8' }).trim();
const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
const api = async (path, opts = {}) => {
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { ...H, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};

// 远端基点（首次部署可为空）
const remoteSha = await api(`/repos/${repo}/git/ref/heads/main`).then((r) => r.object.sha);
console.log('remote base:', remoteSha.slice(0, 8));

// HEAD 完整树：ls-tree -r 的扁平路径表（trees API 自动建层级）
const ls = execFileSync('git', ['ls-tree', '-r', 'HEAD'], { maxBuffer: 1e8, encoding: 'utf8' });
const entries = ls
  .trim()
  .split('\n')
  .map((line) => {
    const [meta, path] = line.split('\t');
    const [mode, , sha] = meta.split(/\s+/);
    return { path, mode, type: 'blob', sha };
  });
console.log('tree entries:', entries.length);

// 逐个补传 blob（幂等：已存在的内容返回原 sha）
for (const e of entries) {
  const buf = execFileSync('git', ['cat-file', 'blob', e.sha], { maxBuffer: 1e8 });
  const blob = await api(`/repos/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' }),
  });
  e.sha = blob.sha;
}
console.log('blobs synced');

const tree = await api(`/repos/${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ tree: entries }) });
const message = execSync('git log -1 --pretty=%B', { encoding: 'utf8' });
const commit = await api(`/repos/${repo}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({ message, tree: tree.sha, parents: remoteSha ? [remoteSha] : [] }),
});
await api(`/repos/${repo}/git/refs/heads/main`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha, force: false }),
});
// 本地 best-effort 同步引用（远端对象本地不存在时 update-ref 会拒绝，直接写散引用文件）
const { writeFileSync } = await import('node:fs');
try {
  writeFileSync('.git/refs/remotes/origin/main', `${commit.sha}\n`);
} catch {
  /* 忽略：下次 git fetch 会自动校正 */
}
console.log('pushed:', commit.sha);
