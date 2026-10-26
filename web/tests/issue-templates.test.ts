import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const issueTemplateDirectory = resolve(repositoryRoot, '.github/ISSUE_TEMPLATE');

function readIssueTemplate(name: string): Record<string, any> {
  return parse(readFileSync(resolve(issueTemplateDirectory, name), 'utf8')) as Record<string, any>;
}

test('native reports build a Tally URL with only the approved hidden fields', () => {
  const nativePolicy = readFileSync(resolve(repositoryRoot, 'native/BugReportPolicy.swift'), 'utf8');
  const reportURLPolicy = nativePolicy.slice(nativePolicy.indexOf('static func reportURL'), nativePolicy.indexOf('private static func bounded'));
  const parameters = [...reportURLPolicy.matchAll(/URLQueryItem\(name: "([^"]+)"/g)].map(match => match[1]);

  assert.ok(reportURLPolicy.includes('https://tally.so/r/Nqq6rl'));
  assert.deepEqual(parameters, ['version', 'macos', 'mac', 'theme']);
  assert.doesNotMatch(nativePolicy, /bugReportEmail|issues\/new|mailto:/);
});

test('GitHub issue forms remain available for people visiting the repository', () => {
  const bugReport = readIssueTemplate('bug_report.yml');
  const featureRequest = readIssueTemplate('feature_request.yml');
  assert.equal(bugReport.name, 'Bug report');
  assert.ok((bugReport.body as Array<{ id?: string; attributes?: { description?: string } }>).some(field =>
    field.id === 'additional-context' && field.attributes?.description?.includes("Don't paste private notes")));
  assert.equal(featureRequest.name, 'Feature request');
  assert.ok(Array.isArray(featureRequest.body) && featureRequest.body.length > 0);
});

test('issue templates and the site provide a GitHub-account-free problem-report link', () => {
  const config = readIssueTemplate('config.yml');
  const site = readFileSync(resolve(repositoryRoot, 'site/index.template.html'), 'utf8');
  assert.equal(config.blank_issues_enabled, false);
  assert.ok(config.contact_links.some((link: { name: string; url: string }) =>
    link.name === 'Report a problem without a GitHub account' && link.url === 'https://tally.so/r/Nqq6rl'));
  assert.ok(config.contact_links.some((link: { url: string }) =>
    link.url === 'https://github.com/jzlosman/banana-notes/security/policy'));
  assert.match(site, /<a href="https:\/\/tally\.so\/r\/Nqq6rl" data-goatcounter-click="report-problem">Report a problem<\/a>/);
});
