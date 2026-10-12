// Onboarding /start (F §4.13, A.2 E1, S37): three steps with a dot indicator, every step skippable.
//
// Details of this implementation:
// - Step 1: the three principle sentences and the device-protection sentence.
// - Step 2: seven flower cards plus "Eigener Bereich" (name field, generic flower) as a multi-select;
//   each card is a <button role="checkbox"> (Space/Enter/click). "Weiter" needs at least one selection;
//   a selected custom card needs a name (1–40 characters, typing a name selects the card).
//   "Überspringen" discards the selection, so completeOnboarding([]) creates only "Wohnen & Alltag" (AC3).
//   The "mindestens einen Bereich" error sits in the sticky action bar above the buttons (always in
//   view) and focus moves to the first card.
// - Step 3: entering it requests navigator.storage.persist() from the click that entered it (a browser
//   prompt still has user activation) and shows the outcome in neutral words, the export hint, the
//   Safari hint (Safari only) and the incognito sentence.
// - Finish ("Fertig", or "Überspringen" on step 3): completeOnboarding(selection in DEFAULT_AREAS order,
//   custom area last with GENERIC_TINT and flower 'generic'), then ol-navigate { path: '/heute', replace }.
// - A step change moves focus to the new step's <h1> (described by the step indicator); the entering step
//   slides in 20 px with a fade (B.4 "Ebene öffnen"), a 120 ms fade under reduced motion.
import '../components/ol-button.js';
import '../components/ol-flower.js';
import '../components/ol-input.js';
import '../components/ol-plant.js';
import type { OlButton } from '../components/ol-button.js';
import type { OlInput } from '../components/ol-input.js';
import { showToast } from '../components/ol-toast.js';
import { areaDescription, fmt, t } from '../i18n/de.js';
import { DEFAULT_AREAS, GENERIC_TINT, type Area, type FlowerId } from '../model.js';
import { completeOnboarding } from '../repo/profile.js';
import type { Route } from '../router.js';
import { isSafari, requestPersist, type PersistResult } from '../services/storage-hints.js';
import { emit, h, icon, motionReduced, render, setVar, type SafeHtml } from '../util/dom.js';

type Step = 1 | 2 | 3;
type Choice = FlowerId | 'custom';

const STEPS: readonly Step[] = [1, 2, 3];
const CUSTOM = 'custom';
const NAME_MAX = 40;
const HERO = DEFAULT_AREAS[0];

const PERSIST_TEXT: Readonly<Record<PersistResult | 'pending', string>> = {
  pending: t.persistPending,
  granted: t.persistGranted,
  denied: t.persistDenied,
  unsupported: t.persistUnsupported,
};

export function mount(view: HTMLElement, route: Route): () => void {
  void route;
  const screen = new StartScreen(view);
  return () => screen.destroy();
}

function req<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`start: missing ${selector}`);
  return el;
}

class StartScreen {
  private readonly root: HTMLElement;
  private readonly dots: HTMLElement;
  private readonly sections: Record<Step, HTMLElement>;
  private readonly cards: HTMLButtonElement[];
  private readonly customItem: HTMLElement;
  private readonly customInput: OlInput;
  private readonly areaError: HTMLElement;
  private readonly status: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly skipBtn: OlButton;
  private readonly nextBtn: OlButton;

  private step: Step = 1;
  private readonly selected = new Set<Choice>();
  private areasSkipped = false;
  private persistAsked = false;
  private finishing = false;
  private destroyed = false;

  constructor(view: HTMLElement) {
    render(view, this.markup());
    this.root = req<HTMLElement>(view, '.ol-start');
    this.dots = req<HTMLElement>(view, '.ol-start__dots');
    this.sections = {
      1: req<HTMLElement>(view, '[data-step="1"]'),
      2: req<HTMLElement>(view, '[data-step="2"]'),
      3: req<HTMLElement>(view, '[data-step="3"]'),
    };
    this.cards = [...view.querySelectorAll<HTMLButtonElement>('.ol-start__card')];
    this.customItem = req<HTMLElement>(view, '.ol-start__custom');
    this.customInput = req<OlInput>(view, '.ol-start__custom-name');
    this.areaError = req<HTMLElement>(view, '.ol-start__error');
    this.status = req<HTMLElement>(view, '.ol-start__status');
    this.statusText = req<HTMLElement>(view, '.ol-start__status-text');
    this.skipBtn = req<OlButton>(view, '.ol-start__skip');
    this.nextBtn = req<OlButton>(view, '.ol-start__next');

    for (const card of this.cards) {
      const tint = DEFAULT_AREAS.find((a) => a.flower === card.dataset['value'])?.tint ?? GENERIC_TINT;
      setVar(card, '--tint', tint);
    }
    setVar(this.customItem, '--tint', GENERIC_TINT);
    this.bind();
    this.syncIndicator();
  }

  destroy(): void {
    this.destroyed = true;
  }

