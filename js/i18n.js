/* UI strings. English + Polish (Polish is one of the most widely spoken languages in Ireland after English
   and Irish). Machine-assisted demo translations; production copy would go through professional
   translation and usability testing with native speakers. Content keys are tenant-overridable. */
'use strict';
window.RENEW_I18N = {
  en: {
    banner: 'All data is fictional and simulated · not affiliated with any university, research project or electricity retailer',
    skip: 'Skip to main content', retailer: 'Retailer (tenant)', household: 'Household', language: 'Language',
    nav_home: 'Home', nav_insights: 'Save', nav_live: 'Live data', nav_admin: 'Retailer admin', nav_api: 'API & pipeline',
    kpi_usage: 'Usage, last 7 days', kpi_cost: 'Cost, last 7 days', kpi_peak: 'Share used at peak', kpi_co2: 'Carbon, last 7 days',
    chart_day: 'Yesterday, half-hourly usage and price', chart_week: 'When you use electricity (last 28 days)',
    now_label: 'Right now (simulated)', band_night: 'Night', band_day: 'Day', band_peak: 'Peak',
    green_hint: 'Cheapest and greenest 3-hour window tomorrow',
    recs_title: 'Personalised suggestions', recs_intro: 'Based on your smart-meter pattern, these shifts would cut cost and grid stress. Estimates use your tariff; they are not guarantees.',
    rec_move: 'Move', rec_from: 'from about', rec_to: 'to', rec_save: 'Estimated saving', rec_month: '/month', rec_conf: 'Confidence',
    rec_accept: 'Remind me', rec_done: 'Reminder set (demo)', rec_dismiss: 'Not for me',
    model_title: 'How these suggestions are made (model card)', dynamic: 'Use tomorrow\u2019s dynamic price forecast',
    live_title: 'Live smart-meter ingestion (mock MQTT)', start: 'Start stream', stop: 'Stop stream', spoof: 'Send cross-tenant spoof',
    admin_title: 'Retailer configuration and portfolio analytics', api_title: 'API explorer and data pipeline',
    install: 'Install app', offline: 'You are offline. Showing cached demo data.',
    table_view: 'Show as table', no_recs: 'No shiftable loads detected for this household in the last 14 days.',
  },
  pl: {
    banner: 'Wszystkie dane są fikcyjne i symulowane · brak powiązań z jakąkolwiek uczelnią, projektem badawczym lub sprzedawcą energii',
    skip: 'Przejdź do treści', retailer: 'Sprzedawca (najemca)', household: 'Gospodarstwo domowe', language: 'Język',
    nav_home: 'Start', nav_insights: 'Oszczędzaj', nav_live: 'Dane na żywo', nav_admin: 'Panel sprzedawcy', nav_api: 'API i potok danych',
    kpi_usage: 'Zużycie, ostatnie 7 dni', kpi_cost: 'Koszt, ostatnie 7 dni', kpi_peak: 'Udział w szczycie', kpi_co2: 'Emisja CO\u2082, 7 dni',
    chart_day: 'Wczoraj: zużycie i cena co pół godziny', chart_week: 'Kiedy zużywasz energię (ostatnie 28 dni)',
    now_label: 'Teraz (symulacja)', band_night: 'Noc', band_day: 'Dzień', band_peak: 'Szczyt',
    green_hint: 'Najtańsze i najczystsze 3 godziny jutro',
    recs_title: 'Spersonalizowane wskazówki', recs_intro: 'Na podstawie danych z licznika te zmiany obniżą koszt i obciążenie sieci. Szacunki według Twojej taryfy, bez gwarancji.',
    rec_move: 'Przesuń', rec_from: 'z około', rec_to: 'na', rec_save: 'Szacowana oszczędność', rec_month: '/mies.', rec_conf: 'Pewność',
    rec_accept: 'Przypomnij mi', rec_done: 'Przypomnienie ustawione (demo)', rec_dismiss: 'Nie dla mnie',
    model_title: 'Jak powstają wskazówki (karta modelu)', dynamic: 'Użyj jutrzejszej prognozy cen dynamicznych',
    live_title: 'Odczyty liczników na żywo (symulowane MQTT)', start: 'Uruchom strumień', stop: 'Zatrzymaj', spoof: 'Wyślij fałszywy odczyt innego najemcy',
    admin_title: 'Konfiguracja sprzedawcy i analityka portfela', api_title: 'Eksplorator API i potok danych',
    install: 'Zainstaluj aplikację', offline: 'Brak połączenia. Pokazuję zapisane dane demo.',
    table_view: 'Pokaż jako tabelę', no_recs: 'Brak obciążeń do przesunięcia w ostatnich 14 dniach.',
  },
};
