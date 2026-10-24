import type { PageKind } from './guide-finders';

/**
 * The intro guide as one flat, ordered list. The index into this list is the only progress value ever stored
 * (in session storage, as a bare number), so the order may only change together with ONBOARDING_VERSION.
 */
export const ONBOARDING_VERSION = 1;

export type IntroStepId =
  | 'welcome' | 'appearance' | 'search-first' | 'condition' | 'filters-offer' | 'filters'
  | 'results' | 'understand' | 'brief' | 'personalize' | 'draft' | 'send' | 'done';

export const INTRO_STEPS: readonly IntroStepId[] = [
  'welcome', 'appearance', 'search-first', 'condition', 'filters-offer', 'filters',
  'results', 'understand', 'brief', 'personalize', 'draft', 'send', 'done',
];

/** Which part of the experience hosts the step. Page steps point at ClinicalTrials.gov itself. */
export const STEP_HOST: Record<IntroStepId, 'panel' | 'page'> = {
  welcome: 'panel', appearance: 'panel', 'search-first': 'panel', condition: 'page', 'filters-offer': 'page',
  filters: 'page', results: 'page', understand: 'panel', brief: 'panel', personalize: 'panel', draft: 'panel',
  send: 'panel', done: 'panel',
};

/** The Treatable control a panel step points at, matched by the data-treatable-guide attribute. */
export const PANEL_TARGET: Partial<Record<IntroStepId, string>> = {
  appearance: 'appearance', understand: 'understand', brief: 'brief', personalize: 'personalize', draft: 'draft', send: 'send',
};

export interface StepContext { page: PageKind }

/** Whether a step makes sense on the current kind of page. `filters` runs only after the offer is accepted. */
export function stepApplies(id: IntroStepId, context: StepContext): boolean {
  switch (id) {
    case 'search-first': return context.page === 'study' || context.page === 'other';
    case 'condition': return context.page === 'home' || context.page === 'search';
    case 'filters-offer': return context.page === 'search';
    case 'filters': return false;
    case 'results': return context.page === 'search';
    case 'understand': case 'brief': case 'personalize': case 'draft': case 'send': return context.page === 'study';
    default: return true;
  }
}

/** The index of the next (or previous) applicable step, or undefined when there is none. */
export function stepFrom(index: number, direction: 1 | -1, context: StepContext): number | undefined {
  for (let i = index + direction; i >= 0 && i < INTRO_STEPS.length; i += direction) {
    if (stepApplies(INTRO_STEPS[i], context)) return i;
  }
  return undefined;
}

export function isStoredStep(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < INTRO_STEPS.length;
}

export interface StepCopy {
  title: string;
  body: string[];
  next?: string;
  back?: string;
  skip?: string;
}

