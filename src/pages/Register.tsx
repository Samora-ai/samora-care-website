import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  trackFormError,
  trackFormStart,
  trackFormView,
  trackLead,
  trackLeadConfirmed,
} from '../lib/analytics';
import { US_STATES } from '../data/usStates';
import './Register.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOB_RE = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(19|20)\d{2}$/;

type YesNo = '' | 'yes' | 'no';

/** The attorney question needs a third answer that yes/no cannot express. */
type Attorney = 'yes' | 'no' | 'not_sure' | '';

interface Form {
  inquiringFor: string;
  fullName: string;
  email: string;
  phone: string;
  state: string;
  dob: string;
  receivingBenefits: YesNo;
  owesOverpayment: YesNo;
  healthConditions: YesNo;
  hasAttorney: Attorney;
}

const EMPTY: Form = {
  inquiringFor: '',
  fullName: '',
  email: '',
  phone: '',
  state: '',
  dob: '',
  receivingBenefits: '',
  owesOverpayment: '',
  healthConditions: '',
  hasAttorney: '',
};

/**
 * Yes/No pair as real radios in a labelled group, so the question is announced
 * with its answers rather than as two loose controls.
 */
const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

/**
 * Radio pair by default. `choices` is only passed by the attorney question,
 * which needs a third answer: forcing that one into yes/no would push anyone
 * unsure into guessing, and a wrong "no" there is the answer that matters.
 */
function ChoiceField<T extends string>({
  name,
  legend,
  help,
  value,
  error,
  onChange,
  choices = YES_NO,
}: {
  name: string;
  legend: string;
  help?: string;
  value: T | '';
  error?: string;
  onChange: (v: T) => void;
  choices?: readonly { value: string; label: string }[];
}) {
  return (
    <fieldset className="reg-field reg-field--yesno">
      <legend className="reg-label">{legend}</legend>
      {help && <p className="reg-help">{help}</p>}
      <div className="reg-yesno">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={`reg-radio${value === choice.value ? ' reg-radio--on' : ''}`}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={value === choice.value}
              onChange={() => onChange(choice.value as T)}
              aria-invalid={Boolean(error)}
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
      {error && (
        <span className="reg-error" role="alert">
          {error}
        </span>
      )}
    </fieldset>
  );
}

