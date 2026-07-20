/* Country list + a helper to fill a <select> with flag + name. Kenya pinned first. */
(function () {
  const C = [
    ['KE', 'Kenya'], ['UG', 'Uganda'], ['TZ', 'Tanzania'], ['RW', 'Rwanda'], ['NG', 'Nigeria'],
    ['GH', 'Ghana'], ['ZA', 'South Africa'], ['ET', 'Ethiopia'], ['EG', 'Egypt'], ['MA', 'Morocco'],
    ['DZ', 'Algeria'], ['AO', 'Angola'], ['BJ', 'Benin'], ['BW', 'Botswana'], ['BF', 'Burkina Faso'],
    ['BI', 'Burundi'], ['CM', 'Cameroon'], ['CD', 'DR Congo'], ['CG', 'Congo'], ['CI', "Côte d'Ivoire"],
    ['GA', 'Gabon'], ['GM', 'Gambia'], ['GN', 'Guinea'], ['LR', 'Liberia'], ['LY', 'Libya'],
    ['MW', 'Malawi'], ['ML', 'Mali'], ['MR', 'Mauritania'], ['MU', 'Mauritius'], ['MZ', 'Mozambique'],
    ['NA', 'Namibia'], ['NE', 'Niger'], ['SN', 'Senegal'], ['SL', 'Sierra Leone'], ['SO', 'Somalia'],
    ['SS', 'South Sudan'], ['SD', 'Sudan'], ['TG', 'Togo'], ['TN', 'Tunisia'], ['ZM', 'Zambia'], ['ZW', 'Zimbabwe'],
    ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['NZ', 'New Zealand'],
    ['IE', 'Ireland'], ['FR', 'France'], ['DE', 'Germany'], ['ES', 'Spain'], ['IT', 'Italy'],
    ['PT', 'Portugal'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['CH', 'Switzerland'], ['SE', 'Sweden'],
    ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['PL', 'Poland'], ['AT', 'Austria'],
    ['GR', 'Greece'], ['TR', 'Turkey'], ['RU', 'Russia'], ['UA', 'Ukraine'], ['AE', 'United Arab Emirates'],
    ['SA', 'Saudi Arabia'], ['QA', 'Qatar'], ['KW', 'Kuwait'], ['IL', 'Israel'], ['IN', 'India'],
    ['PK', 'Pakistan'], ['BD', 'Bangladesh'], ['CN', 'China'], ['JP', 'Japan'], ['KR', 'South Korea'],
    ['ID', 'Indonesia'], ['MY', 'Malaysia'], ['SG', 'Singapore'], ['PH', 'Philippines'], ['TH', 'Thailand'],
    ['VN', 'Vietnam'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['AR', 'Argentina'], ['CL', 'Chile'],
    ['CO', 'Colombia'], ['PE', 'Peru'], ['JM', 'Jamaica'], ['TT', 'Trinidad & Tobago'],
  ];
  // International dialling codes, keyed by ISO-2 code.
  const DIAL = {
    KE: '+254', UG: '+256', TZ: '+255', RW: '+250', NG: '+234', GH: '+233', ZA: '+27', ET: '+251', EG: '+20', MA: '+212',
    DZ: '+213', AO: '+244', BJ: '+229', BW: '+267', BF: '+226', BI: '+257', CM: '+237', CD: '+243', CG: '+242', CI: '+225',
    GA: '+241', GM: '+220', GN: '+224', LR: '+231', LY: '+218', MW: '+265', ML: '+223', MR: '+222', MU: '+230', MZ: '+258',
    NA: '+264', NE: '+227', SN: '+221', SL: '+232', SO: '+252', SS: '+211', SD: '+249', TG: '+228', TN: '+216', ZM: '+260',
    ZW: '+263', US: '+1', GB: '+44', CA: '+1', AU: '+61', NZ: '+64', IE: '+353', FR: '+33', DE: '+49', ES: '+34',
    IT: '+39', PT: '+351', NL: '+31', BE: '+32', CH: '+41', SE: '+46', NO: '+47', DK: '+45', FI: '+358', PL: '+48',
    AT: '+43', GR: '+30', TR: '+90', RU: '+7', UA: '+380', AE: '+971', SA: '+966', QA: '+974', KW: '+965', IL: '+972',
    IN: '+91', PK: '+92', BD: '+880', CN: '+86', JP: '+81', KR: '+82', ID: '+62', MY: '+60', SG: '+65', PH: '+63',
    TH: '+66', VN: '+84', BR: '+55', MX: '+52', AR: '+54', CL: '+56', CO: '+57', PE: '+51', JM: '+1', TT: '+1',
  };
  // Currency per country, keyed by ISO-2 code: [currencyCode, symbol].
  const CUR = {
    KE: ['KES', 'KSh'], UG: ['UGX', 'USh'], TZ: ['TZS', 'TSh'], RW: ['RWF', 'FRw'], NG: ['NGN', '₦'],
    GH: ['GHS', 'GH₵'], ZA: ['ZAR', 'R'], ET: ['ETB', 'Br'], EG: ['EGP', 'E£'], MA: ['MAD', 'DH'],
    DZ: ['DZD', 'DA'], AO: ['AOA', 'Kz'], BJ: ['XOF', 'CFA'], BW: ['BWP', 'P'], BF: ['XOF', 'CFA'],
    BI: ['BIF', 'FBu'], CM: ['XAF', 'FCFA'], CD: ['CDF', 'FC'], CG: ['XAF', 'FCFA'], CI: ['XOF', 'CFA'],
    GA: ['XAF', 'FCFA'], GM: ['GMD', 'D'], GN: ['GNF', 'FG'], LR: ['LRD', 'L$'], LY: ['LYD', 'LD'],
    MW: ['MWK', 'MK'], ML: ['XOF', 'CFA'], MR: ['MRU', 'UM'], MU: ['MUR', '₨'], MZ: ['MZN', 'MT'],
    NA: ['NAD', 'N$'], NE: ['XOF', 'CFA'], SN: ['XOF', 'CFA'], SL: ['SLL', 'Le'], SO: ['SOS', 'Sh'],
    SS: ['SSP', '£'], SD: ['SDG', 'ج.س'], TG: ['XOF', 'CFA'], TN: ['TND', 'DT'], ZM: ['ZMW', 'ZK'],
    ZW: ['ZWL', 'Z$'], US: ['USD', '$'], GB: ['GBP', '£'], CA: ['CAD', 'C$'], AU: ['AUD', 'A$'],
    NZ: ['NZD', 'NZ$'], IE: ['EUR', '€'], FR: ['EUR', '€'], DE: ['EUR', '€'], ES: ['EUR', '€'],
    IT: ['EUR', '€'], PT: ['EUR', '€'], NL: ['EUR', '€'], BE: ['EUR', '€'], CH: ['CHF', 'CHF'],
    SE: ['SEK', 'kr'], NO: ['NOK', 'kr'], DK: ['DKK', 'kr'], FI: ['EUR', '€'], PL: ['PLN', 'zł'],
    AT: ['EUR', '€'], GR: ['EUR', '€'], TR: ['TRY', '₺'], RU: ['RUB', '₽'], UA: ['UAH', '₴'],
    AE: ['AED', 'AED'], SA: ['SAR', 'SAR'], QA: ['QAR', 'QAR'], KW: ['KWD', 'KD'], IL: ['ILS', '₪'],
    IN: ['INR', '₹'], PK: ['PKR', '₨'], BD: ['BDT', '৳'], CN: ['CNY', '¥'], JP: ['JPY', '¥'],
    KR: ['KRW', '₩'], ID: ['IDR', 'Rp'], MY: ['MYR', 'RM'], SG: ['SGD', 'S$'], PH: ['PHP', '₱'],
    TH: ['THB', '฿'], VN: ['VND', '₫'], BR: ['BRL', 'R$'], MX: ['MXN', 'MX$'], AR: ['ARS', 'AR$'],
    CL: ['CLP', 'CLP$'], CO: ['COP', 'COL$'], PE: ['PEN', 'S/'], JM: ['JMD', 'J$'], TT: ['TTD', 'TT$'],
  };
  const flag = (code) => code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

  window.populateCountries = function (select, current) {
    if (!select) return;
    select.innerHTML = '<option value="">Select your country…</option>' +
      C.map(([code, name]) => `<option value="${name}" data-dial="${DIAL[code] || ''}" ${current === name ? 'selected' : ''}>${flag(code)}  ${name}</option>`).join('');
  };

  // Dial code for a country name (e.g. "Kenya" -> "+254").
  window.dialCodeForCountry = function (name) {
    const hit = C.find(([, n]) => n === name);
    return hit ? (DIAL[hit[0]] || '') : '';
  };

  // Currency for a country name (e.g. "Kenya" -> { code:'KES', symbol:'KSh' }).
  window.currencyForCountry = function (name) {
    const hit = C.find(([, n]) => n === name);
    const cur = hit ? CUR[hit[0]] : null;
    return cur ? { code: cur[0], symbol: cur[1] } : { code: 'USD', symbol: '$' };
  };

  // Format an amount in a given currency (whole units, thousands separators).
  window.formatCurrency = function (amount, cur) {
    const c = cur || { code: 'USD', symbol: '$' };
    const n = Math.round(Number(amount) || 0).toLocaleString();
    return `${c.symbol}${n} ${c.code}`;
  };
})();
