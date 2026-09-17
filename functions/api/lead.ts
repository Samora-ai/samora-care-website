/**
 * Receives both public form shapes:
 * - the eligibility screener is validated then persisted through the public
 *   Samora backend API;
 * - the unrelated Register form retains its existing Apps Script delivery.
 */

interface Env {
  /** Existing Apps Script endpoint used only by the Register form. */
  LEAD_ENDPOINT: string;
  LEADS: KVNamespace;
  /**
   * Optional shared secret for the Apps Script endpoint. That endpoint has to be
   * world-reachable — Cloudflare calls it without a Google identity — so this is
   * what stops anyone who learns the URL posting fake leads. Absent, nothing is
   * sent and the script accepts unauthenticated posts, so the two can be rolled
   * out in either order.
   */
  LEAD_TOKEN?: string;
  /** Public backend endpoint for the eligibility screener. */
  CARE_LEAD_ENDPOINT?: string;
}

/**
 * Apps Script needs a second or more just to acknowledge a request, and longer
 * again to write the row. Waiting on it before answering the browser put that
 * delay in front of someone who had already finished the form, so the lead is
 * recorded in KV first and forwarded after the response goes out.
 */
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Per-attempt timeouts, and the pauses between them.
 *
 * A freshly created Apps Script deployment can take longer than ten seconds to
 * answer its very first request. With no pause between attempts, all three
 * landed inside that same cold start, every one timed out, and the lead was
 * left in KV marked undelivered. Later attempts get longer, and the pauses mean
 * a retry actually samples a different moment rather than repeating the first
 * one immediately. The whole sequence has to finish inside the time the runtime
 * allows after the response has already gone out, which is what caps it here.
 */