export default function Register() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);

  // Once per mount, so the funnel has a reliable first step that does not
  // depend on how the visitor got here.
  useEffect(() => {
    trackFormView('register');
  }, []);

  useEffect(() => {
    const previous = document.title;
    document.title = 'Check if you pre qualify for Social Security';
    return () => {
      document.title = previous;
    };
  }, []);

  // Fires once, on the first field anyone touches. Without it, an abandoned
  // form leaves no trace at all — there are no per-step events here to fall
  // back on the way the screener has.
  const started = useRef(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    if (!started.current) {
      started.current = true;
      trackFormStart('register');
    }
    setForm((f) => ({ ...f, [key]: value }));
  };

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!form.inquiringFor) e.inquiringFor = 'Please tell us who this is for.';
    if (!form.fullName.trim()) e.fullName = 'Your name is required.';
    if (!form.email.trim()) e.email = 'Email is required.';
    else if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email address.';
    if (!form.state) e.state = 'Please choose where you live.';
    if (!form.dob.trim()) e.dob = 'Date of birth is required.';
    else if (!DOB_RE.test(form.dob.trim())) e.dob = 'Use MM/DD/YYYY, for example 04/09/1971.';
    if (!form.receivingBenefits) e.receivingBenefits = 'Please choose Yes or No.';
    if (!form.owesOverpayment) e.owesOverpayment = 'Please choose Yes or No.';
    if (!form.healthConditions) e.healthConditions = 'Please choose Yes or No.';
    if (!form.hasAttorney) e.hasAttorney = 'Please choose one.';
    return e;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      Object.keys(found).forEach((field) => trackFormError('register', field));
      // Send focus to the first problem so a screen reader lands on it.
      const first = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus();
      return;
    }

    trackLead('register');
    setSubmitting(true);
    setSubmitFailed(false);
    try {
      // The shared Pages endpoint routes this explicitly tagged shape through
      // the retained Apps Script/email flow; the eligibility screener uses the
      // backend lead-ingestion branch instead.
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          // Tells the endpoint which shape this is; the screener sends none.
          form: 'register',
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          countryCode: '+1',
          inquiringFor: form.inquiringFor,
          state: form.state,
          dob: form.dob.trim(),
          receivingBenefits: form.receivingBenefits,
          owesOverpayment: form.owesOverpayment,
          healthConditions: form.healthConditions,
          hasAttorney: form.hasAttorney,
          smsConsent: smsConsent ? 'yes' : 'no',
        }),
      });
      if (!res.ok) throw new Error(`lead endpoint returned ${res.status}`);
      trackLeadConfirmed('register');
      setSubmitted(true);
    } catch {
      setSubmitFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="reg">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <aside className="reg-aside">
        <Link to="/" className="reg-logo">
          <img src="/assets/samora-logo.svg" width={1382} height={247} alt="Samora Care" />
        </Link>
        <div className="reg-aside-body">
          <h1 className="reg-h1">See if you pre-qualify for disability benefits.</h1>
          <p className="reg-lede">
            One short form. A real advocate reads every answer and follows up the way you prefer,
            usually the same day.
          </p>
        </div>
        <ul className="reg-trust">
          <li>Free, with no obligation and no payment details</li>
          <li>Disability owned and led</li>
          <li>We never sell your information</li>
        </ul>
      </aside>

      <main id="main" className="reg-main">
        {submitted ? (
          <div className="reg-done">
            <h2 className="reg-done-h2">An advocate will reach out today.</h2>
            <p>
              Thank you, {form.fullName.split(' ')[0] || 'there'}. We have your answers. Someone
              from our team will follow up by phone, text or email, whichever you prefer, usually
              the same day.
            </p>
            <p>
              If you would rather not wait, call us on{' '}
              <a href="tel:+12537665260">(253) 766-5260</a>.
            </p>
          </div>
        ) : (
          <form className="reg-form" onSubmit={handleSubmit} noValidate>
            <section className="reg-section">
              <h2 className="reg-h2">Contact info</h2>

              <div className="reg-field">
                <label className="reg-label" htmlFor="reg-inquiring">
                  Are you asking for yourself or someone else?
                </label>
                <select
                  id="reg-inquiring"
                  value={form.inquiringFor}
                  onChange={(e) => set('inquiringFor', e.target.value)}
                  aria-invalid={Boolean(errors.inquiringFor)}
                >
                  <option value="">Choose one</option>
                  <option value="myself">Myself</option>
                  <option value="family_or_friend">A family member or friend</option>
                  <option value="client">A patient or client</option>
                </select>
                {errors.inquiringFor && (
                  <span className="reg-error" role="alert">
                    {errors.inquiringFor}
                  </span>
                )}
              </div>

              <div className="reg-field">
                <label className="reg-label" htmlFor="reg-name">
                  Full name
                </label>
                <input
                  id="reg-name"
                  autoComplete="name"
                  value={form.fullName}
                  onChange={(e) => set('fullName', e.target.value)}
                  aria-invalid={Boolean(errors.fullName)}
                />
                {errors.fullName && (
                  <span className="reg-error" role="alert">
                    {errors.fullName}
                  </span>
                )}
              </div>

              <div className="reg-field">
                <label className="reg-label" htmlFor="reg-email">
                  Email address
                </label>
                <input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  aria-invalid={Boolean(errors.email)}
                />
                {errors.email && (
                  <span className="reg-error" role="alert">
                    {errors.email}
                  </span>
                )}
              </div>

              <div className="reg-field">
                <label className="reg-label" htmlFor="reg-phone">
                  Phone number <span className="reg-optional">optional</span>
                </label>
                <div className="phone-field">
                  <span className="phone-prefix">+1</span>
                  <input
                    id="reg-phone"
                    type="tel"
                    autoComplete="tel-national"
                    placeholder="555 123 4567"
                    value={form.phone}
                    onChange={(e) => set('phone', e.target.value)}
                  />
                </div>
              </div>

              <div className="reg-field">
                <label className="reg-label" htmlFor="reg-state">
                  Where do you live?
                </label>
                <select
                  id="reg-state"
                  value={form.state}
                  onChange={(e) => set('state', e.target.value)}
                  aria-invalid={Boolean(errors.state)}
                >
                  <option value="">Choose your state</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {errors.state && (
                  <span className="reg-error" role="alert">
                    {errors.state}
                  </span>
                )}
              </div>
            </section>

            <section className="reg-section">
              <h2 className="reg-h2">General eligibility</h2>
              <p className="reg-section-lede">
                Social Security only offers these benefits to certain groups. These few questions
                tell us which door is open to you. There are no wrong answers.
              </p>

              <div className="reg-field">
                <label className="reg-label" htmlFor="reg-dob">
                  Your date of birth
                </label>
                <input
                  id="reg-dob"
                  inputMode="numeric"
                  autoComplete="bday"
                  placeholder="MM/DD/YYYY"
                  value={form.dob}
                  onChange={(e) => set('dob', e.target.value)}
                  aria-invalid={Boolean(errors.dob)}
                  aria-describedby="reg-dob-help"
                />
                <p className="reg-help" id="reg-dob-help">
                  Your age affects which benefits you qualify for, which is why we ask.
                </p>
                {errors.dob && (
                  <span className="reg-error" role="alert">
                    {errors.dob}
                  </span>
                )}
              </div>

              <ChoiceField
                name="receivingBenefits"
                legend="Are you currently receiving any type of Social Security benefit?"
                help="That includes SSDI, SSI, early retirement, or survivor benefits."
                value={form.receivingBenefits}
                error={errors.receivingBenefits}
                onChange={(v) => set('receivingBenefits', v)}
              />

              <ChoiceField
                name="owesOverpayment"
                legend="Do you owe money to Social Security for an overpayment of disability benefits?"
                help="If you do, it does not disqualify you. Contact SSA directly and they can set up a repayment plan or a review, and we can help you understand it."
                value={form.owesOverpayment}
                error={errors.owesOverpayment}
                onChange={(v) => set('owesOverpayment', v)}
              />

              <ChoiceField
                name="healthConditions"
                legend="Are there health conditions, disabilities, or mental health concerns that affect your daily life?"
                help="Far more conditions qualify than people expect, including mental health and chronic pain."
                value={form.healthConditions}
                error={errors.healthConditions}
                onChange={(v) => set('healthConditions', v)}
              />

              <ChoiceField
                name="hasAttorney"
                legend="Is a lawyer or representative already helping with this claim?"
                help="We have to ask. If someone already represents you, we are not allowed to contact you about your claim."
                value={form.hasAttorney}
                error={errors.hasAttorney}
                onChange={(v) => set('hasAttorney', v)}
                choices={[
                  { value: 'no', label: 'No' },
                  { value: 'yes', label: 'Yes' },
                  { value: 'not_sure', label: 'Not sure' },
                ]}
              />
            </section>

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
                <strong>STOP</strong> to opt out or <strong>HELP</strong> for help. Consent is not a
                condition of any purchase. See our{' '}
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

            {submitFailed && (
              <p className="reg-submit-error" role="alert">
                We could not send your answers just now. Nothing you entered was lost, please press
                Submit again. If it keeps failing, call{' '}
                <a href="tel:+12537665260">(253) 766-5260</a> or email{' '}
                <a href="mailto:team@samoracare.com">team@samoracare.com</a>.
              </p>
            )}

            <button type="submit" className="reg-submit" disabled={submitting}>
              {submitting && <span className="btn-spinner" aria-hidden="true" />}
              {submitting ? 'Sending' : 'See if I pre-qualify'}
            </button>

            <p className="reg-fineprint">
              Submitting this form does not create an attorney-client relationship and does not
              guarantee approval or any particular outcome.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