  private markup(): SafeHtml {
    const card = (choice: Choice, name: string, description: string, flower: FlowerId): SafeHtml => h`
      <button type="button" class="ol-start__card${choice === CUSTOM ? ' ol-start__card--custom' : ''}" role="checkbox"
        aria-checked="false" data-value="${choice}">
        <span class="ol-start__check" aria-hidden="true">${icon('check', 20)}</span>
        <ol-flower class="ol-start__flower" flower="${flower}" size="48"></ol-flower>
        <span class="ol-start__card-text">
          <span class="ol-start__name">${name}</span>
          <span class="ol-start__desc">${description}</span>
        </span>
      </button>`;
    const safari = isSafari();
    return h`
      <div class="ol-start">
        <div class="ol-start__dots" id="start-dots" role="img" aria-label="${fmt(t.onbStepAria, { n: 1 })}">
          ${STEPS.map(() => h`<span class="ol-start__dot"></span>`)}
        </div>

        <section class="ol-start__step" data-step="1" aria-labelledby="start-h1">
          <div class="ol-start__hero" aria-hidden="true">
            <ol-plant stage="4" flower="${HERO?.flower ?? 'generic'}" tint="${HERO?.tint ?? GENERIC_TINT}" size="120"></ol-plant>
          </div>
          <h1 class="ol-display ol-start__title" id="start-h1" tabindex="-1" aria-describedby="start-dots">${t.onb1Title}</h1>
          <ul class="ol-start__principles">
            <li class="ol-start__principle">${icon('hard-drive')}<span>${t.onb1Line1}</span></li>
            <li class="ol-start__principle">${icon('shield')}<span>${t.onb1Line2}</span></li>
            <li class="ol-start__principle">${icon('download')}<span>${t.onb1Line3}</span></li>
          </ul>
          <p class="ol-start__note">${icon('info', 20)}<span>${t.hintDeviceProtection}</span></p>
        </section>

        <section class="ol-start__step" data-step="2" aria-labelledby="start-h2" hidden>
          <h1 class="ol-display ol-start__title" id="start-h2" tabindex="-1" aria-describedby="start-dots">${t.onb2Title}</h1>
          <p class="ol-start__intro" id="start-intro-2">${t.onb2Intro}</p>
          <div role="group" aria-labelledby="start-h2" aria-describedby="start-intro-2">
            <ul class="ol-start__areas">
              ${DEFAULT_AREAS.map((a) => h`<li class="ol-start__area">${card(a.flower, a.name, areaDescription(a.flower), a.flower)}</li>`)}
              <li class="ol-start__area ol-start__custom">
                ${card(CUSTOM, t.onbCustomArea, t.onbCustomAreaDesc, 'generic')}
                <ol-input class="ol-start__custom-name" label="${t.onbCustomAreaName}" maxlength="${NAME_MAX}" autocomplete="off"></ol-input>
              </li>
            </ul>
          </div>
        </section>

        <section class="ol-start__step" data-step="3" aria-labelledby="start-h3" hidden>
          <h1 class="ol-display ol-start__title" id="start-h3" tabindex="-1" aria-describedby="start-dots">${t.onb3Title}</h1>
          <p class="ol-start__intro">${t.onb3Intro}</p>
          <div class="ol-start__status" data-state="idle">
            ${icon('hard-drive')}
            <p class="ol-start__status-text" role="status" aria-live="polite"></p>
          </div>
          <ul class="ol-start__notes">
            <li class="ol-start__note">${icon('download', 20)}<span>${t.exportHint}</span></li>
            ${safari ? h`<li class="ol-start__note">${icon('info', 20)}<span>${t.safariHint}</span></li>` : ''}
            <li class="ol-start__note">${icon('info', 20)}<span>${t.incognitoHint}</span></li>
          </ul>
        </section>

        <div class="ol-start__actions">
          <p class="ol-start__error" aria-live="polite"></p>
          <ol-button class="ol-start__skip" variant="ghost" label="${t.actionSkip}"></ol-button>
          <ol-button class="ol-start__next" variant="filled" label="${t.actionNext}"></ol-button>
        </div>
      </div>`;
  }

  private bind(): void {
    for (const card of this.cards) card.addEventListener('click', this.onCardClick);
    this.customInput.addEventListener('input', this.onCustomInput);
    this.customInput.addEventListener('keydown', this.onCustomKeyDown);
    this.skipBtn.addEventListener('click', () => this.skip());
    this.nextBtn.addEventListener('click', () => this.next());
  }

  // -------------------------------------------------------------------------
  // Step 2: area selection

  private setSelected(choice: Choice, on: boolean): void {
    if (on) this.selected.add(choice);
    else this.selected.delete(choice);
    const card = this.cards.find((c) => c.dataset['value'] === choice);
    card?.setAttribute('aria-checked', on ? 'true' : 'false');
    card?.closest('.ol-start__area')?.toggleAttribute('data-selected', on);
    if (this.selected.size > 0) this.showAreaError('');
    if (!on && choice === CUSTOM) this.customInput.removeAttribute('error');
  }

