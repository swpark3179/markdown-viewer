#!/usr/bin/env node
/**
 * 다음 릴리스 버전을 결정한다.
 *
 * 우선순위
 *   1. GitHub Release 페이지의 최신 버전
 *   2. (조회 실패 시) git 태그 `v*` 중 최신 버전
 *   3. (그래도 없으면) 소스 설정 파일(tauri.conf.json > package.json > Cargo.toml)의 버전
 *
 * 릴리스도 태그도 없는 "최초 릴리스"라면 입력 파라미터와 관계없이 1.0.0 을 쓴다.
 *
 * 입력  : env BUMP = major | minor | patch
 * 출력  : $GITHUB_OUTPUT 에 version / tag / previous_tag / base / source / reason / first
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';

const BUMP_KINDS = ['major', 'minor', 'patch'];

const bump = (process.env.BUMP ?? '').trim();
const repo = (process.env.GITHUB_REPOSITORY ?? '').trim();

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function warn(message) {
  console.warn(`::warning::${message}`);
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** "v1.2.3" / "1.2.3" -> [1, 2, 3] (형식이 아니면 null) */
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? '').trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

const formatVersion = (version) => version.join('.');

function bumpVersion([major, minor, patch], kind) {
  if (kind === 'major') return [major + 1, 0, 0];
  if (kind === 'minor') return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

/** GitHub Release 목록. 조회 자체가 실패하면 ok:false 로 알린다. */
function readReleases() {
  try {
    const raw = run('gh', [
      'api',
      '--paginate',
      `repos/${repo}/releases`,
      '--jq',
      '.[] | select(.draft == false) | .tag_name',
    ]);
    const entries = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({ name, version: parseVersion(name) }))
      .filter((entry) => entry.version !== null);
    return { ok: true, entries };
  } catch (error) {
    warn(`GitHub Release 조회에 실패해 소스 설정 파일로 대체합니다: ${error.message}`);
    return { ok: false, entries: [] };
  }
}

function readTags() {
  try {
    return run('git', ['tag', '--list'])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({ name, version: parseVersion(name) }))
      .filter((entry) => entry.version !== null);
  } catch (error) {
    warn(`git 태그 조회에 실패했습니다: ${error.message}`);
    return [];
  }
}

/** 소스 설정 파일에 적힌 버전. */
function readConfigVersion() {
  const sources = [
    ['src-tauri/tauri.conf.json', (text) => JSON.parse(text).version],
    ['package.json', (text) => JSON.parse(text).version],
    ['src-tauri/Cargo.toml', (text) => /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(text)?.[1]],
  ];

  for (const [file, pick] of sources) {
    if (!existsSync(file)) continue;
    try {
      const version = parseVersion(pick(readFileSync(file, 'utf8')));
      if (version) return { version, file };
    } catch (error) {
      warn(`${file} 에서 버전을 읽지 못했습니다: ${error.message}`);
    }
  }
  return null;
}

const highest = (entries) =>
  entries.length
    ? entries.reduce((best, entry) => (compareVersion(entry.version, best.version) > 0 ? entry : best))
    : null;

if (!BUMP_KINDS.includes(bump)) {
  fail(`BUMP 입력값이 올바르지 않습니다: "${bump}" (${BUMP_KINDS.join(' | ')} 중 하나)`);
}
if (!repo) {
  fail('GITHUB_REPOSITORY 환경 변수가 비어 있습니다.');
}

const releases = readReleases();
const tags = readTags();

const latestRelease = releases.ok ? highest(releases.entries) : null;
const latestTag = highest(tags);
const config = latestRelease || latestTag ? null : readConfigVersion();

let base = null;
let source = '';

if (latestRelease) {
  base = latestRelease.version;
  source = `GitHub Release ${latestRelease.name}`;
} else if (latestTag) {
  base = latestTag.version;
  source = `git 태그 ${latestTag.name}${releases.ok ? '' : ' (Release 조회 실패)'}`;
} else if (config) {
  base = config.version;
  source = `${config.file} (${releases.ok ? '릴리스 없음' : 'Release 조회 실패'})`;
} else {
  source = '기준으로 삼을 버전 정보 없음';
}

// 릴리스도 태그도 없으면 최초 릴리스로 보고 파라미터와 무관하게 1.0.0 을 쓴다.
const neverReleased = !latestRelease && !latestTag;
const firstRelease = neverReleased && (base === null || compareVersion(base, [1, 0, 0]) < 0);

const next = firstRelease ? [1, 0, 0] : bumpVersion(base, bump);
const reason = firstRelease
  ? `최초 릴리스이므로 입력값(${bump})과 관계없이 1.0.0 을 사용합니다.`
  : `${formatVersion(base)} 기준으로 ${bump} 버전을 올립니다.`;

const tag = `v${formatVersion(next)}`;

if (tags.some((entry) => entry.name === tag)) {
  fail(`${tag} 태그가 이미 존재합니다. 이미 릴리스된 버전인지 확인해 주세요.`);
}
if (releases.entries.some((entry) => entry.name === tag)) {
  fail(`${tag} 릴리스가 이미 존재합니다.`);
}

const outputs = {
  version: formatVersion(next),
  tag,
  previous_tag: latestTag?.name ?? '',
  base: base ? formatVersion(base) : '',
  source,
  reason,
  first: String(firstRelease),
};

const summary = [
  `- 기준 버전: ${outputs.base || '(없음)'}`,
  `- 기준 출처: ${source}`,
  `- 결정 근거: ${reason}`,
  `- 다음 버전: ${outputs.version} (${tag})`,
];

console.log(summary.join('\n'));

if (process.env.GITHUB_OUTPUT) {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 버전 결정\n\n${summary.join('\n')}\n\n`);
}
