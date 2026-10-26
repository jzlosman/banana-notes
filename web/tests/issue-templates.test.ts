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

test('bug-report diagnostics query parameters match issue-form field IDs', () => {
  const form = readIssueTemplate('bug_report.yml');
  const nativePolicy = readFileSync(resolve(repositoryRoot, 'native/BugReportPolicy.swift'), 'utf8');
  const issueURLPolicy = nativePolicy.slice(nativePolicy.indexOf('static func issueURL'), nativePolicy.indexOf('private static func emailURL'));
  const issueParameters = [...issueURLPolicy.matchAll(/URLQueryItem\(name: "([^"]+)"/g)].map(match => match[1]);
  const fieldIDs = new Set((form.body as Array<{ id?: string }>).map(field => field.id).filter(Boolean));
  const diagnosticParameters = issueParameters.filter(name => name !== 'template');

  assert.equal(form.name, 'Bug report');
  assert.deepEqual(diagnosticParameters, ['app-version', 'app-build', 'macos-version', 'mac', 'theme']);
  for (const parameter of diagnosticParameters) assert.ok(fieldIDs.has(parameter), `${parameter} must identify a form field`);
  assert.ok(!fieldIDs.has('body') && !fieldIDs.has('title'), 'GitHub-reserved query names are not field IDs');
  assert.ok((form.body as Array<{ id?: string; attributes?: { description?: string } }>).some(field =>
    field.id === 'additional-context' && field.attributes?.description?.includes("Don't paste private notes")));
});

test('issue templates disable blank issues and expose a security-policy contact', () => {
  const config = readIssueTemplate('config.yml');
  const featureRequest = readIssueTemplate('feature_request.yml');
  assert.equal(config.blank_issues_enabled, false);
  assert.ok(config.contact_links.some((link: { url: string }) =>
    link.url === 'https://github.com/jzlosman/banana-notes/security/policy'));
  assert.equal(featureRequest.name, 'Feature request');
  assert.ok(Array.isArray(featureRequest.body) && featureRequest.body.length > 0);
});