/** Plain-language copy for every dialog. None of it asks the person to share anything. */
export const COPY = {
  welcome: {
    title: 'Welcome to Treatable',
    body: [
      'Treatable helps you understand public study records on ClinicalTrials.gov and draft an email to a study team.',
      'It is not medical advice. Talk with your own doctor about any study you are thinking about.',
    ],
    next: 'Show me around',
    skip: 'Skip',
  },
  appearance: {
    title: 'Make Treatable look the way you like',
    body: [
      'Open Settings (the gear) to change how Treatable looks.',
      'Popup is a window in the middle of the page. This is the default. Overlay is a small card at the side, and the website stays easy to use. Sidebar docks Treatable along the right edge.',
      'Theme can follow your computer (System), or you can pick Light or Dark.',
    ],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
  },
  searchFirst: {
    title: 'Start with a search',
    body: [
      'You are not on a ClinicalTrials.gov search page right now.',
      'I can open the ClinicalTrials.gov home page for you. The tour carries on there.',
    ],
    next: 'Open ClinicalTrials.gov',
    back: 'Not now',
    skip: 'Skip',
  },
  condition: {
    title: 'Type your condition here',
    body: [
      'Type your illness or symptoms in the highlighted box, then use the site’s Search button.',
      'If you want studies near you, also type a place in the Location box.',
      'What you type is sent to ClinicalTrials.gov as a normal site search. Treatable does not read or save it.',
    ],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
  },
  conditionMissing: {
    title: 'Type your condition in the search box',
    body: [
      'Look for the box labelled Condition/disease near the top of the page. Type your illness or symptoms there, then use the site’s Search button.',
      'What you type is sent to ClinicalTrials.gov as a normal site search. Treatable does not read or save it.',
    ],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
  },
  filtersOffer: {
    title: 'Want help choosing filters?',
    body: [
      'Filters can narrow the list to studies that are looking for people now, and to studies that test a treatment.',
      'I can show you two of them. You tick the boxes yourself.',
    ],
    next: 'Yes, show me',
    back: 'No thanks',
    skip: 'Skip',
  },
  searchIntro: {
    title: 'Find studies that are looking for people',
    body: [
      'This short guide points out two filters on this page.',
      'Recruiting keeps studies that are open to new participants right now. Interventional keeps studies that test a treatment.',
      'You tick the boxes yourself. I only point at them.',
    ],
    next: 'Start',
    skip: 'Skip',
  },
  status: {
    title: 'Tick “Recruiting”',
    body: ['Under Study Status, tick the highlighted Recruiting box. This keeps studies that are looking for participants right now.'],
    skip: 'Skip',
  },
  statusDone: {
    title: 'Recruiting is already ticked',
    body: ['Good. The list already shows only studies that are looking for participants.'],
    next: 'Next',
    skip: 'Skip',
  },
  type: {
    title: 'Tick “Interventional”',
    body: [
      'Under Study Type, tick the highlighted Interventional box if you are looking for studies that test a treatment.',
      'Interventional studies test a treatment or other intervention. Observational studies watch what happens without giving a treatment.',
      'This is not medical advice. Ask your own doctor which kind of study suits you.',
    ],
    back: 'Back',
    skip: 'Skip',
  },
  typeDone: {
    title: 'Interventional is already ticked',
    body: ['Good. The list already shows only studies that test a treatment or other intervention.'],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
  },
  openFilters: {
    title: 'Open the filters first',
    body: ['Some of the search boxes and filters are hidden right now. Use the highlighted button to open them. I will carry on as soon as they show.'],
    skip: 'Skip',
  },
  openFiltersNoButton: {
    title: 'Open the filters first',
    body: ['Some of the search boxes and filters are hidden right now. Look for a button named Focus Your Search, Filters or Show and open it. I will carry on as soon as they show.'],
    skip: 'Skip',
  },
  statusMissing: {
    title: 'Find “Recruiting” yourself',
    body: [
      'I could not find that box. The website may have changed.',
      'Look for the Study Status list and tick Recruiting yourself. It keeps studies that are looking for participants.',
    ],
    next: 'Next',
    skip: 'Skip',
  },
  typeMissing: {
    title: 'Find “Interventional” yourself',
    body: [
      'I could not find that box. The website may have changed.',
      'Look for the Study Type list. Tick Interventional if you want studies that test a treatment.',
    ],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
  },
  applyFilters: {
    title: 'Press “Apply Filters”',
    body: [
      'Your filters are ticked. Press the highlighted Apply Filters button so ClinicalTrials.gov updates the list.',
      'The new results can take a moment to show.',
    ],
    next: 'Done',
    skip: 'Skip',
  },
  filtersDone: {
    title: 'All set',
    body: ['ClinicalTrials.gov is updating the results. It can take a moment.'],
  },
  results: {
    title: 'Open a study you are interested in',
    body: [
      'Choose a study from the list and open it. Then I will show you Treatable’s tools for that study.',
      'ClinicalTrials.gov updates the list after you search or press Apply Filters, which can take a moment. Opening a study only lets you read about it.',
    ],
    back: 'Back',
    skip: 'Skip',
  },
  understand: {
    title: 'Understand this study',
    body: [
      'This part reads the public record of the study you opened.',
      'It uses public study data from ClinicalTrials.gov, and it explains the study in plain language.',
    ],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
  },
  brief: {
    title: 'Generate study brief',
    body: [
      'You choose when to press this button. It sends only the public text of the study record and a few standard question topics to OpenAI. It does not send your name, contact details or answers.',
      'The brief lists what was used, under How this was generated.',
    ],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
  },
  personalize: {
    title: 'Personalize your email',
    body: [
      'This part is optional. You may type your own name, phone, reply email and best times.',
      'What you type stays on your device and goes only into the draft. It is not sent to OpenAI or saved as a profile.',
    ],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
  },
  draft: {
    title: 'Edit your email draft',
    body: [
      'Check who the email is for, then change the subject and message in any way you like.',
      'Your edits are kept for this study during this session.',
    ],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
  },
  draftMissing: {
    title: 'Your email draft appears here',
    body: [
      'Once a study contact is available, the draft shows up in this part. You can edit it before you use it.',
    ],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
  },
  send: {
    title: 'You send the email, not Treatable',
    body: [
      'Open draft in my email app hands your message to your own mail program. Copy message puts just the message on your clipboard, and Copy full email also adds the To and Subject lines.',
      'Treatable never sends the email. You read it and press Send yourself.',
    ],
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
  },
  done: {
    title: 'You are ready',
    body: [
      'You can run this tour again with Replay intro whenever you like.',
      'Treatable gives information, not medical advice. A study team can answer questions about whether a study is right for you.',
    ],
    next: 'Finish',
    back: 'Back',
  },
} as const satisfies Record<string, StepCopy>;