const ATTEMPT_TIMEOUTS_MS = [6_000, 8_000, 8_000];
const RETRY_PAUSES_MS = [1_000, 2_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Field names the existing Register Sheet columns expect. */
type SheetPayload = RegisterPayload;

/** The register form at /register. */
interface RegisterPayload {
  type: 'register';
  /** Stable id for this submission, so a retry cannot create a second row. */
  lead_id: string;
  fullName: string;
  email: string;
  phone: string;
  countryCode: string;
  inquiring_for: string;
  state: string;
  date_of_birth: string;
  receiving_benefits: string;
  owes_overpayment: string;
  health_conditions: string;
  has_attorney: string;
  sms_consent: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function buildRegister(body: Record<string, unknown>, leadId: string): RegisterPayload | null {
  const fullName = str(body.fullName, 200);
  const email = str(body.email, 200);
  // Same rule as the screener: the client can be bypassed, and a lead we cannot
  // follow up on is worse than no lead.
  if (!fullName || !EMAIL_RE.test(email)) return null;

  return {
    type: 'register',
    lead_id: leadId,
    fullName,
    email,
    phone: str(body.phone, 40),
    countryCode: str(body.countryCode, 8) || '+1',
    inquiring_for: str(body.inquiringFor, 40),
    state: str(body.state, 60),
    date_of_birth: str(body.dob, 12),
    receiving_benefits: str(body.receivingBenefits, 4),
    owes_overpayment: str(body.owesOverpayment, 4),
    health_conditions: str(body.healthConditions, 4),
    has_attorney: str(body.hasAttorney, 10),
    sms_consent: body.smsConsent === 'yes' ? 'yes' : 'no',
  };
}

async function forward(
  endpoint: string,
  payload: SheetPayload,
  token?: string,
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
): Promise<boolean> {
  // Apps Script reads the raw body via e.postData.contents and parses it
  // itself, so the content type stays text/plain as it was originally.
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(token ? { ...payload, token } : payload),
    // Without this a hung upstream holds the request open indefinitely.
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.ok;
}

/**
 * Runs after the response has been sent. Marks the stored lead as delivered so
 * anything still flagged pending in KV is a lead that needs chasing by hand.
 */
async function deliver(env: Env, key: string, payload: SheetPayload): Promise<void> {
  for (let attempt = 1; attempt <= ATTEMPT_TIMEOUTS_MS.length; attempt++) {
    // Pause before every attempt after the first, so a cold or briefly
    // overloaded upstream gets a chance to become ready.
    if (attempt > 1) await sleep(RETRY_PAUSES_MS[attempt - 2]);
    try {
      const timeout = ATTEMPT_TIMEOUTS_MS[attempt - 1];
      if (await forward(env.LEAD_ENDPOINT, payload, env.LEAD_TOKEN, timeout)) {
        try {
          await env.LEADS.put(key, JSON.stringify({ ...payload, delivered: true }));
        } catch (err) {
          // The row landed in the Sheet, which is what matters. Losing the
          // flag only costs accuracy in the pending-leads audit.
          console.error(`lead: delivered but could not update ${key}`, err);
        }
        return;
      }
      // Never log the payload itself — it is health and contact information.
      console.error(`lead: upstream rejected ${key} (attempt ${attempt}/${ATTEMPT_TIMEOUTS_MS.length})`);
    } catch (err) {
      console.error(`lead: upstream failed for ${key} (attempt ${attempt}/${ATTEMPT_TIMEOUTS_MS.length})`, err);
    }
  }
  console.error(`lead: giving up on ${key}; it stays pending in KV for recovery`);
}

const APPLICATION_STATUSES = new Set(['first_time', 'denied', 'appealing', 'not_sure']);
const REPRESENTATION_STATUSES = new Set(['yes', 'no', 'not_sure']);
const MEDICAL_CARE_STATUSES = new Set(['regularly', 'sometimes', 'not_easy', 'no']);
const LAST_WORK_STATUSES = new Set([
  'still_working',
  'within_6mo',
  '6mo_to_1yr',
  'over_1yr',
  'never',
]);

interface CareLeadPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone_number?: string;
  application_status: string;
  representation_status: string;
  health_conditions: string;
  medical_care_status: string;
  last_work_status: string;
  job_title: string;
  sms_consent: boolean;
}

function required(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= min && normalized.length <= max ? normalized : null;
}

function choice(value: unknown, allowed: Set<string>): string | null {
  const normalized = required(value, 1, 40)?.toLowerCase();
  return normalized && allowed.has(normalized) ? normalized : null;
}

function normalizeUSPhone(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw.length === 0) return undefined;
  if (!/^[+\d\s().-]+$/.test(raw)) return null;
  const compact = raw.replace(/[\s().-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  if (/^\d{10}$/.test(compact)) return `+1${compact}`;
  if (/^1\d{10}$/.test(compact)) return `+${compact}`;
  return null;
}

function buildScreener(body: Record<string, unknown>): CareLeadPayload | null {
  const firstName = required(body.firstName, 1, 100);
  const lastName = required(body.lastName, 1, 100);
  const email = required(body.email, 3, 254)?.toLowerCase();
  const applicationStatus = choice(body.applied, APPLICATION_STATUSES);
  const representationStatus = choice(body.attorney, REPRESENTATION_STATUSES);
  const healthConditions = required(body.conditions, 10, 500);
  const medicalCareStatus = choice(body.doctors, MEDICAL_CARE_STATUSES);
  const lastWorkStatus = choice(body.lastWork, LAST_WORK_STATUSES);
  let jobTitle = required(body.job, 3, 100);
  const phoneNumber = normalizeUSPhone(body.phone);

  if (lastWorkStatus === 'never' && !jobTitle) jobTitle = 'N/A - never worked';
  if (
    !firstName ||
    !lastName ||
    !email ||
    !EMAIL_RE.test(email) ||
    !applicationStatus ||
    !representationStatus ||
    !healthConditions ||
    !medicalCareStatus ||
    !lastWorkStatus ||
    !jobTitle ||
    phoneNumber === null
  ) {
    return null;
  }

  return {
    first_name: firstName,
    last_name: lastName,
    email,
    ...(phoneNumber ? { phone_number: phoneNumber } : {}),
    application_status: applicationStatus,
    representation_status: representationStatus,
    health_conditions: healthConditions,
    medical_care_status: medicalCareStatus,
    last_work_status: lastWorkStatus,
    job_title: jobTitle,
    sms_consent: body.smsConsent === true || body.smsConsent === 'yes',
  };
}

async function forwardScreener(
  env: Env,
  payload: CareLeadPayload,
): Promise<Response> {
  if (!env.CARE_LEAD_ENDPOINT) {
    console.error('lead: Care lead ingestion is not configured');
    return Response.json({ ok: false, error: 'not_configured' }, { status: 500 });
  }

  try {
    const response = await fetch(env.CARE_LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok) return Response.json({ ok: true });
    console.error(`lead: Care backend rejected submission (${response.status})`);
  } catch (error) {
    console.error('lead: Care backend request failed', error);
  }
  return Response.json({ ok: false, error: 'upstream' }, { status: 502 });
}

async function handleRegister(
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!env.LEAD_ENDPOINT) {
    console.error('lead: LEAD_ENDPOINT is not configured');
    return Response.json({ ok: false, error: 'not_configured' }, { status: 500 });
  }

  const leadId = crypto.randomUUID();
  const payload = buildRegister(body, leadId);
  if (!payload) {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  // Timestamp first so the key sorts chronologically when listing pending leads,
  // and it ends with the same id the Sheet row carries.
  const key = `lead:${new Date().toISOString()}:${leadId}`;

  try {
    await env.LEADS.put(key, JSON.stringify({ ...payload, delivered: false }));
  } catch (err) {
    // KV is the thing that makes an early confirmation honest. Without it,
    // fall back to forwarding inline rather than claiming a lead was captured.
    console.error('lead: KV write failed, forwarding inline instead', err);
    const ok = await forward(env.LEAD_ENDPOINT, payload, env.LEAD_TOKEN).catch(
      () => false,
    );
    return ok
      ? Response.json({ ok: true })
      : Response.json({ ok: false, error: 'upstream' }, { status: 502 });
  }

  waitUntil(deliver(env, key, payload));
  return Response.json({ ok: true });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'bad_json' }, { status: 400 });
  }

  if (body.form === 'register') {
    return handleRegister(env, waitUntil, body);
  }
  if (body.form !== 'get_started') {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }

  const payload = buildScreener(body);
  if (!payload) {
    return Response.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  return forwardScreener(env, payload);
};