  private showAreaError(text: string): void {
    if (this.areaError.textContent !== text) this.areaError.textContent = text;
  }

  private customName(): string {
    return this.customInput.value.trim().slice(0, NAME_MAX);
  }

  private readonly onCardClick = (event: MouseEvent): void => {
    const card = event.currentTarget;
    if (!(card instanceof HTMLButtonElement)) return;
    const choice = card.dataset['value'] as Choice | undefined;
    if (!choice) return;
    const on = !this.selected.has(choice);
    this.setSelected(choice, on);
    // A selected custom card needs a name: the field is the next thing to fill in.
    if (on && choice === CUSTOM && this.customName() === '') this.customInput.focusInput();
  };

  private readonly onCustomInput = (): void => {
    if (this.customInput.hasAttribute('error')) this.customInput.removeAttribute('error');
    if (this.customName() !== '' && !this.selected.has(CUSTOM)) this.setSelected(CUSTOM, true);
  };

  private readonly onCustomKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    this.next();
  };

  /** "Weiter" on step 2: at least one area; a selected custom card needs a name. */
  private validateAreas(): boolean {
    if (this.selected.size === 0) {
      this.showAreaError(t.onbAreaRequired);
      this.cards[0]?.focus();
      return false;
    }
    if (this.selected.has(CUSTOM) && this.customName() === '') {
      this.customInput.setAttribute('error', t.areaNameRequired);
      this.customInput.focusInput();
      return false;
    }
    return true;
  }

  /** Selected areas in DEFAULT_AREAS order, the custom area last; [] when step 2 was skipped. */
  private selection(): Array<Pick<Area, 'name' | 'flower' | 'tint'>> {
    if (this.areasSkipped) return [];
    const chosen = DEFAULT_AREAS
      .filter((a) => this.selected.has(a.flower))
      .map((a) => ({ name: a.name, flower: a.flower, tint: a.tint }));
    const custom = this.customName();
    if (this.selected.has(CUSTOM) && custom !== '') chosen.push({ name: custom, flower: 'generic', tint: GENERIC_TINT });
    return chosen;
  }

  // -------------------------------------------------------------------------
  // Navigation between steps

  private skip(): void {
    if (this.finishing) return;
    if (this.step === 1) {
      this.goTo(2);
    } else if (this.step === 2) {
      // S37: skipping step 2 always creates only "Wohnen & Alltag".
      this.areasSkipped = true;
      this.goTo(3);
    } else {
      void this.finish();
    }
  }

  private next(): void {
    if (this.finishing) return;
    if (this.step === 1) {
      this.goTo(2);
    } else if (this.step === 2) {
      if (!this.validateAreas()) return;
      this.areasSkipped = false;
      this.goTo(3);
    } else {
      void this.finish();
    }
  }

  private goTo(step: Step): void {
    const from = this.sections[this.step];
    const to = this.sections[step];
    this.step = step;
    from.hidden = true;
    to.hidden = false;
    this.showAreaError('');
    this.syncIndicator();
    // Called from the click handler, so a permission prompt still has user activation.
    if (step === 3) this.askPersist();
    window.scrollTo(0, 0);
    to.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    this.animateIn(to);
  }

  private syncIndicator(): void {
    this.dots.setAttribute('aria-label', fmt(t.onbStepAria, { n: this.step }));
    [...this.dots.children].forEach((dot, i) => dot.toggleAttribute('data-active', i + 1 === this.step));
    this.nextBtn.setAttribute('label', this.step === 3 ? t.actionFinish : t.actionNext);
  }

  private animateIn(section: HTMLElement): void {
    if (typeof section.animate !== 'function') return;
    if (motionReduced()) {
      section.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear' });
    } else {
      section.animate(
        [{ opacity: 0, transform: 'translateX(20px)' }, { opacity: 1, transform: 'translateX(0)' }],
        { duration: 200, easing: 'cubic-bezier(0,0,0,1)' },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: persistent storage

  private askPersist(): void {
    if (this.persistAsked) return;
    this.persistAsked = true;
    this.showPersist('pending');
    requestPersist().then(
      (result) => this.showPersist(result),
      () => this.showPersist('denied'),
    );
  }

  private showPersist(state: PersistResult | 'pending'): void {
    if (this.destroyed) return;
    this.status.dataset['state'] = state;
    this.statusText.textContent = PERSIST_TEXT[state];
  }

  // -------------------------------------------------------------------------
  // Finish

  private async finish(): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    this.nextBtn.setAttribute('loading', '');
    this.skipBtn.setAttribute('disabled', '');
    try {
      await completeOnboarding(this.selection());
    } catch (err) {
      console.error(err);
      this.finishing = false;
      this.nextBtn.removeAttribute('loading');
      this.skipBtn.removeAttribute('disabled');
      showToast(t.toastError);
      return;
    }
    // main.ts may already have left /start on the profile change; the replace is then a no-op.
    emit(this.root.isConnected ? this.root : document, 'ol-navigate', { path: '/heute', replace: true });
  }
}
