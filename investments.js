/**
 * Investment plans + interest math for Gweno.
 *
 * Interest is simple, pro-rated over a 365-day year:
 *   interest = principal * (rate / 100) * (days / 365)
 * This matches the in-app calculator (e.g. 50,000 @ 12% for 180 days ≈ 2,959 KES).
 * The plan sets both the annual rate and the lock period (duration).
 *
 * Amounts are in USD. Admins can override the annual rate per plan (see server.js
 * investmentRates); existing investments keep the rate they were opened at.
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const PLANS = [
  {
    id: 'starter', name: 'Starter Plan', min: 10, max: 50, rate: 10, days: 30,
    blurb: 'Low-risk entry plan — ideal for first-time investors.',
  },
  {
    id: 'growth', name: 'Growth Plan', min: 51, max: 100, rate: 15, days: 180,
    blurb: 'Balanced medium-term growth over six months.',
  },
  {
    id: 'premium', name: 'Premium Plan', min: 101, max: 500, rate: 20, days: 365,
    blurb: 'Maximum returns over a full year for serious investors.',
  },
];

// Apply admin rate overrides ({ starter: 6, growth: 13, ... }) on top of the defaults.
function plans(rates) {
  return PLANS.map((p) => ({
    ...p,
    rate: rates && rates[p.id] != null ? Number(rates[p.id]) : p.rate,
  }));
}

function byId(id, rates) {
  return plans(rates).find((p) => p.id === id) || null;
}

function computeInterest(principal, rate, days) {
  return round2((Number(principal) || 0) * ((Number(rate) || 0) / 100) * ((Number(days) || 0) / 365));
}

module.exports = { PLANS, plans, byId, computeInterest, round2 };
