'use client';

import { useState } from 'react';

const WORKER = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:8000';

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  observer_org: string;
  inec_accreditation_id: string;
  states_covered: string;     // comma-separated input; split on submit
  language: 'en' | 'ha' | 'yo' | 'ig' | 'pcm';
}

const INITIAL: FormState = {
  full_name: '',
  email: '',
  phone: '',
  observer_org: '',
  inec_accreditation_id: '',
  states_covered: '',
  language: 'en',
};

export function ObserverRegistrationForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        ...form,
        states_covered: form.states_covered
          ? form.states_covered.split(',').map((s) => s.trim()).filter(Boolean)
          : null,
        inec_accreditation_id: form.inec_accreditation_id || null,
      };
      const r = await fetch(`${WORKER}/v1/observers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.detail?.message ?? j?.detail?.code ?? 'Registration failed.');
        return;
      }
      const j = await r.json();
      setSubmitted(j.data?.registration_id ?? j.registration_id ?? null);
      setForm(INITIAL);
    } catch (e: any) {
      setError(e?.message ?? 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="border border-green-200 bg-green-50 rounded p-5">
        <h2 className="font-semibold text-green-900">Submitted for review</h2>
        <p className="mt-2 text-sm text-green-800">
          The consortium governance committee will review your registration. You will be
          contacted by email once a decision is made (typically within 3 business days).
        </p>
        <p className="mt-2 text-xs text-green-700 font-mono">Reference: {submitted}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Full name" required>
        <input
          type="text"
          required
          value={form.full_name}
          onChange={(e) => set('full_name', e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
      </Field>
      <Field label="Email" required>
        <input
          type="email"
          required
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
      </Field>
      <Field label="Phone (any format - we normalise to E.164)" required>
        <input
          type="tel"
          required
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          className="w-full border rounded px-3 py-2"
          placeholder="08035550101 or +2348035550101"
        />
      </Field>
      <Field label="Observer organisation" required>
        <input
          type="text"
          required
          value={form.observer_org}
          onChange={(e) => set('observer_org', e.target.value)}
          className="w-full border rounded px-3 py-2"
          placeholder="e.g. Yiaga Africa, EU EOM, CDD-West Africa"
        />
      </Field>
      <Field label="INEC accreditation ID">
        <input
          type="text"
          value={form.inec_accreditation_id}
          onChange={(e) => set('inec_accreditation_id', e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
      </Field>
      <Field label="States covered (comma-separated; blank = nationwide)">
        <input
          type="text"
          value={form.states_covered}
          onChange={(e) => set('states_covered', e.target.value)}
          className="w-full border rounded px-3 py-2"
          placeholder="LA, KN, RI"
        />
      </Field>
      <Field label="Preferred language">
        <select
          value={form.language}
          onChange={(e) => set('language', e.target.value as FormState['language'])}
          className="w-full border rounded px-3 py-2"
        >
          <option value="en">English</option>
          <option value="ha">Hausa</option>
          <option value="yo">Yoruba</option>
          <option value="ig">Igbo</option>
          <option value="pcm">Nigerian Pidgin</option>
        </select>
      </Field>

      {error && (
        <p className="text-sm text-red-700 border border-red-200 bg-red-50 p-2 rounded">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-ng-green text-white py-3 rounded font-medium disabled:opacity-40"
      >
        {submitting ? 'Submitting…' : 'Submit for review'}
      </button>

      <p className="text-xs text-slate-500">
        Note: this form does not yet support direct file upload of the INEC accreditation
        document. Operators with the document should email it to consortium@openballot.ng
        and reference the registration ID returned on submit.
      </p>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
