import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  trackLead,
  trackLeadConfirmed,
  trackScreenerBack,
  trackScreenerError,
  trackScreenerStep,
} from '../lib/analytics';
import './GetStarted.css';

type Step =
  | {
      key: string;
      title: string;
      sub: string;
      type: 'choice';
      /**
       * `value` is stored in the Care lead intake record. It is paired with
       * the label here so rewording a question cannot silently change the
       * data written downstream.
       */
      options: { label: string; value: string }[];
      hasHelp?: boolean;
    }
  | {
      key: string;
      title: string;
      sub: string;
      type: 'text';
      placeholder: string;
      rows: number;
      max: number;
      min: number;
    }
  | {
      key: string;
      title: string;
      sub: string;
      type: 'intro';
      /** Spoken by Maya in a bubble above the heading. */
      greeting: string;
      greetingStrong: string;
      points: string[];
    }
  | { key: string; title: string; sub: string; type: 'interstitial' }
  | { key: string; title: string; sub: string; type: 'note'; note: string }
  | { key: string; title: string; sub: string; type: 'contact' };

const STEPS: Step[] = [
  {
    key: 'intro',
    title: 'Let us find what you are owed.',
    sub: 'A few short questions about your health, the work you used to do, and how to reach you. Answer in your own words. There are no wrong answers here, and nothing is sent until the very last step.',
    type: 'intro',
    greeting:
      'Hi, I am Maya, one of the advocates here. We will work out what you qualify for, then sort out how to claim it.',
    greetingStrong: 'It takes about two minutes.',
    points: [
      'Free, with no obligation and no payment details.',
      'A real person reads every answer, and many of us on this team live with disabilities too.',
      'We never sell your information.',
    ],
  },
  {
    key: 'applied',
    title: 'Have you applied for Social Security Disability before?',
    sub: 'Wherever you are in the process, whether first try, denied, or mid-appeal, there is a path from here.',
    type: 'choice',
    hasHelp: true,
    options: [
      { label: 'No, this is my first time', value: 'first_time' },
      { label: 'Yes, and I was denied', value: 'denied' },
      { label: "Yes, I'm appealing right now", value: 'appealing' },
      { label: "I'm not sure", value: 'not_sure' },
    ],
  },
  {
    key: 'attorney',
    title: 'Is a lawyer or representative already helping with this claim?',
    sub: 'We have to ask. If someone already represents you, we are not allowed to contact you about your claim.',
    type: 'choice',
    options: [
      { label: 'No, nobody is representing me', value: 'no' },
      { label: 'Yes, I already have someone', value: 'yes' },
      { label: "I'm not sure", value: 'not_sure' },
    ],
  },
  {
    key: 'conditions',
    title: 'What health conditions are you dealing with?',
    sub: 'Write it in your own words. Plain language is fine. You do not need the diagnosis code, and nothing you say here gets judged. Far more conditions qualify than people think, including mental health and chronic pain.',
    type: 'text',
    placeholder: 'e.g. back injury, depression, vision loss, chronic fatigue…',
    rows: 4,
    max: 500,
    min: 10,
  },
  {
    key: 'doctors',
    title: 'Are you currently seeing doctors for this?',
    sub: 'Honest answer, please. This is not a test. It just tells us how much of your story is already on paper.',
    type: 'choice',
    options: [
      { label: 'Yes, regularly', value: 'regularly' },
      { label: 'Sometimes, when I can', value: 'sometimes' },
      { label: 'Not right now, care has not been easy to get', value: 'not_easy' },
      { label: 'No', value: 'no' },
    ],
  },
  {
    key: 'denials',
    title:
      'Two out of three first applications get denied, usually over paperwork, not health.',
    sub: 'That is not an accident, and it has never been your fault. The system was built to wear people down. We were built by people who have been worn down by it, and got up anyway.',
    type: 'interstitial',
  },
  {
    key: 'lastWork',
    title: 'When were you last able to work?',
    sub: 'However long it has been, that is information, not a verdict.',
    type: 'choice',
    options: [
      { label: "I'm still working, but struggling", value: 'still_working' },
      { label: 'Within the last 6 months', value: 'within_6mo' },
      { label: '6 months to a year ago', value: '6mo_to_1yr' },
      { label: 'More than a year ago', value: 'over_1yr' },
      { label: "I've never been able to work", value: 'never' },
    ],
  },
  {
    key: 'job',
    title: 'What kind of work did you do?',
    sub: "Your job's demands, physical and mental, are a big part of your claim. What you could no longer do matters as much as what is wrong.",
    type: 'text',
    placeholder: 'e.g. warehouse worker, teacher, home health aide…',
    rows: 1,
    max: 100,
    min: 3,
  },
  {
    key: 'paidIn',
    title: 'You paid into this with every paycheck. It is not charity. It is yours.',
    sub: 'You may even be owed back benefits from when your health problems began. Claiming them is not asking for a favor. It is collecting a debt.',
    type: 'note',
    note: 'You may be owed benefits dating back to when your health problems started.',
  },
  {
    key: 'contact',
    title: 'Last step: how should we reach you?',
    sub: 'A real person follows up, and many of us on this team live with disabilities too. Free, no obligation, and you set the pace.',
    type: 'contact',
  },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function GetStarted() {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [helpOpen, setHelpOpen] = useState(false);
  const [contact, setContact] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isIntro = step.type === 'intro';
  // The intro is a welcome screen, not a step, so it sits at 0% and the bar
  // fills across the steps that actually ask something.
  const stepCount = STEPS.length - 1;
  const progress = isIntro ? 0 : Math.round((stepIndex / stepCount) * 100);

  useEffect(() => {
    trackScreenerStep(stepIndex, step.key, STEPS.length - 1);
    // step.key is derived from stepIndex, so the index alone is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (step.type === 'choice' && !answers[step.key]) {
      next.choice = 'Please select an option to continue.';
    }
    if (step.type === 'text') {
      const val = texts[step.key] || '';
      if (val.trim().length < step.min) {
        next.text = `Please enter at least ${step.min} characters.`;
      }
    }
    if (step.type === 'contact') {
      if (!contact.firstName.trim()) next.firstName = 'First name is required.';
      if (!contact.lastName.trim()) next.lastName = 'Last name is required.';
      if (!contact.email.trim()) next.email = 'Email is required.';
      else if (!EMAIL_RE.test(contact.email.trim())) next.email = 'Enter a valid email address.';
    }
    return next;
  }

  async function submit() {
    setSubmitting(true);
    setSubmitFailed(false);
    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The endpoint confirms only after the backend has created the lead.
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          form: 'get_started',
          ...answers,
          ...texts,
          firstName: contact.firstName.trim(),
          lastName: contact.lastName.trim(),
          email: contact.email.trim(),
          phone: contact.phone.trim(),
          countryCode: '+1',
          smsConsent,
        }),
      });
      if (!res.ok) throw new Error(`lead endpoint returned ${res.status}`);
      // Separate from the Lead fired on the button, so a completed submission
      // is not counted twice under one name.
      trackLeadConfirmed('get_started');
      setSubmitted(true);
    } catch {
      // Surface the failure instead of showing a confirmation for a lead that
      // never arrived. Their answers stay on screen so retrying costs nothing.
      setSubmitFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    if (submitting) return;
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      Object.keys(validationErrors).forEach((field) =>
        trackScreenerError(stepIndex, step.key, field),
      );
      return;
    }
    setErrors({});
    if (isLast) {
      // On the button, once validation has passed. Firing on a click that only
      // surfaced "First name is required" would report a lead that never was.
      trackLead('get_started');
      void submit();
      return;
    }
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
    setHelpOpen(false);
    window.scrollTo(0, 0);
  }

  function goBack() {
    if (stepIndex === 0) return;
    trackScreenerBack(stepIndex, step.key);
    setErrors({});
    setStepIndex((i) => Math.max(0, i - 1));
    setHelpOpen(false);
    window.scrollTo(0, 0);
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    goNext();
  }

  if (submitted) {
    return (
      <div className="screener">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
        <header className="screener-header">
          <Link to="/" className="logo-link">
            <img src="/assets/samora-logo.svg" alt="Samora AI" />
          </Link>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: '100%' }} />
          </div>
        </header>
        <main id="main" className="screener-main">
          <div className="screener-content">
            <h1 className="screener-h1">An advocate will reach out today.</h1>
            <p className="screener-sub">
              Thank you, {contact.firstName || 'there'}. We have your answers and someone from our
              team will follow up the way you prefer, call, text, or email, usually the same day.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="screener">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="screener-header">
        <Link to="/" className="logo-link">
          <img src="/assets/samora-logo.svg" alt="Samora AI" />
        </Link>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={isIntro ? 'Not started' : `Step ${stepIndex} of ${stepCount}`}
        >
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {isIntro ? 'Introduction' : `Step ${stepIndex} of ${stepCount}`}
        </span>
      </header>

      <main id="main" className="screener-main">
        <form className="screener-content" onSubmit={handleFormSubmit}>
          {step.type === 'intro' && (
            <div className="intro-greeting">
              <img
                className="intro-avatar"
                src="/assets/maya-portrait.jpg"
                width={240}
                height={204}
                alt="Maya, benefits advocate"
              />
              <div className="intro-bubble">
                <span className="intro-bubble-name">Maya · benefits advocate</span>
                <p className="intro-bubble-text">
                  {step.greeting} <strong>{step.greetingStrong}</strong>
                </p>
              </div>
            </div>
          )}

          <h1 className="screener-h1">{step.title}</h1>
          <p className="screener-sub">{step.sub}</p>

          {step.type === 'choice' && (
            <>
              <fieldset className="option-fieldset">
                <legend className="option-legend">{step.title}</legend>
                {step.options.map((option) => {
                  const selected = answers[step.key] === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`option-row${selected ? ' option-row--selected' : ''}`}
                    >
                      <input
                        type="radio"
                        className="option-radio"
                        name={step.key}
                        value={option.value}
                        checked={selected}
                        onChange={() =>
                          setAnswers((a) => ({ ...a, [step.key]: option.value }))
                        }
                      />
                      <span className="option-label">{option.label}</span>
                    </label>
                  );
                })}
              </fieldset>
              {errors.choice && (
                <p className="field-error" role="alert">
                  {errors.choice}
                </p>
              )}
            </>
          )}

          {step.type === 'text' && (
            <div className="text-step">
              <label className="option-legend" htmlFor={`text-${step.key}`}>
                {step.title}
              </label>
              <textarea
                id={`text-${step.key}`}
                placeholder={step.placeholder}
                rows={step.rows}
                maxLength={step.max}
                value={texts[step.key] || ''}
                onChange={(e) =>
                  setTexts((t) => ({ ...t, [step.key]: e.target.value }))
                }
                aria-invalid={Boolean(errors.text)}
              />
              <span className="text-counter">
                {(texts[step.key] || '').length} / {step.max} (min {step.min})
              </span>
              {errors.text && (
                <p className="field-error" role="alert">
                  {errors.text}
                </p>
              )}
            </div>
          )}

          {step.type === 'intro' && (
            <ul className="intro-points">
              {step.points.map((point) => (
                <li key={point}>
                  <span className="intro-dot" aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          )}

          {step.type === 'note' && (
            <div className="note-card">
              <span className="note-dot" aria-hidden="true" />
              <span className="note-text">{step.note}</span>
            </div>
          )}

          {step.type === 'contact' && (
            <div className="contact-step">
              <div className="contact-name-grid">
                <div className="contact-field">
                  <label htmlFor="firstName">First name</label>
                  <input
                    id="firstName"
                    placeholder="First name"
                    value={contact.firstName}
                    onChange={(e) => setContact((c) => ({ ...c, firstName: e.target.value }))}
                    aria-invalid={Boolean(errors.firstName)}
                  />
                  {errors.firstName && (
                    <span className="field-error" role="alert">
                      {errors.firstName}
                    </span>
                  )}
                </div>
                <div className="contact-field">
                  <label htmlFor="lastName">Last name</label>
                  <input
                    id="lastName"
                    placeholder="Last name"
                    value={contact.lastName}
                    onChange={(e) => setContact((c) => ({ ...c, lastName: e.target.value }))}
                    aria-invalid={Boolean(errors.lastName)}
                  />
                  {errors.lastName && (
                    <span className="field-error" role="alert">
                      {errors.lastName}
                    </span>
                  )}
                </div>
              </div>
              <div className="contact-field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={contact.email}
                  onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                  aria-invalid={Boolean(errors.email)}
                />
                {errors.email && (
                  <span className="field-error" role="alert">
                    {errors.email}
                  </span>
                )}
              </div>
              <div className="contact-field">
                <label htmlFor="phone">Phone number</label>
                <div className="phone-field">
                  <span className="phone-prefix">+1</span>
                  <input
                    id="phone"
                    type="tel"
                    placeholder="555 123 4567"
                    value={contact.phone}
                    onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
                  />
                </div>
                <span className="contact-helper">
                  We never sell your information. And if phone calls are hard for you, they are
                  not required. Tell us you would rather text or email, and that is what we will
                  do.
                </span>
              </div>

              {/*
                Consent must be a deliberate act, so this starts unticked and is
                never required to submit. Carriers ask to see the disclosure at
                the point of collection, which is why the rates, frequency, and
                opt-out wording sit here rather than only in the terms.
              */}
              <label className="sms-consent">
                <input
                  type="checkbox"
                  className="sms-consent-box"
                  checked={smsConsent}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                />
                <span className="sms-consent-text">
                  I agree to receive text messages from SamoraCare about my benefits claim at the
                  number above. Message and data rates may apply. Up to 4 messages per month. Reply{' '}
                  <strong>STOP</strong> to opt out or <strong>HELP</strong> for help. Consent is not
                  a condition of any purchase. See our{' '}
                  <Link to="/terms-and-conditions" target="_blank" rel="noopener noreferrer">
                    Terms
                  </Link>{' '}
                  and{' '}
                  <Link to="/privacy-policy" target="_blank" rel="noopener noreferrer">
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>

            </div>
          )}

          {submitFailed && (
            <p className="submit-error" role="alert">
              We could not send your answers just now. Nothing you entered was lost, please
              press Submit again. If it keeps failing, email us at{' '}
              <a href="mailto:hello@samoracare.com">hello@samoracare.com</a> and we will pick
              it up from there.
            </p>
          )}

          {step.type === 'choice' && step.hasHelp && (
            <div className="help-disclosure">
              <button
                type="button"
                className="help-toggle"
                aria-expanded={helpOpen}
                onClick={() => setHelpOpen((v) => !v)}
              >
                Not sure? <span className="caret">{helpOpen ? '▲' : '▼'}</span>
              </button>
              {helpOpen && (
                <p className="help-body">
                  SSDI, SSI, or "government disability" all count. VA disability and private
                  insurance do not. If you are still unsure, pick "I'm not sure" and we will
                  figure it out together.
                </p>
              )}
            </div>
          )}
        </form>
      </main>

      <footer className="screener-footer">
        <button
          type="button"
          className="back-btn"
          onClick={goBack}
          disabled={stepIndex === 0 || submitting}
        >
          ‹ Back
        </button>
        <button
          type="button"
          className="next-btn"
          onClick={goNext}
          disabled={submitting}
        >
          {submitting && <span className="btn-spinner" aria-hidden="true" />}
          {isIntro ? 'Start' : isLast ? (submitting ? 'Sending' : 'Submit') : 'Next'}
        </button>
      </footer>
    </div>
  );
}
