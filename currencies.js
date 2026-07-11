/**
 * Country -> local currency, with an approximate USD conversion rate.
 *
 * Investments are denominated in USD (the one currency common to every country).
 * For display we ALSO show the amount in the investor's local currency, chosen
 * from the country they picked at sign-up. Rates are approximate and static —
 * good enough for an indicative "≈ KSh 1,290" beside the dollar figure; they are
 * NOT used for actual settlement (payments happen in USD / M-Pesa KES).
 *
 * Shape: countryName -> [ISO code, units-per-USD, display symbol].
 */
const MAP = {
  Kenya: ['KES', 129, 'KSh'],
  Uganda: ['UGX', 3700, 'USh'],
  Tanzania: ['TZS', 2550, 'TSh'],
  Rwanda: ['RWF', 1330, 'FRw'],
  Nigeria: ['NGN', 1600, '₦'],
  Ghana: ['GHS', 15, 'GH₵'],
  'South Africa': ['ZAR', 18, 'R'],
  Ethiopia: ['ETB', 122, 'Br'],
  Egypt: ['EGP', 48, 'E£'],
  Morocco: ['MAD', 10, 'DH'],
  Algeria: ['DZD', 134, 'DA'],
  Angola: ['AOA', 910, 'Kz'],
  Benin: ['XOF', 600, 'CFA'],
  Botswana: ['BWP', 13.5, 'P'],
  'Burkina Faso': ['XOF', 600, 'CFA'],
  Burundi: ['BIF', 2900, 'FBu'],
  Cameroon: ['XAF', 600, 'FCFA'],
  'DR Congo': ['CDF', 2800, 'FC'],
  Congo: ['XAF', 600, 'FCFA'],
  "Côte d'Ivoire": ['XOF', 600, 'CFA'],
  Gabon: ['XAF', 600, 'FCFA'],
  Gambia: ['GMD', 68, 'D'],
  Guinea: ['GNF', 8600, 'FG'],
  Liberia: ['LRD', 190, 'L$'],
  Libya: ['LYD', 4.8, 'LD'],
  Malawi: ['MWK', 1730, 'MK'],
  Mali: ['XOF', 600, 'CFA'],
  Mauritania: ['MRU', 40, 'UM'],
  Mauritius: ['MUR', 46, '₨'],
  Mozambique: ['MZN', 64, 'MT'],
  Namibia: ['NAD', 18, 'N$'],
  Niger: ['XOF', 600, 'CFA'],
  Senegal: ['XOF', 600, 'CFA'],
  'Sierra Leone': ['SLE', 22.5, 'Le'],
  Somalia: ['SOS', 571, 'Sh'],
  'South Sudan': ['SSP', 1600, 'SSP'],
  Sudan: ['SDG', 600, 'SDG'],
  Togo: ['XOF', 600, 'CFA'],
  Tunisia: ['TND', 3.1, 'DT'],
  Zambia: ['ZMW', 26, 'ZK'],
  Zimbabwe: ['USD', 1, '$'],
  'United States': ['USD', 1, '$'],
  'United Kingdom': ['GBP', 0.78, '£'],
  Canada: ['CAD', 1.36, 'C$'],
  Australia: ['AUD', 1.5, 'A$'],
  'New Zealand': ['NZD', 1.63, 'NZ$'],
  Ireland: ['EUR', 0.92, '€'],
  France: ['EUR', 0.92, '€'],
  Germany: ['EUR', 0.92, '€'],
  Spain: ['EUR', 0.92, '€'],
  Italy: ['EUR', 0.92, '€'],
  Portugal: ['EUR', 0.92, '€'],
  Netherlands: ['EUR', 0.92, '€'],
  Belgium: ['EUR', 0.92, '€'],
  Switzerland: ['CHF', 0.88, 'CHF'],
  Sweden: ['SEK', 10.5, 'kr'],
  Norway: ['NOK', 10.7, 'kr'],
  Denmark: ['DKK', 6.9, 'kr'],
  Finland: ['EUR', 0.92, '€'],
  Poland: ['PLN', 3.95, 'zł'],
  Austria: ['EUR', 0.92, '€'],
  Greece: ['EUR', 0.92, '€'],
  Turkey: ['TRY', 34, '₺'],
  Russia: ['RUB', 92, '₽'],
  Ukraine: ['UAH', 41, '₴'],
  'United Arab Emirates': ['AED', 3.67, 'AED'],
  'Saudi Arabia': ['SAR', 3.75, 'SR'],
  Qatar: ['QAR', 3.64, 'QR'],
  Kuwait: ['KWD', 0.31, 'KD'],
  Israel: ['ILS', 3.7, '₪'],
  India: ['INR', 84, '₹'],
  Pakistan: ['PKR', 278, '₨'],
  Bangladesh: ['BDT', 120, '৳'],
  China: ['CNY', 7.2, '¥'],
  Japan: ['JPY', 150, '¥'],
  'South Korea': ['KRW', 1350, '₩'],
  Indonesia: ['IDR', 15800, 'Rp'],
  Malaysia: ['MYR', 4.4, 'RM'],
  Singapore: ['SGD', 1.34, 'S$'],
  Philippines: ['PHP', 58, '₱'],
  Thailand: ['THB', 34, '฿'],
  Vietnam: ['VND', 25000, '₫'],
  Brazil: ['BRL', 5.6, 'R$'],
  Mexico: ['MXN', 19, 'MX$'],
  Argentina: ['ARS', 980, 'AR$'],
  Chile: ['CLP', 950, 'CLP$'],
  Colombia: ['COP', 4200, 'COL$'],
  Peru: ['PEN', 3.75, 'S/'],
  Jamaica: ['JMD', 157, 'J$'],
  'Trinidad & Tobago': ['TTD', 6.8, 'TT$'],
};

const DEFAULT = ['USD', 1, '$'];

// Look up the currency for a country name; falls back to USD when unknown/blank.
function currencyFor(country) {
  const [code, perUSD, symbol] = MAP[String(country || '').trim()] || DEFAULT;
  return { code, perUSD, symbol };
}

module.exports = { currencyFor, MAP };
