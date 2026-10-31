/**
 * dom_simulation.test.js
 * Verifies question extraction, approval rules, accessibility, and UI safety guarantees
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Google Forms DOM Scanning, Safety & Approval Rules', () => {
  const mockHtmlPath = path.join(__dirname, '../../extension/test/mock_form.html');
  const mockHtml = fs.readFileSync(mockHtmlPath, 'utf8');

  const contentJsPath = path.join(__dirname, '../../extension/content.js');
  const contentJs = fs.readFileSync(contentJsPath, 'utf8');

  const contentCssPath = path.join(__dirname, '../../extension/content.css');
  const contentCss = fs.readFileSync(contentCssPath, 'utf8');

  test('Mock form contains all 5 supported question types and submit button', () => {
    assert.ok(mockHtml.includes('What is your full name?'), 'Should include short answer');
    assert.ok(mockHtml.includes('Describe the key differences between REST and GraphQL.'), 'Should include paragraph');
    assert.ok(mockHtml.includes('Which protocol does HTTP/3 use for transport?'), 'Should include multiple choice');
    assert.ok(mockHtml.includes('Select all languages supported by the Node.js runtime'), 'Should include checkbox');
    assert.ok(mockHtml.includes('Select your primary programming environment:'), 'Should include dropdown');
    assert.ok(mockHtml.includes('id="submitFormBtn"'), 'Should include manual submit button');
  });

  test('Form submit button must never be touched by automated fill routine', () => {
    // Confirm that content.js has no submit triggers
    assert.strictEqual(
      contentJs.includes('submitFormBtn.click()'),
      false,
      'content.js must NEVER click the submit button'
    );
    assert.strictEqual(
      contentJs.includes('.submit()'),
      false,
      'content.js must NEVER call form.submit()'
    );
  });

  test('Approval is true only for the one-tap flow with a non-empty answer', () => {
    assert.ok(
      contentJs.includes('const hasAnswer = !isEmptyAnswer(s.suggestedAnswer)'),
      'Empty answers must never be approved'
    );
    assert.ok(
      contentJs.includes('state.approvedMap.set(s.questionId, autoFill && hasAnswer)'),
      'Manual suggestions (autoFill=false) must default to unapproved'
    );
  });

  test('A regenerated answer requires re-approval', () => {
    assert.ok(
      contentJs.includes('state.approvedMap.set(qId, false)'),
      'Regenerated suggestions must reset approval to false'
    );
  });

  test('Checkboxes in review UI must not be auto-checked', () => {
    // Check that checkbox render uses checked conditional only if already approved
    assert.ok(
      contentJs.includes("${isApproved ? 'checked' : ''}"),
      'Review checkboxes must be checked only if already approved'
    );
  });

  test('Overwrite protection logic prevents replacing existing user input', () => {
    assert.ok(
      contentJs.includes('!state.overwriteExisting && input.value'),
      'Must verify input is not overwritten when overwriteExisting is false'
    );
    assert.ok(
      contentJs.includes('!state.overwriteExisting && textarea.value'),
      'Must verify textarea is not overwritten when overwriteExisting is false'
    );
  });

  test('Minimal UI dot strictly adheres to 8-12px size requirement', () => {
    // Check dot size in CSS
    const widthMatch = contentCss.match(/width:\s*(\d+)px/);
    const heightMatch = contentCss.match(/height:\s*(\d+)px/);
    assert.ok(widthMatch, 'Dot width should be declared in px');
    assert.ok(heightMatch, 'Dot height should be declared in px');
    const width = parseInt(widthMatch[1], 10);
    const height = parseInt(heightMatch[1], 10);
    assert.ok(width >= 8 && width <= 12, `Dot width (${width}px) must be between 8 and 12px`);
    assert.ok(height >= 8 && height <= 12, `Dot height (${height}px) must be between 8 and 12px`);
  });

  test('Status dot supports all 4 required color states: gray, blue, green, red', () => {
    assert.ok(contentCss.includes('.gfa-status-gray'), 'Should define gray (idle) dot');
    assert.ok(contentCss.includes('.gfa-status-blue'), 'Should define blue (processing) dot');
    assert.ok(contentCss.includes('.gfa-status-green'), 'Should define green (ready/filled) dot');
    assert.ok(contentCss.includes('.gfa-status-red'), 'Should define red (error) dot');
  });

  test('Keyboard accessibility: Escape closes open menus and review modal', () => {
    assert.ok(contentJs.includes("e.key === 'Escape'"), 'Must handle Escape key to dismiss UI');
    assert.ok(contentJs.includes('closeReviewModal()'), 'Escape should dismiss review modal');
    assert.ok(contentJs.includes('closeActionMenu()'), 'Escape should dismiss action menu');
  });
});
