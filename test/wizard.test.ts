import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ImportWizard, steps } from '../web/wizard';

const ready = {
  hasParsedFile: true, hasSelection: true, hasCalendar: true, busy: false, consumed: false
};

function atImport(): ImportWizard {
  const wizard = new ImportWizard();
  wizard.update(ready);
  wizard.advance();
  wizard.advance();
  wizard.advance();
  return wizard;
}

describe('given a new calendar import', () => {
  describe('when prerequisites become available', () => {
    it('should allow Next or the next ready breadcrumb without advancing automatically or skipping steps', () => {
      const wizard = new ImportWizard();
      assert.equal(wizard.canAdvance, false);
      assert.equal(wizard.canVisit('review'), false);
      wizard.advance();
      wizard.visit('review');
      assert.equal(wizard.current, 'upload');

      wizard.update({ ...ready, busy: true });
      assert.equal(wizard.canAdvance, false);
      assert.equal(wizard.canVisit('review'), false);
      wizard.advance();
      wizard.visit('review');
      assert.equal(wizard.current, 'upload');

      wizard.update(ready);
      assert.equal(wizard.current, 'upload');
      assert.equal(wizard.canAdvance, true);
      assert.equal(wizard.canVisit('review'), true);
      assert.equal(wizard.canVisit('calendar'), false);
      assert.equal(wizard.canVisit('import'), false);
      wizard.visit('calendar');
      wizard.visit('import');
      assert.equal(wizard.current, 'upload');
      wizard.visit('review');
      assert.equal(wizard.current, 'review');

      wizard.update({ ...ready, hasCalendar: false });
      assert.equal(wizard.canAdvance, true);
      assert.equal(wizard.canVisit('calendar'), true);
      wizard.visit('calendar');
      assert.equal(wizard.current, 'calendar');
      assert.equal(wizard.canAdvance, false);
      assert.equal(wizard.canVisit('import'), false);
      wizard.back();
      assert.equal(wizard.current, 'review');
      wizard.back();
      assert.equal(wizard.current, 'upload');
      assert.equal(wizard.canVisit('calendar'), true);
      wizard.visit('calendar');
      assert.equal(wizard.current, 'calendar');

      wizard.update(ready);
      assert.equal(wizard.current, 'calendar');
      assert.equal(wizard.canAdvance, true);
      assert.equal(wizard.canVisit('import'), true);
      wizard.advance();
      assert.equal(wizard.current, 'import');
      assert.equal(wizard.canAdvance, false);
    });
  });

  describe('when returning to completed steps', () => {
    it('should allow revisiting reached steps without starting a new flow', () => {
      const wizard = atImport();
      wizard.back();
      assert.equal(wizard.current, 'calendar');
      wizard.visit('upload');
      assert.equal(wizard.current, 'upload');
      wizard.visit('import');
      assert.equal(wizard.current, 'import');
    });
  });

  describe('when a parsed file contains no matching work shifts', () => {
    it('should allow review but block calendar and import without a selection', () => {
      const wizard = new ImportWizard();
      wizard.update({ ...ready, hasSelection: false });
      assert.equal(wizard.current, 'upload');
      assert.equal(wizard.canAdvance, true);
      assert.equal(wizard.canVisit('review'), true);
      wizard.visit('review');
      assert.equal(wizard.current, 'review');
      assert.equal(wizard.canAdvance, false);
      assert.equal(wizard.canVisit('calendar'), false);
      assert.equal(wizard.canVisit('import'), false);
      wizard.advance();
      wizard.visit('calendar');
      assert.equal(wizard.current, 'review');
      wizard.back();
      wizard.advance();
      assert.equal(wizard.current, 'review');
    });
  });

  describe('when a replacement file is rejected before import has started', () => {
    it('should clear the previous readiness and reached steps until another file parses', () => {
      const wizard = atImport();
      wizard.visit('upload');
      const noFile = { ...ready, hasParsedFile: false, hasSelection: false };
      wizard.update({ ...noFile, busy: true });
      assert.equal(wizard.canAdvance, false);
      assert.equal(wizard.canVisit('review'), false);
      wizard.update(noFile);
      assert.equal(wizard.canAdvance, false);
      assert.equal(wizard.canVisit('review'), false);
      wizard.visit('review');
      wizard.advance();
      assert.equal(wizard.current, 'upload');
      wizard.update(ready);
      assert.equal(wizard.current, 'upload');
      assert.equal(wizard.canAdvance, true);
      assert.equal(wizard.canVisit('review'), true);
      assert.equal(wizard.canVisit('calendar'), false);
      assert.equal(wizard.canVisit('import'), false);
    });
  });

  describe('when all events are deselected during review', () => {
    it('should block later steps until selection and explicit progression are restored', () => {
      const wizard = atImport();
      wizard.visit('review');
      wizard.update({ ...ready, hasSelection: false });
      wizard.visit('import');
      wizard.advance();
      assert.equal(wizard.current, 'review');
      assert.equal(wizard.canVisit('calendar'), false);
      wizard.update(ready);
      assert.equal(wizard.canVisit('import'), false);
      wizard.advance();
      assert.equal(wizard.current, 'calendar');
    });
  });

  describe('when Google expires before import', () => {
    it('should return to calendar and require explicit navigation after reconnection', () => {
      const wizard = atImport();
      wizard.update({ ...ready, hasCalendar: false });
      assert.equal(wizard.current, 'calendar');
      assert.equal(wizard.canAdvance, false);
      assert.equal(wizard.canVisit('import'), false);
      wizard.update(ready);
      assert.equal(wizard.current, 'calendar');
      assert.equal(wizard.canAdvance, true);
      assert.equal(wizard.canVisit('import'), true);
      wizard.visit('import');
      assert.equal(wizard.current, 'import');
    });
  });
});

