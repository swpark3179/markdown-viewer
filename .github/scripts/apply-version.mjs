#!/usr/bin/env node
/**
 * 결정된 버전을 소스 설정 파일에 반영한다.
 *
 * 대상: package.json / package-lock.json / src-tauri/tauri.conf.json
 *       src-tauri/Cargo.toml / src-tauri/Cargo.lock
 *
 * 파일 전체를 다시 직렬화하지 않고 버전 부분만 바꿔서 원본 포맷을 유지한다.
 * 예상한 위치를 찾지 못하면 조용히 넘어가지 않고 실패시킨다.
 *
 * 입력: env VERSION = "1.2.3"
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const version = (process.env.VERSION ?? '').trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`::error::VERSION 입력값이 올바르지 않습니다: "${version}"`);
  process.exit(1);
}

const CRATE_NAME = 'markdown-viewer';

/** 버전이 들어갈 자리를 (앞부분)(뒷부분) 두 그룹으로 잡는 패턴들. */
const targets = [
  {
    file: 'package.json',
    required: true,
    edits: [{ label: 'version', pattern: /^(\s{2}"version":\s*")[^"]*(")/m }],
    verify: (text) => JSON.parse(text).version,
  },
  {
    file: 'package-lock.json',
    required: true,
    edits: [
      { label: 'root version', pattern: /^(\s{2}"version":\s*")[^"]*(")/m },
      {
        label: 'packages[""] version',
        pattern: /("packages":\s*\{\s*"":\s*\{[^}]*?"version":\s*")[^"]*(")/,
      },
    ],
    verify: (text) => {
      const parsed = JSON.parse(text);
      const root = parsed.version;
      const self = parsed.packages?.['']?.version;
      return root === self ? root : `불일치(root=${root}, packages[""]=${self})`;
    },
  },
  {
    file: 'src-tauri/tauri.conf.json',
    required: true,
    edits: [{ label: 'version', pattern: /^(\s{2}"version":\s*")[^"]*(")/m }],
    verify: (text) => JSON.parse(text).version,
  },
  {
    file: 'src-tauri/Cargo.toml',
    required: true,
    edits: [{ label: '[package] version', pattern: /(\[package\][\s\S]*?^version\s*=\s*")[^"]*(")/m }],
    verify: (text) => /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(text)?.[1],
  },
  {
    // 빌드가 알아서 갱신하지만, 커밋 전에 미리 맞춰 두어 diff 를 명확히 한다.
    file: 'src-tauri/Cargo.lock',
    required: false,
    edits: [
      {
        label: `[[package]] ${CRATE_NAME}`,
        pattern: new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${CRATE_NAME}"\\r?\\nversion = ")[^"]*(")`),
      },
    ],
    verify: (text) =>
      new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${CRATE_NAME}"\\r?\\nversion = "([^"]+)"`).exec(text)?.[1],
  },
];

let failed = false;

for (const target of targets) {
  if (!existsSync(target.file)) {
    if (target.required) {
      console.error(`::error::${target.file} 파일을 찾을 수 없습니다.`);
      failed = true;
    } else {
      console.log(`- ${target.file}: 건너뜀 (파일 없음)`);
    }
    continue;
  }

  const original = readFileSync(target.file, 'utf8');
  let updated = original;
  let ok = true;

  for (const edit of target.edits) {
    if (!edit.pattern.test(updated)) {
      console.error(`::error::${target.file} 에서 "${edit.label}" 위치를 찾지 못했습니다.`);
      ok = false;
      failed = true;
      continue;
    }
    updated = updated.replace(edit.pattern, `$1${version}$2`);
  }

  if (!ok) continue;

  const actual = target.verify(updated);
  if (actual !== version) {
    console.error(`::error::${target.file} 반영 결과가 ${version} 이 아닙니다: ${actual}`);
    failed = true;
    continue;
  }

  if (updated !== original) {
    writeFileSync(target.file, updated);
    console.log(`- ${target.file}: ${version} 으로 변경`);
  } else {
    console.log(`- ${target.file}: 이미 ${version}`);
  }
}

if (failed) process.exit(1);

console.log(`\n버전 ${version} 반영 완료`);
