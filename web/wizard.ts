export const steps = ['upload', 'review', 'calendar', 'import'] as const;
type Step = typeof steps[number];

interface Prerequisites {
  hasParsedFile: boolean;
  hasSelection: boolean;
  hasCalendar: boolean;
  busy: boolean;
  consumed: boolean;
}

export class ImportWizard {
  private position = 0;
  private reached = 0;
  private limit = 0;
  private busy = false;

  get current(): Step { return steps[this.position]; }

  update(state: Prerequisites): void {
    this.busy = state.busy;
    this.limit = 3;
    if (!state.consumed) {
      if (!state.hasParsedFile) this.limit = 0;
      else if (!state.hasSelection) this.limit = 1;
      else if (!state.hasCalendar) this.limit = 2;
    }
    this.reached = Math.min(this.reached, this.limit);
    if (!this.busy) this.position = Math.min(this.position, this.limit);
  }

  canVisit(step: Step): boolean {
    const target = steps.indexOf(step);
    return !this.busy && (target <= this.reached || (target === this.position + 1 && this.canAdvance));
  }

  visit(step: Step): void {
    if (!this.canVisit(step)) return;
    this.position = steps.indexOf(step);
    this.reached = Math.max(this.reached, this.position);
  }

  get canAdvance(): boolean {
    return !this.busy && this.position < this.limit;
  }

  advance(): void {
    if (this.canAdvance) this.visit(steps[this.position + 1]);
  }

  get canGoBack(): boolean { return !this.busy && this.position > 0; }

  back(): void {
    if (this.canGoBack) this.position -= 1;
  }
}