describe('given an operation in progress', () => {
  for (const step of steps) {
    describe(`when navigation is attempted from ${step}`, () => {
      it('should keep the current panel and disable all step navigation', () => {
        const wizard = atImport();
        wizard.visit(step);
        wizard.update({ ...ready, busy: true, consumed: step === 'import' });
        for (const target of steps) {
          assert.equal(wizard.canVisit(target), false);
          wizard.visit(target);
        }
        wizard.back();
        wizard.advance();
        assert.equal(wizard.current, step);
        assert.equal(wizard.canGoBack, false);
        assert.equal(wizard.canAdvance, false);
      });
    });
  }
});

describe('given a batch that has started', () => {
  describe('when the connection expires during import and the user later goes back', () => {
    it('should keep results reachable without requiring another connection', () => {
      const wizard = atImport();
      wizard.update({ ...ready, hasCalendar: false, busy: true, consumed: true });
      assert.equal(wizard.current, 'import');
      wizard.update({ ...ready, hasCalendar: false, consumed: true });
      assert.equal(wizard.current, 'import');
      wizard.visit('review');
      assert.equal(wizard.current, 'review');
      wizard.visit('import');
      assert.equal(wizard.current, 'import');
    });
  });

  describe('when replacing the file after import', () => {
    it('should retain results after rejection and reset reached steps only when a new file parses', () => {
      const wizard = atImport();
      wizard.update({ ...ready, consumed: true });
      wizard.visit('upload');
      wizard.update({ ...ready, consumed: true, busy: true });
      assert.equal(wizard.canVisit('import'), false);
      wizard.update({ ...ready, consumed: true });
      assert.equal(wizard.canVisit('import'), true);
      wizard.visit('import');
      assert.equal(wizard.current, 'import');
      wizard.visit('upload');
      wizard.update({ ...ready, hasParsedFile: false, hasSelection: false, busy: true });
      wizard.update({ ...ready, hasParsedFile: false, hasSelection: false });
      assert.equal(wizard.current, 'upload');
      assert.equal(wizard.canAdvance, false);
      assert.equal(wizard.canVisit('review'), false);
      wizard.update(ready);
      assert.equal(wizard.current, 'upload');
      assert.equal(wizard.canAdvance, true);
      assert.equal(wizard.canVisit('review'), true);
      assert.equal(wizard.canVisit('import'), false);
      wizard.advance();
      assert.equal(wizard.current, 'review');
    });
  });
});
