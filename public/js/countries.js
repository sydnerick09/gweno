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
  const flag = (code) => code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

  window.populateCountries = function (select, current) {
    if (!select) return;
    select.innerHTML = '<option value="">Select your country…</option>' +
      C.map(([code, name]) => `<option value="${name}" ${current === name ? 'selected' : ''}>${flag(code)}  ${name}</option>`).join('');
  };
})();
